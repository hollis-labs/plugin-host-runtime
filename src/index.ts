/**
 * The specifiers every runtime-loaded plugin bundle is built to leave bare
 * (`external`) and every host must therefore map. One list, so the host
 * plugin, the plugin-side build config and the browser preflight cannot drift
 * apart the way six hand-copied lists did.
 */
export const SHARED_SPECIFIERS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
] as const

/** Mapped only when a host opts in through `extras` (D4: default off). */
export const OPTIONAL_SPECIFIERS = ['react/jsx-dev-runtime'] as const

/**
 * What a build knows about the import map it emitted. `importMapSha256` is the
 * CSP source expression (`sha256-<base64>`) of the exact text inside the
 * inline `<script type="importmap">`, so a host can allowlist it.
 */
export interface HostRuntimeManifest {
  importMap: { imports: Record<string, string> }
  importMapSha256: string
  /** Installed versions of the packages mapped, e.g. `{ react: "19.3.0" }`. */
  provided: Record<string, string>
}
