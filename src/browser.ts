import { SHARED_SPECIFIERS } from './index.js'
import { HostRuntimeError, translateImportError } from './internal/errors.js'
import { satisfiesRange } from './internal/semver.js'

export { HostRuntimeError }

function readImports(doc: Document): Record<string, string> | undefined {
  let found = false
  const merged: Record<string, string> = {}
  for (const s of Array.from(doc.querySelectorAll('script[type="importmap"]'))) {
    found = true
    try {
      const parsed = JSON.parse(s.textContent ?? '') as { imports?: Record<string, string> }
      Object.assign(merged, parsed.imports ?? {})
    } catch {
      /* an unparseable map maps nothing */
    }
  }
  return found ? merged : undefined
}

/**
 * Is the page's import map present, and does it map every required specifier?
 * Pure inspection of the document; imports nothing.
 */
export function verifyHostRuntime(opts: { document?: Document; required?: readonly string[] } = {}): {
  ok: boolean
  missing: string[]
} {
  const required = opts.required ?? SHARED_SPECIFIERS
  const doc = opts.document ?? (typeof document === 'undefined' ? undefined : document)
  const imports = doc ? readImports(doc) : undefined
  const missing = required.filter((s) => !imports || !(s in imports))
  return { ok: missing.length === 0, missing }
}

/**
 * Drop-in for plugin-registry's `importModule` option. Imports the bundle and
 * turns the browser's unresolved-specifier TypeError into a `HostRuntimeError`
 * that says which specifier and whether the page has an import map at all.
 */
export async function hostImportModule(url: string): Promise<Record<string, unknown>> {
  try {
    return (await import(/* @vite-ignore */ url)) as Record<string, unknown>
  } catch (err) {
    const doc = typeof document === 'undefined' ? undefined : document
    throw translateImportError(err, url, doc ? readImports(doc) !== undefined : false)
  }
}

/**
 * Opt-in compatibility check between a bundle's declared runtime (the
 * registry's `runtime: {name, version}`) and what the host provides (the
 * manifest's `provided`). Grammar: `X.Y.Z`, `^X.Y.Z`, `~X.Y.Z`. Nothing calls
 * this for you: enforcing a declared runtime at load is an open decision.
 */
export function checkRuntime(
  declared: { name: string; version: string } | undefined,
  provided: Record<string, string>,
): { ok: boolean; reason?: string } {
  if (!declared) return { ok: true }
  const have = provided[declared.name]
  if (have === undefined) return { ok: false, reason: `host does not provide "${declared.name}"` }
  const reason = satisfiesRange(declared.version, have)
  return reason === undefined ? { ok: true } : { ok: false, reason }
}
