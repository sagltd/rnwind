/**
 * Yield every literal-text segment found at a `className=` site.
 * @param source Raw source text.
 * @yields Each literal's inner text.
 */
function* iterateClassNameLiterals(source: string): Iterable<string> {
  // className="..."  /  className='...'
  for (const match of source.matchAll(/className\s*=\s*"([^"]*)"/g)) yield match[1] ?? ''
  for (const match of source.matchAll(/className\s*=\s*'([^']*)'/g)) yield match[1] ?? ''
  // className={"..."}  /  className={'...'}
  for (const match of source.matchAll(/className\s*=\s*\{\s*"([^"]*)"\s*\}/g)) yield match[1] ?? ''
  for (const match of source.matchAll(/className\s*=\s*\{\s*'([^']*)'\s*\}/g)) yield match[1] ?? ''
  // className={`...`} — yield each static quasi between `${...}` substitutions.
  for (const match of source.matchAll(/className\s*=\s*\{\s*`([^`]*)`\s*\}/g)) {
    const body = match[1] ?? ''
    for (const part of body.split(/\$\{[^}]*\}/)) yield part
  }
}

/**
 * Pull every `className="…"`, `className={'…'}`, `className={"…"}`, and
 * `className={\`…\`}` literal out of the source and union their
 * whitespace-separated tokens. A regex-based scan is enough — the
 * warning is best-effort, not load-bearing, and a regex sidesteps
 * having to re-parse the file.
 *
 * Skipped on purpose:
 *  - `className={someExpression}` with no inline literal (we can't
 *    introspect the runtime value at build time).
 *  - Template literals with substitutions (`` `text-${size}` ``) — we
 *    only union the static-quasi parts, which is fine because the
 *    warning fires only on candidates that ARE in the static parts.
 * @param source Raw source text.
 * @returns Set of whitespace-separated tokens drawn from every literal.
 */
function collectClassNameTokens(source: string): Set<string> {
  const out = new Set<string>()
  for (const literal of iterateClassNameLiterals(source)) {
    for (const token of literal.split(/\s+/)) {
      if (token.length > 0) out.add(token)
    }
  }
  return out
}

/**
 * Filter Tailwind candidate strings down to ones that actually appear
 * as a token inside a `className="…"` literal in the source. Oxide
 * scans the entire file and surfaces anything Tailwind-shaped — that
 * includes import specifiers (`'expo-router'`), comment markers
 * (`/* @rnwind-theme=… *\/`), JSX prop values (`keyboardType="email-
 * address"`), and bare suffixes Tailwind splits out from compound
 * utilities (`bg-sky-500` also produces `sky-500`). None of those are
 * "unknown classes" worth nagging the user about; the genuine signal
 * is a typo in a real `className`, e.g. `bg-srface` for `bg-surface`.
 *
 * The filter walks every `className="…" / {'…'} / {`…`}` literal in the
 * source, splits each on whitespace, and unions the tokens. Only
 * candidates in that token set survive. Then known-good atoms are
 * subtracted, leaving genuine typos.
 * @param source Raw source text the transformer received from Metro.
 * @param candidates Every candidate oxide picked up.
 * @param atoms Set of atom names the parser successfully resolved.
 * @returns Candidates that look like real "unknown classes" the user typed.
 */
export function filterUnknownClassCandidates(
  source: string,
  candidates: readonly string[],
  atoms: ReadonlySet<string>,
): string[] {
  const literalTokens = collectClassNameTokens(source)
  const out: string[] = []
  for (const candidate of candidates) {
    if (atoms.has(candidate)) continue
    if (!literalTokens.has(candidate)) continue
    out.push(candidate)
  }
  return out
}
