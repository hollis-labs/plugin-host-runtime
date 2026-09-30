import * as React from 'react'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { tag } from './ui.js'
import { hostImportModule, verifyHostRuntime } from '@hollis-labs/plugin-host-runtime/browser'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const url = (name) => new URL(`${import.meta.env.BASE_URL}plugins/${name}/index.js`, document.baseURI).href
const errInfo = (e) => ({ name: e?.name, code: e?.code, specifier: e?.specifier, message: String(e?.message) })

async function main() {
const result = { verify: verifyHostRuntime(), hostHasViewTransition: 'ViewTransition' in React }
const violations = []
document.addEventListener('securitypolicyviolation', (e) => violations.push(e.violatedDirective))

try {
  const mod = await hostImportModule(url('counter'))
  const identity =
    mod.getReact().useState === React.useState && mod.getReact().createElement === React.createElement
  createRoot(document.getElementById('root')).render(createElement(mod.Counter))
  await wait(300)
  const btn = document.getElementById('plugin-btn')
  const rendered = btn?.textContent
  btn?.click()
  await wait(150)
  result.counter = { identity, rendered, afterClick: document.getElementById('plugin-btn')?.textContent }
} catch (e) {
  result.counter = { error: errInfo(e) }
}

try {
  const mod = await hostImportModule(url('vt'))
  result.vt = { kind: mod.kind, hasState: mod.hasState }
} catch (e) {
  result.vt = { error: errInfo(e) }
}

try {
  const mod = await hostImportModule(url('shared'))
  result.shared = { identity: mod.getTag() === tag(), label: mod.seenLabel }
} catch (e) {
  result.shared = { error: errInfo(e) }
}

try {
  await hostImportModule(url('unmapped'))
  result.unmapped = { error: null }
} catch (e) {
  result.unmapped = { error: errInfo(e) }
}

result.violations = violations
document.body.setAttribute('data-result', JSON.stringify(result))
}

main()
