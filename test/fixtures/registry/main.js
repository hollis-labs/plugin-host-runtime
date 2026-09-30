// Drives plugin-registry with hostImportModule against a registry response
// naming the fixture plugin. Dev-only: plugin-registry comes from a tarball.
import * as React from 'react'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createPluginRegistry } from '@hollis-labs/plugin-registry'
import { hostImportModule } from '@hollis-labs/plugin-host-runtime/browser'

async function main() {
  const bundle = new URL(`${import.meta.env.BASE_URL}plugins/counter/index.js`, document.baseURI).href
  const missing = new URL(`${import.meta.env.BASE_URL}plugins/unmapped/index.js`, document.baseURI).href
  const registry = createPluginRegistry({ importModule: hostImportModule, stylesheets: false })
  const result = {}
  try {
    await registry.sync({
      protocol: 1,
      plugins: {
        counter: { bundle_url: bundle, bundle_version: '1' },
        broken: { bundle_url: missing, bundle_version: '1' },
      },
      contributions: {
        widget: {
          counter: { plugin_id: 'counter', export: 'Counter' },
          broken: { plugin_id: 'broken', export: 'value' },
        },
      },
    })
    const c = registry.get('widget', 'counter')
    createRoot(document.getElementById('root')).render(createElement(c.value))
    await new Promise((r) => setTimeout(r, 300))
    const btn = document.getElementById('plugin-btn')
    const rendered = btn?.textContent
    btn?.click()
    await new Promise((r) => setTimeout(r, 150))
    result.counter = { rendered, afterClick: document.getElementById('plugin-btn')?.textContent, hasReact: !!React.useState }
    result.errors = registry.errors().map((e) => ({ plugin: e.pluginId, reason: e.reason }))
  } catch (e) {
    result.fatal = String(e?.message ?? e)
  }
  document.body.setAttribute('data-result', JSON.stringify(result))
}
main()
