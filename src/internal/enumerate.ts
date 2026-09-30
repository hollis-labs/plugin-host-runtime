import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const CHILD = `
const { createRequire } = require('node:module')
const req = createRequire(process.argv[1])
const out = {}
for (const spec of JSON.parse(process.argv[2])) {
  try { out[spec] = Object.keys(req(spec)) }
  catch (e) { out[spec] = { error: String(e && e.message || e) } }
}
process.stdout.write(JSON.stringify(out))
`

const IDENT = /^[A-Za-z_$][\w$]*$/

export interface Enumerated {
  names: string[]
}

/**
 * Own-key names of each installed package, as the UNION of what it exposes
 * under NODE_ENV=production and NODE_ENV=development, minus `__`-prefixed
 * internals and anything that is not a plain identifier.
 *
 * Two child processes rather than in-process requires: React picks its CJS
 * build at first require from NODE_ENV, and the host process has only one.
 * Dev and prod really do differ (`act`, `captureOwnerStack` are dev-only), and
 * a plugin built against either must load against the host in either mode.
 */
export function enumerateExports(specs: readonly string[], root: string): Record<string, string[]> {
  const anchor = path.join(root, 'noop.js')
  const runs = (['production', 'development'] as const).map((env) => {
    const stdout = execFileSync(process.execPath, ['-e', CHILD, anchor, JSON.stringify(specs)], {
      env: { ...process.env, NODE_ENV: env },
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
    return JSON.parse(stdout) as Record<string, string[] | { error: string }>
  })
  const result: Record<string, string[]> = {}
  for (const spec of specs) {
    const set = new Set<string>()
    for (const run of runs) {
      const v = run[spec]
      if (!v || !Array.isArray(v)) {
        const why = v && !Array.isArray(v) ? v.error : 'no result'
        throw new Error(
          `plugin-host-runtime: cannot enumerate exports of "${spec}" from ${root}: ${why}. ` +
            `Install it, or give this specifier an explicit \`exports\` list.`,
        )
      }
      for (const k of v) if (!k.startsWith('__') && k !== 'default' && IDENT.test(k)) set.add(k)
    }
    result[spec] = [...set].sort()
  }
  return result
}

/** Installed version of a package, or undefined when it has no readable manifest. */
export function installedVersion(pkg: string, root: string): string | undefined {
  try {
    const req = createRequire(path.join(root, 'noop.js'))
    // Not every package exports ./package.json; walk up from the resolved entry.
    let dir = path.dirname(req.resolve(pkg))
    for (let i = 0; i < 8; i++) {
      try {
        const j = req(path.join(dir, 'package.json')) as { name?: string; version?: string }
        if (j.name === pkg) return j.version
      } catch {
        /* keep walking */
      }
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
  } catch {
    /* unresolved */
  }
  return undefined
}

/** `react/jsx-runtime` -> `react`, `@scope/x/y` -> `@scope/x`. */
export function packageOf(spec: string): string {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
}
