import { createHash } from 'node:crypto'

/**
 * Join Vite's `base` and a root-relative file name into the URL written to the
 * import map. `base` may be `/`, `/sub/`, `./`, `''` (relative) or an absolute
 * URL prefix; a missing trailing slash is tolerated.
 */
export function joinBase(base: string, file: string): string {
  const f = file.replace(/^\/+/, '')
  if (base === '' || base === './') return `./${f}`
  return `${base.endsWith('/') ? base : `${base}/`}${f}`
}

export function importMapText(imports: Record<string, string>): string {
  return JSON.stringify({ imports })
}

/** CSP hash source for exact inline script text. */
export function sha256Source(text: string): string {
  return `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`
}

export function importMapTag(text: string): string {
  return `<script type="importmap">${text}</script>`
}

const MODULE_SCRIPT = /<script\b[^>]*\btype=["']module["'][^>]*>/i

/**
 * Insert `tags` before the first module script (so the map and shim are active
 * before anything imports), or before `</head>` when the page has none.
 */
export function injectBeforeFirstModule(html: string, tags: string[]): string {
  const block = tags.join('\n    ')
  const m = MODULE_SCRIPT.exec(html)
  if (m) return `${html.slice(0, m.index)}${block}\n    ${html.slice(m.index)}`
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `    ${block}\n  </head>`)
  return `${block}\n${html}`
}
