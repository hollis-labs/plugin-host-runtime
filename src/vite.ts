import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { Plugin, ResolvedConfig, UserConfig } from 'vite'
import { SHARED_SPECIFIERS, type HostRuntimeManifest } from './index.js'
import { enumerateExports, installedVersion, packageOf } from './internal/enumerate.js'
import {
  importMapTag,
  importMapText,
  injectBeforeFirstModule,
  joinBase,
  sha256Source,
} from './internal/importmap.js'

export interface HostRuntimeOptions {
  /** `'es-module-shims'` (default, Flux parity) or `false` to rely on native import maps. */
  shims?: 'es-module-shims' | false
  /** Extra core specifiers to map, e.g. `['react/jsx-dev-runtime']`. */
  extras?: string[]
  /**
   * Host-provided extra specifiers. A value is a file (relative to the Vite
   * root) or a bare package name. `exports`: `'star'` re-exports everything the
   * module statically declares; `'enumerate'` lists a CJS package's keys at
   * build time (bare CJS packages need it); an array is an explicit list.
   * Default: `'star'` for a file, `'enumerate'` for a bare package.
   */
  shared?: Record<string, string | { entry: string; exports?: 'star' | 'enumerate' | string[] }>
  /** Emit `host-runtime.json`: `true` (default), a file name, or `false`. */
  manifest?: boolean | string
}

/** The plugin's `api` field: what a config-time consumer (e.g. a CSP plugin) can read. */
export interface HostRuntimeApi {
  /** Dev: computed at startup. Build: available once the bundle has been generated. */
  manifest(): HostRuntimeManifest | undefined
}

type Exports = 'star' | 'enumerate' | string[]
interface Entry {
  spec: string
  /** Rollup input name and (sanitised) module id suffix. */
  name: string
  kind: 'bare' | 'file'
  target: string // package specifier, or absolute file path
  exports: Exports
  core: boolean
}

const VIRTUAL = 'plugin-host-runtime:'
const IDENT = /^[A-Za-z_$][\w$]*$/

function sanitize(spec: string): string {
  return spec.replace(/^@/, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function isFileLike(entry: string, root: string): boolean {
  if (entry.startsWith('.') || path.isAbsolute(entry)) return true
  return existsSync(path.resolve(root, entry))
}

function resolveEntries(opts: HostRuntimeOptions, root: string): Entry[] {
  const out: Entry[] = []
  const seen = new Map<string, string>()
  const add = (e: Omit<Entry, 'name'>) => {
    if (out.some((x) => x.spec === e.spec)) return
    const name = sanitize(e.spec)
    const clash = seen.get(name)
    if (clash) throw new Error(`plugin-host-runtime: "${e.spec}" and "${clash}" both map to entry name "${name}"`)
    seen.set(name, e.spec)
    out.push({ ...e, name })
  }
  for (const spec of [...SHARED_SPECIFIERS, ...(opts.extras ?? [])]) {
    add({ spec, kind: 'bare', target: spec, exports: 'enumerate', core: true })
  }
  for (const [spec, v] of Object.entries(opts.shared ?? {})) {
    const entry = typeof v === 'string' ? v : v.entry
    const requested = typeof v === 'string' ? undefined : v.exports
    if (isFileLike(entry, root)) {
      const exports = requested ?? 'star'
      if (exports === 'enumerate') {
        throw new Error(`plugin-host-runtime: shared["${spec}"] is a file; 'enumerate' applies to bare packages only`)
      }
      add({ spec, kind: 'file', target: path.resolve(root, entry), exports, core: false })
    } else {
      add({ spec, kind: 'bare', target: entry, exports: requested ?? 'enumerate', core: false })
    }
  }
  return out
}

function namedExport(names: string[], from: string): string {
  const valid = names.filter((n) => IDENT.test(n))
  return valid.length ? `export { ${valid.join(', ')} } from ${JSON.stringify(from)}\n` : ''
}

/**
 * Host-side plugin. Generates the shared-React shims as virtual modules from
 * the host's installed packages, adds them to the build as strict entry
 * chunks, and injects (shim, import map) into the HTML using Vite's `base`.
 * It emits `host-runtime.json` so a host can allowlist the inline map's hash
 * in a CSP.
 */
export function hostRuntime(opts: HostRuntimeOptions = {}): Plugin & { api: HostRuntimeApi } {
  const shims = opts.shims === undefined ? 'es-module-shims' : opts.shims
  let config: ResolvedConfig
  let entries: Entry[] = []
  let isBuild = false
  let names: Record<string, string[]> | undefined
  let provided: Record<string, string> | undefined
  let devManifest: HostRuntimeManifest | undefined
  let buildManifest: HostRuntimeManifest | undefined

  const byName = () => new Map(entries.map((e) => [`_host/${e.name}`, e]))

  function enumerated(): Record<string, string[]> {
    if (!names) {
      const bare = entries.filter((e) => e.kind === 'bare' && e.exports === 'enumerate').map((e) => e.target)
      names = bare.length ? enumerateExports([...new Set(bare)], config.root) : {}
    }
    return names
  }

  function getProvided(): Record<string, string> {
    if (!provided) {
      provided = {}
      for (const e of entries) {
        if (e.kind !== 'bare') continue
        const pkg = packageOf(e.target)
        const v = installedVersion(pkg, config.root)
        if (v) provided[pkg] = v
      }
    }
    return provided
  }

  function makeManifest(imports: Record<string, string>): HostRuntimeManifest {
    const text = importMapText(imports)
    return { importMap: { imports }, importMapSha256: sha256Source(text), provided: getProvided() }
  }

  function devBase(): string {
    return /^(\/|https?:\/\/)/.test(config.base) ? config.base : '/'
  }

  function devImports(): Record<string, string> {
    const imports: Record<string, string> = {}
    for (const e of entries) {
      if (e.kind === 'file' && e.exports === 'star') {
        const rel = path.relative(config.root, e.target).split(path.sep).join('/')
        imports[e.spec] = rel.startsWith('..')
          ? `${devBase()}@fs/${e.target.replace(/^\/+/, '')}`
          : joinBase(devBase(), rel)
      } else {
        imports[e.spec] = joinBase(devBase(), `@id/__x00__${VIRTUAL}${e.name}`)
      }
    }
    return imports
  }

  function bundleImports(
    bundle: Record<string, { type: string; fileName: string; name?: string; isEntry?: boolean }>,
  ): Record<string, string> {
    const map = byName()
    const found: Record<string, string> = {}
    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== 'chunk' || !chunk.isEntry || !chunk.name) continue
      const e = map.get(chunk.name)
      if (e) found[e.spec] = joinBase(config.base, chunk.fileName)
    }
    const imports: Record<string, string> = {}
    for (const e of entries) {
      const url = found[e.spec]
      if (!url) throw new Error(`plugin-host-runtime: no entry chunk was emitted for "${e.spec}"`)
      imports[e.spec] = url
    }
    return imports
  }

  const shimFile = () => `${config.build.assetsDir}/es-module-shims.js`

  function loadSource(e: Entry): string {
    if (e.kind === 'file') {
      // Only reached for an explicit name list over a file.
      const list = e.exports as string[]
      return namedExport(list, e.target)
    }
    if (e.exports === 'star') return `export * from ${JSON.stringify(e.target)}\n`
    if (Array.isArray(e.exports)) {
      return `import * as __ns from ${JSON.stringify(e.target)}\n${namedExport(e.exports, e.target)}export default __ns\n`
    }
    const list = enumerated()[e.target] ?? []
    // Explicit named re-exports, not `export *`: in Vite dev a CJS package goes
    // through the CJS->ESM dependency layer and a plain `export *` does not
    // round-trip its names, so a plugin's `import { forwardRef } from 'react'`
    // fails (BLG-20260414-011 in the Flux host this was lifted from). The list
    // is generated from the installed package, never kept by hand.
    return `import * as __ns from ${JSON.stringify(e.target)}\n${namedExport(list, e.target)}export default __ns\n`
  }

  const plugin: Plugin & { api: HostRuntimeApi } = {
    name: 'plugin-host-runtime',
    enforce: 'post',

    api: {
      manifest: () => (isBuild ? buildManifest : devManifest),
    },

    config(userConfig, env): UserConfig | undefined {
      const root = path.resolve(userConfig.root ?? process.cwd())
      const es = resolveEntries(opts, root)
      if (env.command !== 'build') {
        return { optimizeDeps: { include: es.filter((e) => e.core).map((e) => e.target) } }
      }
      if (userConfig.build?.lib) return undefined
      const existing = userConfig.build?.rollupOptions?.input
      let input: Record<string, string>
      if (existing === undefined) {
        input = { main: path.resolve(root, 'index.html') }
      } else if (typeof existing === 'string') {
        input = { [path.basename(existing, path.extname(existing))]: existing }
      } else if (Array.isArray(existing)) {
        input = Object.fromEntries(existing.map((f) => [path.basename(f, path.extname(f)), f]))
      } else {
        input = { ...existing }
      }
      for (const e of es) {
        const key = `_host/${e.name}`
        if (key in input) throw new Error(`plugin-host-runtime: rollup input "${key}" is already defined`)
        input[key] = e.kind === 'file' && e.exports === 'star' ? e.target : `${VIRTUAL}${e.name}`
      }
      return {
        build: {
          // `strict` keeps the whole export surface on the entry chunks. Plugins
          // resolve `react*` through the import map at runtime, not statically,
          // so Rollup's default would tree-shake out every name the host itself
          // does not import.
          rollupOptions: { input, preserveEntrySignatures: 'strict' },
        },
      }
    },

    configResolved(resolved) {
      config = resolved
      isBuild = resolved.command === 'build'
      entries = resolveEntries(opts, resolved.root)
      if (!isBuild) devManifest = makeManifest(devImports())
    },

    resolveId(id) {
      if (id.startsWith(VIRTUAL)) return `\0${id}`
      if (id.startsWith(`\0${VIRTUAL}`)) return id
      return undefined
    },

    load(id) {
      if (!id.startsWith(`\0${VIRTUAL}`)) return undefined
      const name = id.slice(`\0${VIRTUAL}`.length)
      const e = entries.find((x) => x.name === name)
      if (!e) return undefined
      return loadSource(e)
    },

    buildStart: {
      order: 'pre',
      handler() {
        if (!isBuild || shims !== 'es-module-shims') return
        const require = createRequire(import.meta.url)
        const source = readFileSync(require.resolve('es-module-shims'), 'utf-8')
        this.emitFile({ type: 'asset', fileName: shimFile(), source })
      },
    },

    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) {
          // Dev: Vite serves the shims through its own transform pipeline, and
          // native import maps are enough, so no loader shim is injected.
          return injectBeforeFirstModule(html, [importMapTag(importMapText(devImports()))])
        }
        const imports = bundleImports(ctx.bundle as never)
        const tags: string[] = []
        // `src` without `async`, so the shim runs before any module script that
        // depends on import-map resolution in browsers that need it.
        if (shims === 'es-module-shims') tags.push(`<script src="${joinBase(config.base, shimFile())}"></script>`)
        tags.push(importMapTag(importMapText(imports)))
        return injectBeforeFirstModule(html, tags)
      },
    },

    generateBundle: {
      order: 'post',
      handler(_o, bundle) {
        buildManifest = makeManifest(bundleImports(bundle as never))
        if (opts.manifest === false) return
        const fileName = typeof opts.manifest === 'string' ? opts.manifest : 'host-runtime.json'
        this.emitFile({ type: 'asset', fileName, source: `${JSON.stringify(buildManifest, null, 2)}\n` })
      },
    },
  }
  return plugin
}
