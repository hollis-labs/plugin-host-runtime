# plugin-host-runtime

`@hollis-labs/plugin-host-runtime` gives runtime-loaded plugin UIs one shared
React: a Vite plugin that emits the host's import map, a plugin-side build
config that leaves `react`, `react-dom`, `react-dom/client` and
`react/jsx-runtime` bare, and a browser preflight. It is not a UI kit, a slot
or outlet renderer, an app shell, or a plugin registry — it composes with
`@hollis-labs/plugin-registry` but does not depend on it.

## Start Here

- `README.md` — usage, entry points, CSP notes, the compatibility matrix and the
  known-limitations list.
- `src/index.ts` — shared specifier constants and the `HostRuntimeManifest` type.
- `src/vite.ts` — `hostRuntime()`, the host-side Vite plugin.
- `src/build.ts` — `definePluginUiConfig()`, the plugin-side lib config.
- `src/browser.ts` — `verifyHostRuntime`, `hostImportModule`, `HostRuntimeError`,
  `checkRuntime`.
- `src/internal/` — export enumeration, import-map construction, error
  translation and the small semver subset `checkRuntime` uses.
- `test/runtime.test.js` runs against the built `dist/`; `scripts/matrix.mjs` is
  the real-browser matrix.
- `.github/workflows/ci.yml` — the CI gate (`gate` and `browser-matrix`).

## Commands

```bash
npm ci
npm run typecheck
npm test              # builds, then unit tests against dist/
npm run test:matrix   # real-browser matrix; needs CHROME_PATH and network
```

`test:matrix` exits 3 ("examined nothing") without a browser — never 0. It
packs the package under `.matrix/` (git-ignored) and installs it into scratch
hosts.

## Boundaries

- Do not run `npm publish` here. Publishing is a manual step done by the owner of
  the `@hollis-labs` npm scope; CI gates and never publishes. `docs/RELEASING.md`
  is the runbook — follow it rather than improvising a release.
- `dist/` is build output and is git-ignored; `npm test` rebuilds it. Do not
  commit it, and do not emit source maps or declaration maps: they pointed at
  `../src`, which the published tarball does not ship.
- The four shared specifiers must stay bare in plugin bundles and mapped by the
  host's import map. Changing `SHARED_SPECIFIERS` changes the contract between
  every host and every plugin build.
- The import map is an inline script, so it needs a CSP hash; the hash comes from
  `host-runtime.json` (`importMapSha256`). Do not move the map into an external
  file.
- The supported Vite range (`>=5.4 <9`) is what the browser matrix proves. Widen
  it only by extending the matrix.
- The README states what was and was not verified (Chrome only; the original
  source was read, not run). Keep claims in step with what the tests measure.
- No `file:`, `link:` or `workspace:` dependencies in `package.json`.

Open a pull request for changes; a maintainer will review it.
