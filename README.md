# @hollis-labs/plugin-host-runtime

One shared React for plugin UIs that are loaded at runtime. A host builds with one
Vite plugin that emits an import map pointing `react`, `react-dom`,
`react-dom/client` and `react/jsx-runtime` at the host's own copy; plugin bundles are
built with those four left bare. The browser then resolves the plugin's `import 'react'`
to the host's React, so hooks, context and state are shared instead of duplicated.

It composes with [`@hollis-labs/plugin-registry`](https://github.com/hollis-labs/plugin-sdk)
(which fetches and imports bundles and deliberately does not decide how a bundle
gets its React) but does not depend on it.

## Status

**Pre-release.** This project is unreleased, not deployed, and has no outside consumers. It's being built in the open: the code, the docs, and this README describe what exists today, not a pitch for what's planned. Interfaces and behavior change without notice, and there are no compatibility guarantees yet.

See [CHANGELOG.md](./CHANGELOG.md) for what has changed.

## Install

```sh
npm install @hollis-labs/plugin-host-runtime
```

Vite is a peer dependency of `/vite` and `/build`; `/`, `/browser` need nothing.

## Use

Host (`vite.config.ts`):

```ts
import { defineConfig } from 'vite'
import { hostRuntime } from '@hollis-labs/plugin-host-runtime/vite'

export default defineConfig({
  base: '/sysop/',
  plugins: [
    hostRuntime({
      // Optional: anything else plugins should share with the host.
      shared: { '@acme/ui/button': 'src/host/button.ts' },
    }),
  ],
})
```

A production build writes the shim tag and the import map into `index.html` using
Vite's `base`, and `host-runtime.json` next to it (map, its CSP hash, and the
installed React versions).

Plugin (`vite.config.ts`):

```ts
import { defineConfig, mergeConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { definePluginUiConfig } from '@hollis-labs/plugin-host-runtime/build'

export default defineConfig(
  mergeConfig(definePluginUiConfig({ entry: 'src/index.tsx', extraExternals: ['@acme/ui/button'] }), {
    plugins: [react()],
  }),
)
```

In the browser, with `@hollis-labs/plugin-registry`:

```ts
import { createPluginRegistry } from '@hollis-labs/plugin-registry'
import { hostImportModule, verifyHostRuntime } from '@hollis-labs/plugin-host-runtime/browser'

const boot = verifyHostRuntime()
if (!boot.ok) console.warn('host import map is missing', boot.missing)

const registry = createPluginRegistry({ importModule: hostImportModule })
```

`hostImportModule` is a plain `(url) => Promise<module>`; a failed import surfaces as a
`HostRuntimeError` whose `code` is `import-map-missing`, `specifier-unmapped` or
`load-failed`, with the unresolved specifier when the browser names one.

### Entry points

| Entry | Exports |
|---|---|
| `.` | `SHARED_SPECIFIERS`, `OPTIONAL_SPECIFIERS`, `HostRuntimeManifest` |
| `./vite` | `hostRuntime(options)`, `HostRuntimeOptions`, `HostRuntimeApi` |
| `./build` | `definePluginUiConfig(options)` |
| `./browser` | `HostRuntimeError`, `verifyHostRuntime`, `hostImportModule`, `checkRuntime` |

### CSP

An import map is an inline script and cannot be an external file. Under a strict
`script-src` it is refused, and a plugin fails with
`Failed to resolve module specifier "react/jsx-runtime"` (surfaced as
`specifier-unmapped`). The map changes on every build because chunk names are
hashed, so allowlist the hash from `host-runtime.json` (`importMapSha256`, already
in `sha256-<base64>` form) when serving. In dev, `plugin.api.manifest()` carries the
same field; the dev map has no hashed names, so its hash is stable for a given
`base` and root. es-module-shims' own inline scripts may still be blocked under a
strict policy; on Chrome the load succeeded anyway (see below). A host that does
not want the shim passes `shims: false`.

## What was lifted, and how it was checked

The seed is the `hostImportmapPlugin` in Flux's `vite.config.ts` (`apps/flux`), plus
its four hand-kept `src/_host/react*.ts` shims and the lib config that three Nanite
plugin UIs copy. **Read, not run:** those files were transcribed from reading; the
original Flux app was not built or run for this package, so no behavioral equivalence
with Flux is claimed. The hook set and ordering (`transformIndexHtml` post, `buildStart`
pre, `emitFile`, `preserveEntrySignatures: 'strict'`, entry-chunk lookup by `name`)
were kept. Changed on purpose: `base` is honoured, shims are generated from the
installed packages instead of kept by hand, `input` is set from the plugin, and a
manifest with the map's sha256 is emitted.

What is measured by this repository's own tests: the matrix below, run in real
Chrome, and unit tests against `dist/`. Nothing else is asserted.

## Compatibility

Supported Vite range is what the browser matrix proves: **5.4.21, 6.4.3, 7.3.1 and
8.3.1** (the last uses Rolldown), each in build+preview and dev, at `base` `/` and
`/sysop/` (and `./` for build), with no CSP, with `script-src 'self'` plus the
manifest hash, and with bare `script-src 'self'` as a negative control that must fail.
Browser: Chrome only (154 when last run). Firefox and Safari are **not tested**; the
Firefox and Safari wordings in the `HostRuntimeError` translation are from general
knowledge, not from an observed failure. The package declares `vite >=5.4 <9` and
Vite 6 is covered only at 6.4.3. Host React is whichever 19.x is installed (19.3.0
when last run); plugin bundles in the matrix were built against React 18.

The `checkRuntime` range grammar is `X.Y.Z`, `^X.Y.Z` and `~X.Y.Z`, the same subset as
Nanite's `shadcn_version.go`; caret means same-major and at-least, including below 1.0.0.

## Known limitations

- Vite's `experimental.renderBuiltUrl` is not consulted; the map is `base` plus the emitted file name.
- A relative `base` (`./`, `''`) is written as `./assets/...` in the map; dev servers treat a relative base as `/`, and the matrix does not cover dev at `./`.
- Only `build.rollupOptions.input` is set; Vite 8 also has `rolldownOptions`, and the matrix shows `rollupOptions` still honoured there. Library-mode builds (`build.lib`) are left untouched.
- The shim is not injected in dev (native import maps only), matching Flux.
- Under a strict CSP, es-module-shims' own inline scripts are refused. Loading still succeeded in the Chrome runs; whether that holds in other browsers is untested.
- Exports are enumerated at build time in two child Node processes (`NODE_ENV=production` and `development`). Names that are not plain identifiers, `__`-prefixed names, and a `default` key are skipped.
- No dedupe or version check across the host and plugins is done; `checkRuntime` exists and nothing calls it.
- The `hostImportModule` error translation was observed in Chrome only.
- The registry integration is exercised only when a `@hollis-labs/plugin-registry` tarball is provided (see below); it is not skipped silently, the runner says so.

## Out of scope

- Any UI kit or component set for plugins. `shared` lets a host expose one; none is baked in.
- Slot, outlet or contribution rendering.
- A Tachyon (or any) app shell, and serving plugin bundles from a host's server.
- Deciding whether a declared runtime is enforced at load. `checkRuntime` is opt-in and unwired.
- Adopting this package in Flux, Tangent, Tachyon, the plugin UIs or the scaffolds.
- Publishing.

## Development

```sh
npm ci
npm run typecheck
npm test            # builds, then unit tests against dist/
npm run test:matrix # real-browser matrix; needs CHROME_PATH and network
```

`test:matrix` packs this package into a tarball under `.matrix/` (git-ignored) and
installs it into scratch hosts; nothing local is written into `package.json`. Without a
browser it exits 3 ("examined nothing"), never 0. To include the registry integration:

```sh
REGISTRY_TARBALL=/path/to/hollis-labs-plugin-registry-0.1.0.tgz CHROME_PATH=... npm run test:matrix
```

Release steps: [docs/RELEASING.md](./docs/RELEASING.md).

## License

MIT. See [LICENSE](./LICENSE).
