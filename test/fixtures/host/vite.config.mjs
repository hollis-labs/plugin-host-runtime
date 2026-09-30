import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import { hostRuntime } from '@hollis-labs/plugin-host-runtime/vite'

const hr = hostRuntime({ shared: { '@fixture/ui': 'src/ui.js' } })
const csp = process.env.CSP || 'none' // none | self | hash
const outDir = process.env.OUT || 'dist'
const port = Number(process.env.PORT) || 5200

// A test-only plugin: sets the response CSP. `hash` allowlists the manifest's
// map hash the way a real host would after reading host-runtime.json.
function cspPlugin() {
  const header = (isDev) => {
    if (csp === 'none') return undefined
    if (csp === 'self') return "script-src 'self'"
    const hash = isDev
      ? hr.api.manifest().importMapSha256
      : JSON.parse(fs.readFileSync(path.resolve(outDir, 'host-runtime.json'), 'utf8')).importMapSha256
    return `script-src 'self' '${hash}'`
  }
  const mw = (isDev) => (server) => {
    const h = header(isDev)
    if (h) server.middlewares.use((_req, res, next) => (res.setHeader('Content-Security-Policy', h), next()))
  }
  return { name: 'test-csp', configureServer: mw(true), configurePreviewServer: mw(false) }
}

export default defineConfig({
  base: process.env.BASE || '/',
  plugins: [hr, cspPlugin()],
  server: { port, strictPort: true, host: 'localhost' },
  preview: { port, strictPort: true, host: 'localhost' },
  build: { outDir },
})
