/**
 * Text-truncate atom detector.
 *
 * React Native's `<Text>` exposes two props that cover every case
 * Tailwind's text-truncation utilities express:
 *
 *   numberOfLines   — clamp after N lines (1 for single-line ellipsis)
 *   ellipsizeMode   — 'tail' (ellipsis) or 'clip' at the truncation point
 *
 * rnwind treats the Tailwind classes as **metadata**: the transformer
 * strips the truncate atoms from the JSX site's className and emits
 * `numberOfLines={N}` / `ellipsizeMode="tail"` props on the element.
 *
 * Covered atoms:
 *   truncate              → { numberOfLines: 1, ellipsizeMode: 'tail' }
 *   text-ellipsis         → { ellipsizeMode: 'tail' }
 *   text-clip             → { ellipsizeMode: 'clip' }
 *   line-clamp-<N>        → { numberOfLines: <N> }
 *   line-clamp-none       → { numberOfLines: 0 }   (reset — overrides prior)
 *
 * Detection is pure name matching — no CSS inspection — because every
 * relevant piece of data lives in the class name itself.
 */

/** Text-truncate metadata produced by a single atom. */
export interface TextTruncateInfo {
  readonly numberOfLines?: number
  readonly ellipsizeMode?: 'tail' | 'clip'
}

/** Regex matching `line-clamp-<N>` with a positive-integer N. */
const LINE_CLAMP_RE = /^line-clamp-(\d+)$/
/** Regex matching Tailwind v4's `line-clamp-[<value>]` arbitrary form. */
const LINE_CLAMP_ARBITRARY_RE = /^line-clamp-\[([^\]]+)\]$/

/**
 * Inspect one class-name token and return the text-truncate metadata it
 * contributes, or `null` when the atom isn't a truncate utility.
 * @param atom Single class-name token (no variant prefix).
 * @returns The atom's contribution, or null.
 */
function detectTextTruncate(atom: string): TextTruncateInfo | null {
  if (atom === 'truncate') return { numberOfLines: 1, ellipsizeMode: 'tail' }
  if (atom === 'text-ellipsis') return { ellipsizeMode: 'tail' }
  if (atom === 'text-clip') return { ellipsizeMode: 'clip' }
  if (atom === 'line-clamp-none') return { numberOfLines: 0 }
  const numeric = LINE_CLAMP_RE.exec(atom)
  if (numeric) return { numberOfLines: Number(numeric[1]) }
  const arbitrary = LINE_CLAMP_ARBITRARY_RE.exec(atom)
  if (arbitrary) {
    const n = Number.parseInt(arbitrary[1]!, 10)
    if (Number.isFinite(n) && n >= 0) return { numberOfLines: n }
  }
  return null
}

/**
 * Fast pre-check — returns true when ANY atom in the list could be a
 * truncate utility, false when none can. Lets callers skip the
 * allocation of the merge pass for the common "no truncate" case.
 * @param atoms Tokenised atom list from a literal className.
 * @returns Whether to run the full per-atom detection.
 */
function mayContainTextTruncate(atoms: readonly string[]): boolean {
  for (const atom of atoms) {
    if (
      atom === 'truncate' ||
      atom === 'text-ellipsis' ||
      atom === 'text-clip' ||
      atom === 'line-clamp-none' ||
      atom.startsWith('line-clamp-')
    ) {
      return true
    }
  }
  return false
}

export { detectTextTruncate, mayContainTextTruncate }
