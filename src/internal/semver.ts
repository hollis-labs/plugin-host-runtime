interface Semver {
  major: number
  minor: number
  patch: number
}

function parse(s: string): Semver | string {
  const parts = s.split('.')
  if (parts.length !== 3) return `expected MAJOR.MINOR.PATCH, got "${s}"`
  const n = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN))
  if (n.some((x) => Number.isNaN(x))) return `non-numeric component in "${s}"`
  return { major: n[0]!, minor: n[1]!, patch: n[2]! }
}

const gte = (a: Semver, b: Semver) =>
  a.major !== b.major ? a.major > b.major : a.minor !== b.minor ? a.minor > b.minor : a.patch >= b.patch

/**
 * `X.Y.Z`, `^X.Y.Z`, `~X.Y.Z`: the same subset as Nanite's `shadcn_version.go`.
 * Caret is same-major and >=, even below 1.0.0 (npm's stricter 0.x caret is not
 * modelled). Returns a reason string when unsatisfied or unparseable.
 */
export function satisfiesRange(range: string, version: string): string | undefined {
  const r = range.trim()
  const op = r.startsWith('^') ? '^' : r.startsWith('~') ? '~' : '='
  const want = parse(op === '=' ? r : r.slice(1).trim())
  if (typeof want === 'string') return `range "${range}": ${want} (supported: X.Y.Z, ^X.Y.Z, ~X.Y.Z)`
  const have = parse(version.trim())
  if (typeof have === 'string') return `provided version "${version}": ${have}`
  const ok =
    op === '='
      ? have.major === want.major && have.minor === want.minor && have.patch === want.patch
      : op === '^'
        ? have.major === want.major && gte(have, want)
        : have.major === want.major && have.minor === want.minor && gte(have, want)
  return ok ? undefined : `host provides ${version}, which does not satisfy "${range}"`
}
