import type { UserConfig } from 'vite'
import { SHARED_SPECIFIERS } from './index.js'

export interface PluginUiConfigOptions {
  /** Library entry, relative to the plugin's Vite root, e.g. `src/index.tsx`. */
  entry: string
  /** Vite `build.target`. Omit for Vite's default; agent-mux-style string-named exports need `es2022`. */
  target?: string
  /** Externals beyond the shared React set, e.g. a host UI kit's specifiers. */
  extraExternals?: string[]
  /** Output file name. Default `index.js`. */
  fileName?: string
}

/**
 * The plugin-side build: an ES library that leaves the shared React specifiers
 * bare, so the browser resolves them through the host's import map. Add your
 * own `plugins` (e.g. `@vitejs/plugin-react`) around it.
 */
export function definePluginUiConfig(o: PluginUiConfigOptions): UserConfig {
  const fileName = o.fileName ?? 'index.js'
  return {
    build: {
      ...(o.target ? { target: o.target } : {}),
      lib: { entry: o.entry, formats: ['es'], fileName: () => fileName },
      rollupOptions: {
        external: [...SHARED_SPECIFIERS, ...(o.extraExternals ?? [])],
        output: {
          assetFileNames: (info: { name?: string }) =>
            info.name && info.name.endsWith('.css') ? 'style.css' : '[name][extname]',
        },
      },
      cssCodeSplit: false,
      sourcemap: true,
      emptyOutDir: true,
    },
  }
}
