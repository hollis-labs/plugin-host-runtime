import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { OPTIONAL_SPECIFIERS, SHARED_SPECIFIERS } from '../dist/index.js'
import { hostRuntime } from '../dist/vite.js'
import { definePluginUiConfig } from '../dist/build.js'
import { HostRuntimeError, checkRuntime, verifyHostRuntime } from '../dist/browser.js'
import { enumerateExports } from '../dist/internal/enumerate.js'
import { injectBeforeFirstModule, joinBase, sha256Source } from '../dist/internal/importmap.js'
import { translateImportError } from '../dist/internal/errors.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'noop.js'))

// Names in apps/flux/src/_host/react.ts when this was written (read, not run).
const FLUX_REACT_NAMES = (
  'Activity Children Component Fragment Profiler PureComponent StrictMode Suspense act cache cacheSignal ' +
  'captureOwnerStack cloneElement createContext createElement createRef forwardRef isValidElement lazy memo ' +
  'startTransition use useActionState useCallback useContext useDebugValue useDeferredValue useEffect ' +
  'useEffectEvent useId useImperativeHandle useInsertionEffect useLayoutEffect useMemo useOptimistic ' +
  'useReducer useRef useState useSyncExternalStore useTransition version'
).split(' ')

function ownKeysUnder(env, spec) {
  const out = JSON.parse(
    // eslint-disable-next-line
    require('node:child_process').execFileSync(
      process.execPath,
      ['-e', `process.stdout.write(JSON.stringify(Object.keys(require(${JSON.stringify(spec)}))))`],
      { cwd: root, env: { ...process.env, NODE_ENV: env }, encoding: 'utf8' },
    ),
  )
  return out
}

// ---- export enumeration --------------------------------------------------

test('enumeration: union of prod and dev keys, minus __ internals, a superset of the names Flux hand-kept', () => {
  const got = enumerateExports(SHARED_SPECIFIERS, root)
  const react = new Set(got.react)
  for (const n of FLUX_REACT_NAMES) assert.ok(react.has(n), `missing ${n}`)
  assert.ok(![...react].some((n) => n.startsWith('__')))
  const prod = ownKeysUnder('production', 'react')
  const dev = ownKeysUnder('development', 'react')
  for (const n of [...prod, ...dev].filter((n) => !n.startsWith('__') && n !== 'default')) {
    assert.ok(react.has(n), `union lacks ${n}`)
  }
})

test('enumeration: contains ViewTransition exactly when the installed React has it (derived, no counts)', () => {
  const installed = new Set([...ownKeysUnder('production', 'react'), ...ownKeysUnder('development', 'react')])
  const got = new Set(enumerateExports(['react'], root).react)
  assert.equal(got.has('ViewTransition'), installed.has('ViewTransition'))
  assert.equal(got.has('act'), installed.has('act'), 'dev-only names must be included')
})

test('enumeration: react-dom subpaths and jsx-runtime come out', () => {
  const got = enumerateExports(['react-dom/client', 'react/jsx-runtime'], root)
  assert.ok(got['react-dom/client'].includes('createRoot'))
  assert.ok(got['react/jsx-runtime'].includes('jsx'))
})

test('enumeration: an uninstalled package fails loudly', () => {
  assert.throws(() => enumerateExports(['definitely-not-installed-pkg'], root), /cannot enumerate/)
})

// ---- base handling, sha, injection ----------------------------------------

test('joinBase honours /, /sysop/, ./, empty and absolute URL bases', () => {
  assert.equal(joinBase('/', 'assets/a.js'), '/assets/a.js')
  assert.equal(joinBase('/sysop/', 'assets/a.js'), '/sysop/assets/a.js')
  assert.equal(joinBase('/sysop', 'assets/a.js'), '/sysop/assets/a.js')
  assert.equal(joinBase('./', 'assets/a.js'), './assets/a.js')
  assert.equal(joinBase('', 'assets/a.js'), './assets/a.js')
  assert.equal(joinBase('https://cdn.example/x/', 'assets/a.js'), 'https://cdn.example/x/assets/a.js')
})

test('HTML injection order: shim, then map, then the first module script', () => {
  const html = '<html><head><script type="module" src="/a.js"></script></head><body><script type="module" src="/b.js"></script></body></html>'
  const out = injectBeforeFirstModule(html, ['<script src="/s.js"></script>', '<script type="importmap">{}</script>'])
  const iShim = out.indexOf('/s.js')
  const iMap = out.indexOf('importmap')
  const iA = out.indexOf('/a.js')
  assert.ok(iShim < iMap && iMap < iA)
  assert.ok(out.indexOf('/b.js') > iA)
})

test('HTML injection falls back to </head> when there is no module script', () => {
  const out = injectBeforeFirstModule('<html><head></head><body></body></html>', ['<script type="importmap">{}</script>'])
  assert.ok(out.indexOf('importmap') < out.indexOf('</head>'))
})

// Drive the plugin's hooks with a fake build, no bundler needed.
function fakeBuild({ base, opts, shims } = {}) {
  const plugin = hostRuntime({ ...opts, ...(shims === undefined ? {} : { shims }) })
  plugin.configResolved({ command: 'build', base, root, build: { assetsDir: 'assets' } })
  const emitted = []
  const ctx = { emitFile: (f) => emitted.push(f) }
  const bundle = {}
  for (const name of ['react', 'react-dom', 'react-dom-client', 'react-jsx-runtime']) {
    bundle[`assets/_host/${name}-h4sh.js`] = {
      type: 'chunk',
      isEntry: true,
      name: `_host/${name}`,
      fileName: `assets/_host/${name}-h4sh.js`,
    }
  }
  bundle['assets/main-h4sh.js'] = { type: 'chunk', isEntry: true, name: 'main', fileName: 'assets/main-h4sh.js' }
  return { plugin, ctx, bundle, emitted }
}

test('build map uses base; sha256 is the hash of the exact inserted text; manifest agrees', () => {
  for (const base of ['/', '/sysop/', './']) {
    const { plugin, ctx, bundle, emitted } = fakeBuild({ base })
    plugin.buildStart.handler.call(ctx)
    const html = plugin.transformIndexHtml.handler('<html><head><script type="module" src="/m.js"></script></head></html>', { bundle })
    const m = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)
    assert.ok(m, 'importmap tag present')
    const inserted = m[1]
    const map = JSON.parse(inserted)
    assert.equal(map.imports.react, joinBase(base, 'assets/_host/react-h4sh.js'))
    assert.equal(Object.keys(map.imports).length, SHARED_SPECIFIERS.length)
    assert.ok(html.indexOf('es-module-shims.js') < html.indexOf('importmap'))
    assert.ok(html.indexOf('importmap') < html.indexOf('type="module"'))
    assert.ok(html.includes(`src="${joinBase(base, 'assets/es-module-shims.js')}"`))

    plugin.generateBundle.handler.call(ctx, {}, bundle)
    const manifestFile = emitted.find((e) => e.fileName === 'host-runtime.json')
    assert.ok(manifestFile)
    const manifest = JSON.parse(manifestFile.source)
    assert.equal(manifest.importMapSha256, `sha256-${createHash('sha256').update(inserted, 'utf8').digest('base64')}`)
    assert.equal(manifest.importMapSha256, sha256Source(inserted))
    assert.deepEqual(manifest.importMap, map)
    assert.equal(manifest.provided.react, require('react/package.json').version)
    assert.equal(plugin.api.manifest().importMapSha256, manifest.importMapSha256)
  }
})

test('shims:false injects no loader tag and emits no shim asset; manifest:false and a custom name are honoured', () => {
  const a = fakeBuild({ base: '/', shims: false })
  a.plugin.buildStart.handler.call(a.ctx)
  assert.equal(a.emitted.length, 0)
  const html = a.plugin.transformIndexHtml.handler('<head><script type="module" src="/m.js"></script></head>', { bundle: a.bundle })
  assert.ok(!html.includes('es-module-shims'))

  const b = fakeBuild({ base: '/', opts: { manifest: false } })
  b.plugin.generateBundle.handler.call(b.ctx, {}, b.bundle)
  assert.equal(b.emitted.length, 0)

  const c = fakeBuild({ base: '/', opts: { manifest: 'x/hr.json' } })
  c.plugin.generateBundle.handler.call(c.ctx, {}, c.bundle)
  assert.equal(c.emitted[0].fileName, 'x/hr.json')
})

test('a missing entry chunk is an error, not a silent gap in the map', () => {
  const { plugin, bundle } = fakeBuild({ base: '/' })
  delete bundle['assets/_host/react-h4sh.js']
  assert.throws(() => plugin.transformIndexHtml.handler('<head></head>', { bundle }), /no entry chunk .* "react"/)
})

test('dev map uses Vite-served virtual URLs under base, and is exposed through api.manifest()', () => {
  const plugin = hostRuntime()
  plugin.configResolved({ command: 'serve', base: '/sysop/', root, build: { assetsDir: 'assets' } })
  const m = plugin.api.manifest()
  assert.equal(m.importMap.imports.react, '/sysop/@id/__x00__plugin-host-runtime:react')
  assert.equal(m.importMap.imports['react/jsx-runtime'], '/sysop/@id/__x00__plugin-host-runtime:react-jsx-runtime')
  const html = plugin.transformIndexHtml.handler('<head><script type="module" src="/m"></script></head>', {})
  const inserted = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]
  assert.equal(m.importMapSha256, sha256Source(inserted))
})

test('virtual modules: generated from the installed package, default export present, no __ names', () => {
  const plugin = hostRuntime()
  plugin.configResolved({ command: 'build', base: '/', root, build: { assetsDir: 'assets' } })
  const id = plugin.resolveId('plugin-host-runtime:react')
  assert.equal(id, '\0plugin-host-runtime:react')
  const src = plugin.load(id)
  assert.match(src, /export \{[^}]*\bViewTransition\b|export \{[^}]*\buseState\b/)
  assert.match(src, /export default __ns/)
  assert.ok(!/__CLIENT_INTERNALS/.test(src))
  assert.equal(plugin.resolveId('react'), undefined)
})

// ---- config() hook ----------------------------------------------------------

const cfg = (userConfig, command = 'build') => hostRuntime().config({ root, ...userConfig }, { command, mode: 'test' })

test('config: adds host entries, defaults main to index.html, sets strict signatures', () => {
  const c = cfg({})
  const input = c.build.rollupOptions.input
  assert.equal(input.main, path.join(root, 'index.html'))
  assert.equal(input['_host/react'], 'plugin-host-runtime:react')
  assert.equal(Object.keys(input).length, 1 + SHARED_SPECIFIERS.length)
  assert.equal(c.build.rollupOptions.preserveEntrySignatures, 'strict')
})

test('config: merges with an existing string, array and object input', () => {
  const s = cfg({ build: { rollupOptions: { input: 'app/index.html' } } }).build.rollupOptions.input
  assert.equal(s.index, 'app/index.html')
  assert.ok(s['_host/react'])
  const a = cfg({ build: { rollupOptions: { input: ['a.html', 'b.html'] } } }).build.rollupOptions.input
  assert.ok(a.a && a.b && a['_host/react-dom'])
  const o = cfg({ build: { rollupOptions: { input: { main: 'm.html', admin: 'a.html' } } } }).build.rollupOptions.input
  assert.equal(o.main, 'm.html')
  assert.equal(o.admin, 'a.html')
  assert.ok(o['_host/react-dom-client'])
})

test('config: shared file entries become direct inputs, packages virtual ones, extras are added', () => {
  const plugin = hostRuntime({
    extras: ['react/jsx-dev-runtime'],
    shared: { '@nanite/ui/button': 'package.json', 'some-cjs': { entry: 'react-is', exports: 'enumerate' } },
  })
  const input = plugin.config({ root }, { command: 'build', mode: 'test' }).build.rollupOptions.input
  assert.ok(OPTIONAL_SPECIFIERS.includes('react/jsx-dev-runtime'))
  assert.equal(input['_host/react-jsx-dev-runtime'], 'plugin-host-runtime:react-jsx-dev-runtime')
  assert.equal(input['_host/nanite-ui-button'], path.join(root, 'package.json'))
  assert.equal(input['_host/some-cjs'], 'plugin-host-runtime:some-cjs')
})

test('config: a file with exports:enumerate is rejected; a colliding rollup input is rejected', () => {
  assert.throws(
    () => hostRuntime({ shared: { x: { entry: 'package.json', exports: 'enumerate' } } }).config({ root }, { command: 'build', mode: 't' }),
    /applies to bare packages only/,
  )
  assert.throws(() => cfg({ build: { rollupOptions: { input: { '_host/react': 'x' } } } }), /already defined/)
})

test('config: serve pre-includes the core specifiers for dep optimisation and adds no input; lib mode is untouched', () => {
  const c = cfg({}, 'serve')
  assert.deepEqual(c.optimizeDeps.include, [...SHARED_SPECIFIERS])
  assert.equal(c.build, undefined)
  assert.equal(cfg({ build: { lib: { entry: 'x' } } }), undefined)
})

// ---- /build ------------------------------------------------------------------

test('definePluginUiConfig reproduces the giphy lib config', () => {
  const c = definePluginUiConfig({ entry: 'src/index.tsx' })
  assert.deepEqual(c.build.lib.formats, ['es'])
  assert.equal(c.build.lib.entry, 'src/index.tsx')
  assert.equal(c.build.lib.fileName(), 'index.js')
  assert.deepEqual(c.build.rollupOptions.external, [...SHARED_SPECIFIERS])
  assert.equal(c.build.rollupOptions.output.assetFileNames({ name: 'a.css' }), 'style.css')
  assert.equal(c.build.rollupOptions.output.assetFileNames({ name: 'a.png' }), '[name][extname]')
  assert.equal(c.build.cssCodeSplit, false)
  assert.equal(c.build.sourcemap, true)
  assert.equal(c.build.emptyOutDir, true)
  assert.equal('target' in c.build, false)
})

test('definePluginUiConfig honours target, extraExternals and fileName', () => {
  const c = definePluginUiConfig({ entry: 'e', target: 'es2022', extraExternals: ['@nanite/ui/button'], fileName: 'main.js' })
  assert.equal(c.build.target, 'es2022')
  assert.deepEqual(c.build.rollupOptions.external, [...SHARED_SPECIFIERS, '@nanite/ui/button'])
  assert.equal(c.build.lib.fileName(), 'main.js')
})

// ---- /browser ------------------------------------------------------------------

const docWith = (maps) => ({
  querySelectorAll: () => maps.map((t) => ({ textContent: t })),
})

test('verifyHostRuntime: no map, partial map, full map, custom required', () => {
  assert.deepEqual(verifyHostRuntime({ document: docWith([]) }), { ok: false, missing: [...SHARED_SPECIFIERS] })
  const partial = JSON.stringify({ imports: { react: '/r.js' } })
  const r = verifyHostRuntime({ document: docWith([partial]) })
  assert.equal(r.ok, false)
  assert.ok(!r.missing.includes('react') && r.missing.includes('react-dom'))
  const full = JSON.stringify({ imports: Object.fromEntries(SHARED_SPECIFIERS.map((s) => [s, '/x.js'])) })
  assert.deepEqual(verifyHostRuntime({ document: docWith([full]) }), { ok: true, missing: [] })
  assert.deepEqual(verifyHostRuntime({ document: docWith([partial]), required: ['react'] }), { ok: true, missing: [] })
  assert.equal(verifyHostRuntime({ document: docWith(['{not json']) }).ok, false)
})

test('HostRuntimeError translation: Chrome wording, both map states, and other failures', () => {
  const chrome = new TypeError('Failed to resolve module specifier "react/jsx-runtime". Relative references must start with either "/", "./", or "../".')
  const a = translateImportError(chrome, 'http://h/p.js', true)
  assert.ok(a instanceof HostRuntimeError)
  assert.equal(a.code, 'specifier-unmapped')
  assert.equal(a.specifier, 'react/jsx-runtime')
  assert.equal(translateImportError(chrome, 'u', false).code, 'import-map-missing')
  const firefox = new TypeError('Error resolving module specifier “react”. Relative module specifiers must start with “./”.')
  assert.equal(translateImportError(firefox, 'u', true).specifier, 'react')
  const safari = new TypeError("Module name, 'react' does not resolve to a valid URL.")
  assert.equal(translateImportError(safari, 'u', true).specifier, 'react')
  const other = new SyntaxError("The requested module 'react' does not provide an export named 'ViewTransition'")
  const o = translateImportError(other, 'u', true)
  assert.equal(o.code, 'load-failed')
  assert.match(o.message, /ViewTransition/)
  assert.equal(o.cause, other)
  assert.equal(translateImportError(a, 'u', true), a)
})

test('checkRuntime grammar: undefined, exact, caret, tilde, unknown name, unsupported syntax', () => {
  const p = { react: '19.3.0' }
  assert.deepEqual(checkRuntime(undefined, p), { ok: true })
  assert.equal(checkRuntime({ name: 'react', version: '19.3.0' }, p).ok, true)
  assert.equal(checkRuntime({ name: 'react', version: '19.2.0' }, p).ok, false)
  assert.equal(checkRuntime({ name: 'react', version: '^19.0.0' }, p).ok, true)
  assert.equal(checkRuntime({ name: 'react', version: '^18.2.0' }, p).ok, false)
  assert.equal(checkRuntime({ name: 'react', version: '^19.4.0' }, p).ok, false)
  assert.equal(checkRuntime({ name: 'react', version: '~19.3.0' }, p).ok, true)
  assert.equal(checkRuntime({ name: 'react', version: '~19.2.0' }, p).ok, false)
  assert.equal(checkRuntime({ name: 'react-dom', version: '^19.0.0' }, p).ok, false)
  const bad = checkRuntime({ name: 'react', version: '>=19' }, p)
  assert.equal(bad.ok, false)
  assert.match(bad.reason, /supported: X\.Y\.Z/)
  assert.equal(checkRuntime({ name: 'react', version: '^19.0.0' }, { react: 'weird' }).ok, false)
})

test('the "." entry exports the one list and it is the four documented specifiers', () => {
  assert.deepEqual([...SHARED_SPECIFIERS], ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'])
  assert.deepEqual([...OPTIONAL_SPECIFIERS], ['react/jsx-dev-runtime'])
})
