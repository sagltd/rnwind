import { describe, expect, it } from 'bun:test'
import { classifyAllClasses, loadAllUtilityClasses } from '../../_support/utility-enum'

/**
 * The exhaustive safety net: EVERY Tailwind v4 utility (the full
 * `getClassList()` surface, 22k+ classes) is resolved through the real parser
 * and must land in one of two clean buckets —
 *   - supported  → ≥1 RN style entry, every value RN-renderable, or
 *   - dropped    → no atom (intentionally unsupported web-only utility).
 * A class that resolves but leaks an unrenderable value (`var(`, `calc(`,
 * NaN/Infinity, a CSS grammar placeholder) lands in `dirty` and fails here
 * with the offending class + reason. This is what stops a new Tailwind release
 * — or a parser regression — from shipping a class that crashes RN.
 */
describe('exhaustive utility coverage', () => {
  it('every Tailwind utility resolves to an RN-renderable value or is cleanly dropped', async () => {
    const classes = await loadAllUtilityClasses()
    expect(classes.length).toBeGreaterThan(10_000)

    const { supported, dropped, dirty } = await classifyAllClasses(classes)

    // The whole point: zero leaks. Failure prints the first 50 offenders.
    expect(dirty, `dirty utilities (${dirty.length}):\n${dirty.slice(0, 50).join('\n')}`).toEqual([])

    // Buckets partition the input exactly (no class silently lost).
    expect(supported.length + dropped.length).toBe(classes.length)
    // Regression floor: the supported surface must not silently collapse.
    expect(supported.length).toBeGreaterThan(8000)
  }, 60_000)
})
