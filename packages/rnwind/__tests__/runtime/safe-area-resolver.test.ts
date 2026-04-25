import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { __registerAtomsFromRecord, __resetLookupCssState, lookupCss, setWindowHeightProvider } from '../../src/runtime/lookup-css'
import { ctx } from './_ctx'

let warnSpy: ReturnType<typeof spyOn> | null = null

beforeEach(() => {
  // Several tests intentionally pass zero-insets to exercise the
  // `or`/offset fallback logic. The runtime emits a one-shot dev
  // warning in that case — useful for real apps, noise in this suite.
  warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
})

/**
 * Runtime contract for `*-safe` atoms. The build emits each safe atom
 * with a `{__safeStyle: [[cssKey, sideTag, or, offset], ...]}` envelope
 * (precomputed at build time so the runtime never has to scan property
 * keys). The runtime detects the envelope via a single property check
 * and resolves the spec array against the live `insets`.
 */

afterEach(() => {
  __resetLookupCssState()
  warnSpy?.mockRestore()
  warnSpy = null
})

describe('safe-area runtime resolver', () => {
  it('resolves a single-side marker against the matching inset', () => {
    __registerAtomsFromRecord({ 'pt-safe': { __safeStyle: [['paddingTop', 't', undefined, undefined]] } })
    const result = lookupCss('pt-safe', ctx('base', { insets: { top: 47, right: 0, bottom: 0, left: 0 } }))
    expect(result).toEqual([{ paddingTop: 47 }])
  })

  it('falls back to 0 for unknown side tags (defensive — build never emits these)', () => {
    // Side tag `'x'` isn't one of t/r/b/l. Real builds can't produce it,
    // but the runtime guards so a future build-format mismatch doesn't
    // crash on a property read of `undefined`.
    __registerAtomsFromRecord({ 'p-broken': { __safeStyle: [['paddingTop', 'x', undefined, undefined]] } })
    expect(lookupCss('p-broken', ctx('base', { insets: { top: 47, right: 0, bottom: 0, left: 0 } }))).toEqual([
      { paddingTop: 0 },
    ])
  })

  it('applies the or fallback when inset is smaller than the threshold', () => {
    __registerAtomsFromRecord({ 'pt-safe-or-4': { __safeStyle: [['paddingTop', 't', 16, undefined]] } })
    expect(lookupCss('pt-safe-or-4', ctx('base', { insets: { top: 0, right: 0, bottom: 0, left: 0 } }))).toEqual([
      { paddingTop: 16 },
    ])
    expect(lookupCss('pt-safe-or-4', ctx('base', { insets: { top: 47, right: 0, bottom: 0, left: 0 } }))).toEqual([
      { paddingTop: 47 },
    ])
  })

  it('stacks the offset on top of the inset', () => {
    __registerAtomsFromRecord({ 'pt-safe-offset-4': { __safeStyle: [['paddingTop', 't', undefined, 16]] } })
    expect(lookupCss('pt-safe-offset-4', ctx('base', { insets: { top: 47, right: 0, bottom: 0, left: 0 } }))).toEqual([
      { paddingTop: 63 },
    ])
  })

  it('handles the shorthand form with multiple markers in one atom', () => {
    __registerAtomsFromRecord({
      'p-safe': {
        __safeStyle: [
          ['paddingTop', 't', undefined, undefined],
          ['paddingRight', 'r', undefined, undefined],
          ['paddingBottom', 'b', undefined, undefined],
          ['paddingLeft', 'l', undefined, undefined],
        ],
      },
    })
    const result = lookupCss('p-safe', ctx('base', { insets: { top: 47, right: 8, bottom: 34, left: 8 } }))
    expect(result).toEqual([{ paddingTop: 47, paddingRight: 8, paddingBottom: 34, paddingLeft: 8 }])
  })

  it('uses the window height provider for screen-minus-y', () => {
    __registerAtomsFromRecord({ 'h-screen-safe': { __safeStyle: [['height', 'screen-minus-y', undefined, undefined]] } })
    setWindowHeightProvider(() => 844)
    expect(lookupCss('h-screen-safe', ctx('base', { insets: { top: 47, right: 0, bottom: 34, left: 0 } }))).toEqual([
      { height: 763 },
    ])
  })

  it('falls back to 0 on screen-minus-y when no window height provider is set', () => {
    __registerAtomsFromRecord({ 'h-screen-safe': { __safeStyle: [['height', 'screen-minus-y', undefined, undefined]] } })
    expect(lookupCss('h-screen-safe', ctx('base', { insets: { top: 47, right: 0, bottom: 34, left: 0 } }))).toEqual([
      { height: 0 },
    ])
  })

  it('treats undefined insets as zero on every side', () => {
    __registerAtomsFromRecord({ 'pt-safe': { __safeStyle: [['paddingTop', 't', undefined, undefined]] } })
    expect(lookupCss('pt-safe', ctx('base'))).toEqual([{ paddingTop: 0 }])
  })

  it('mixes safe atoms with regular atoms in one array', () => {
    __registerAtomsFromRecord({
      'flex-1': { flex: 1 },
      'pt-safe': { __safeStyle: [['paddingTop', 't', undefined, undefined]] },
    })
    const result = lookupCss('flex-1 pt-safe', ctx('base', { insets: { top: 47, right: 0, bottom: 0, left: 0 } }))
    expect(result).toEqual([{ flex: 1 }, { paddingTop: 47 }])
  })

  it('array hoist containing safe atoms resolves them per render against live insets', () => {
    __registerAtomsFromRecord({
      'flex-1': { flex: 1 },
      'pt-safe': { __safeStyle: [['paddingTop', 't', undefined, undefined]] },
    })
    const hoist = ['flex-1', 'pt-safe'] as const
    const result = lookupCss(hoist, ctx('base', { insets: { top: 47, right: 0, bottom: 0, left: 0 } }))
    expect(result).toEqual([{ flex: 1 }, { paddingTop: 47 }])
  })
})
