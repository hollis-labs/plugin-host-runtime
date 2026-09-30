// Real-browser matrix: Vite {5.4.21, 6.4.3, 7.3.1, 8.3.1} x {build+preview, dev}
// x base x CSP. Needs Chrome (CHROME_PATH) and network for `npm install`.
// Exit codes: 0 all cells pass, 1 a cell failed, 3 EXAMINED NOTHING (no browser).
// A missing browser is never a pass.
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chrome = process.env.CHROME_PATH
if (!chrome || !fs.existsSync(chrome)) {
  console.error('EXAMINED NOTHING: set CHROME_PATH to a Chrome/Chromium executable.')
  process.exit(3)
}

const VITES = (process.env.MATRIX_VITES || '5.4.21,6.4.3,7.3.1,8.3.1').split(',')
const work = path.resolve(process.env.MATRIX_DIR || path.join(repo, '.matrix'))
fs.mkdirSync(work, { recursive: true })
const sh = (cmd, args, cwd, env) =>
  execFileSync(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' })

// 1. Pack this package (dev-only tarball; never committed, never in a manifest).
for (const f of fs.readdirSync(work)) if (f.endsWith('.tgz')) fs.rmSync(path.join(work, f))
const packed = sh('npm', ['pack', '--pack-destination', work, '--silent', '--ignore-scripts'], repo).trim().split('\n').pop()
const tgz = path.join(work, packed)

function install(dir, pkg) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: path.basename(dir), private: true, type: 'module', ...pkg }, null, 2))
  // A stale lockfile or installed copy would silently test an OLD build of this package.
  fs.rmSync(path.join(dir, 'node_modules/@hollis-labs'), { recursive: true, force: true })
  fs.rmSync(path.join(dir, 'package-lock.json'), { force: true })
  sh('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], dir)
}

// 2. Plugin bundles: Vite 5.4.21 lib mode against React 18, via definePluginUiConfig.
const pluginDir = path.join(work, 'plugin')
install(pluginDir, {
  devDependencies: { vite: '5.4.21', react: '^18.3.1', 'react-dom': '^18.3.1', '@hollis-labs/plugin-host-runtime': `file:${tgz}` },
})
fs.cpSync(path.join(repo, 'test/fixtures/plugin'), pluginDir, { recursive: true, filter: (s) => !s.includes('node_modules') })
for (const p of ['counter', 'vt', 'shared', 'unmapped']) {
  sh('node', ['node_modules/vite/bin/vite.js', 'build', '--logLevel', 'warn'], pluginDir, { PLUGIN: p })
}

// 3. Hosts, one per Vite major.
const freePort = () =>
  new Promise((res) => {
    const s = net.createServer().listen(0, 'localhost', () => {
      const { port } = s.address()
      s.close(() => res(port))
    })
  })

async function waitUp(url, child) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('server exited early')
    try {
      const r = await fetch(url)
      if (r.status < 500) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`server did not come up at ${url}`)
}

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] })
const rows = []
let failed = 0

async function runCell(label, url, csp, hostDir) {
  const page = await browser.newPage()
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  let result
  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForFunction(() => document.body.getAttribute('data-result'), { timeout: 20000 })
    result = JSON.parse(await page.evaluate(() => document.body.getAttribute('data-result')))
  } catch (e) {
    result = { harnessError: String(e) }
  }
  await page.close()
  const problems = judge(result, csp)
  const ok = problems.length === 0
  if (!ok) failed++
  rows.push({ label, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) console.log('      ', problems.join('; '), '\n      ', JSON.stringify(result), '\n      ', consoleErrors.slice(0, 4).join(' | '))
}

function judge(r, csp) {
  if (r.harnessError) return [r.harnessError]
  const p = []
  if (csp === 'self') {
    // Control: a strict CSP without the map's hash MUST break plugin loading.
    if (r.counter?.error?.code !== 'specifier-unmapped') p.push('expected specifier-unmapped under bare script-src self')
    return p
  }
  if (!r.verify?.ok) p.push(`verifyHostRuntime missing ${r.verify?.missing}`)
  const c = r.counter
  if (!c || c.error) p.push(`counter failed: ${JSON.stringify(c?.error)}`)
  else {
    if (c.identity !== true) p.push('shared identity false')
    if (c.rendered !== 'count:41' || c.afterClick !== 'count:42') p.push(`render/click ${c.rendered}/${c.afterClick}`)
  }
  if (r.hostHasViewTransition) {
    if (r.vt?.kind !== 'symbol' && r.vt?.kind !== 'object' && r.vt?.kind !== 'function') p.push(`ViewTransition: ${JSON.stringify(r.vt)}`)
  } else if (!r.vt?.error) p.push('installed React lacks ViewTransition but the fixture loaded?')
  if (r.shared?.identity !== true || r.shared?.label !== 'host-ui') p.push(`shared file entry: ${JSON.stringify(r.shared)}`)
  if (r.unmapped?.error?.code !== 'specifier-unmapped' || r.unmapped.error.specifier !== 'not-a-shared-package') {
    p.push(`unmapped: ${JSON.stringify(r.unmapped)}`)
  }
  return p
}

async function withServer(hostDir, args, env, url, fn) {
  const child = spawn('node', ['node_modules/vite/bin/vite.js', ...args], { cwd: hostDir, env: { ...process.env, ...env }, detached: true, stdio: 'ignore' })
  try {
    await waitUp(url, child)
    await fn()
  } finally {
    try { process.kill(-child.pid) } catch { /* gone */ }
    await new Promise((r) => setTimeout(r, 200))
  }
}

try {
  for (const v of VITES) {
    const hostDir = path.join(work, `host-vite${v}`)
    install(hostDir, {
      dependencies: { react: '^19.2.0', 'react-dom': '^19.2.0' },
      devDependencies: { vite: v, '@hollis-labs/plugin-host-runtime': `file:${tgz}` },
    })
    fs.cpSync(path.join(repo, 'test/fixtures/host'), hostDir, { recursive: true, filter: (s) => !s.includes('node_modules') })
    for (const p of ['counter', 'vt', 'shared', 'unmapped']) {
      fs.mkdirSync(path.join(hostDir, 'public/plugins', p), { recursive: true })
      fs.cpSync(path.join(pluginDir, 'dist', p), path.join(hostDir, 'public/plugins', p), { recursive: true })
    }
    const reactV = JSON.parse(fs.readFileSync(path.join(hostDir, 'node_modules/react/package.json'), 'utf8')).version
    console.log(`\n== vite ${v}, host react ${reactV}`)
    for (const base of ['/', '/sysop/', './']) {
      const out = `dist-${base.replace(/\W/g, '') || 'root'}`
      const buildEnv = { BASE: base, OUT: out }
      sh('node', ['node_modules/vite/bin/vite.js', 'build', '--logLevel', 'warn'], hostDir, buildEnv)
      for (const csp of ['none', 'hash', 'self']) {
        const port = await freePort()
        const env = { ...buildEnv, CSP: csp, PORT: String(port) }
        const u = `http://localhost:${port}${base === './' ? '/' : base}`
        await withServer(hostDir, ['preview'], env, u, () => runCell(`vite ${v}  build+preview  base=${base}  csp=${csp}`, u, csp, hostDir))
      }
      if (base === './') continue // dev servers treat a relative base as `/`; covered by base=/
      for (const csp of ['none', 'hash', 'self']) {
        const port = await freePort()
        const env = { BASE: base, CSP: csp, PORT: String(port) }
        const u = `http://localhost:${port}${base}`
        await withServer(hostDir, [], env, u, () => runCell(`vite ${v}  dev            base=${base}  csp=${csp}`, u, csp, hostDir))
      }
    }
  }
  // 4. plugin-registry integration (needs a plugin-registry tarball; see README).
  const regTgz = process.env.REGISTRY_TARBALL
  if (!regTgz) {
    console.log('\nSKIPPED (not a pass): registry integration; set REGISTRY_TARBALL to a plugin-registry .tgz')
  } else {
    const v = VITES.includes('7.3.1') ? '7.3.1' : VITES[VITES.length - 1]
    const hostDir = path.join(work, `host-registry-vite${v}`)
    install(hostDir, {
      dependencies: { react: '^19.2.0', 'react-dom': '^19.2.0' },
      devDependencies: { vite: v, '@hollis-labs/plugin-host-runtime': `file:${tgz}`, '@hollis-labs/plugin-registry': `file:${path.resolve(regTgz)}` },
    })
    fs.cpSync(path.join(repo, 'test/fixtures/host'), hostDir, { recursive: true, filter: (s) => !s.includes('node_modules') })
    fs.copyFileSync(path.join(repo, 'test/fixtures/registry/main.js'), path.join(hostDir, 'src/main.js'))
    for (const p of ['counter', 'unmapped']) {
      fs.mkdirSync(path.join(hostDir, 'public/plugins', p), { recursive: true })
      fs.cpSync(path.join(pluginDir, 'dist', p), path.join(hostDir, 'public/plugins', p), { recursive: true })
    }
    sh('node', ['node_modules/vite/bin/vite.js', 'build', '--logLevel', 'warn'], hostDir, { BASE: '/sysop/', OUT: 'dist' })
    const port = await freePort()
    const u = `http://localhost:${port}/sysop/`
    await withServer(hostDir, ['preview'], { BASE: '/sysop/', OUT: 'dist', CSP: 'hash', PORT: String(port) }, u, async () => {
      const page = await browser.newPage()
      await page.goto(u)
      await page.waitForFunction(() => document.body.getAttribute('data-result'), { timeout: 20000 })
      const r = JSON.parse(await page.evaluate(() => document.body.getAttribute('data-result')))
      await page.close()
      const errs = r.errors ?? []
      const ok = r.counter?.rendered === 'count:41' && r.counter?.afterClick === 'count:42' && errs.length === 1 && errs[0].plugin === 'broken' && /not-a-shared-package/.test(errs[0].reason) && /import map/.test(errs[0].reason)
      rows.push({ label: 'registry', ok })
      if (!ok) failed++
      console.log(`${ok ? 'PASS' : 'FAIL'}  registry: createPluginRegistry({ importModule: hostImportModule }) vite ${v} base=/sysop/ csp=hash`)
      if (!ok) console.log('      ', JSON.stringify(r))
    })
  }
} finally {
  await browser.close()
}
console.log(`\n${rows.length} cells, ${failed} failed`)
process.exit(failed ? 1 : 0)
