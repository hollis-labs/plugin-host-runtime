import { defineConfig, mergeConfig } from 'vite'
import { definePluginUiConfig } from '@hollis-labs/plugin-host-runtime/build'

const name = process.env.PLUGIN
export default defineConfig(
  mergeConfig(
    definePluginUiConfig({
      entry: `src/${name}.jsx`,
      extraExternals: name === 'unmapped' ? ['not-a-shared-package'] : name === 'shared' ? ['@fixture/ui'] : [],
    }),
    {
      esbuild: { jsx: 'automatic' },
      build: { outDir: `dist/${name}` },
    },
  ),
)
