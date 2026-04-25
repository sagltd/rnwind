/**
 * Fail-loud guards around each library's transform output. Every metric
 * test asserts the transformed code contains the library's expected
 * runtime wrapper before the timing loop starts — if a library upgrade
 * drops `createInteropElement` or renames `useStyles`, we fail the bench
 * instead of silently publishing numbers for a transform that no longer
 * fires.
 */

/**
 * Throw if `source` doesn't include every one of `required`. Each entry
 * in `required` is either a string (literal substring) or RegExp.
 * @param library Display name, baked into the error.
 * @param source Transformed source text.
 * @param required Substrings or regexes that MUST be present.
 */
export function assertTransformOutput(library: string, source: string, required: readonly (string | RegExp)[]): void {
  const missing: string[] = []
  for (const needle of required) {
    if (typeof needle === 'string') {
      if (!source.includes(needle)) missing.push(needle)
    } else if (!needle.test(source)) {
      missing.push(needle.toString())
    }
  }
  if (missing.length === 0) return
  const preview = source.length > 400 ? `${source.slice(0, 400)}…` : source
  throw new Error(
    `${library}: transform output missing expected wrapper(s): ${missing.join(', ')}\n` +
      `--- transformed source (first 400 chars) ---\n${preview}`,
  )
}
