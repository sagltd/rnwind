/** Whitespace run splitter — hoisted so the runtime hot path doesn't recreate it per call. */
const WHITESPACE = /\s+/

/**
 * Normalize a className for molecule keying: trim, collapse runs of
 * whitespace, and drop exact-duplicate tokens — but PRESERVE ORDER.
 * Tailwind is last-wins for conflicting utilities (`p-4 p-2` ≠ `p-2 p-4`),
 * so sorting would corrupt the merge. Build-time (molecule keys) and
 * runtime (lookup) call the identical function so their keys always match.
 * @param className Raw className string.
 * @returns Normalized, order-preserving className.
 */
export function normalizeClassName(className: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const token of className.trim().split(WHITESPACE)) {
    if (token.length === 0 || seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }
  return out.join(' ')
}
