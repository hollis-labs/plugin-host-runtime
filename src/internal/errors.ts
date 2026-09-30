export type HostRuntimeErrorCode = 'import-map-missing' | 'specifier-unmapped' | 'load-failed'

export class HostRuntimeError extends Error {
  code: HostRuntimeErrorCode
  /** The unresolved bare specifier, when the browser named one. */
  specifier?: string

  constructor(code: HostRuntimeErrorCode, message: string, options?: { cause?: unknown; specifier?: string }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'HostRuntimeError'
    this.code = code
    if (options?.specifier !== undefined) this.specifier = options.specifier
  }
}

// Chrome:  Failed to resolve module specifier "react"
// Firefox: Error resolving module specifier “react”
// Safari:  Module name, 'react' does not resolve to a valid URL.
// Only Chrome's wording has been observed by this package's tests.
const UNRESOLVED: RegExp[] = [
  /Failed to resolve module specifier ["'“]([^"'”]+)["'”]/,
  /Error resolving module specifier ["'“]([^"'”]+)["'”]/,
  /Module name,? ["']([^"']+)["'] does not resolve to a valid URL/,
]

/** Turn a dynamic-import failure into a `HostRuntimeError`. `hasImportMap` says whether the page has one. */
export function translateImportError(err: unknown, url: string, hasImportMap: boolean): HostRuntimeError {
  if (err instanceof HostRuntimeError) return err
  const message = err instanceof Error ? err.message : String(err)
  for (const re of UNRESOLVED) {
    const m = re.exec(message)
    if (m) {
      const specifier = m[1]!
      return hasImportMap
        ? new HostRuntimeError(
            'specifier-unmapped',
            `Plugin bundle ${url} imports "${specifier}", which the host import map does not map.`,
            { cause: err, specifier },
          )
        : new HostRuntimeError(
            'import-map-missing',
            `Plugin bundle ${url} imports "${specifier}" but this page has no import map. The host must ship one (see hostRuntime()).`,
            { cause: err, specifier },
          )
    }
  }
  return new HostRuntimeError('load-failed', `Failed to load plugin bundle ${url}: ${message}`, { cause: err })
}
