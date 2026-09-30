# Changelog

## Unreleased

Initial extraction; not published, not tagged.

- `hostRuntime()` Vite plugin: import map and es-module-shims tag injected using `base`, React and react-dom shims generated as virtual modules from the installed packages (union of production and development keys), host entries added to the build with strict signatures, `host-runtime.json` manifest with the map's sha256.
- `definePluginUiConfig()`: the plugin-side lib config with the shared specifiers external.
- `verifyHostRuntime()`, `hostImportModule()`, `HostRuntimeError`, `checkRuntime()`.
- Lifted from Flux's `hostImportmapPlugin` by reading; the original was not run. See the README.
- Real-browser matrix over Vite 5.4.21, 6.4.3, 7.3.1 and 8.3.1.
- Source maps and declaration maps are not emitted: they pointed at `../src`, which the tarball does not ship.
