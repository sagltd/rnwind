import { afterEach, describe, expect, it } from 'bun:test'
import { __registerAtomsFromRecord, __resetLookupCssState, lookupCss } from '../../src/runtime/lookup-css'
import { ctx } from './_ctx'

afterEach(() => {
  __resetLookupCssState()
})

/**
 * Contract: when `lookupCss`'s ctx has `fontScale > 1`, atoms carrying
 * `fontSize` or `lineHeight` numbers get multiplied at resolution time.
 * Values stay as-is in the scheme registry — the multiplication lives in
 * the runtime so the SAME atom renders at different scales across
 * contexts.
 */
describe('lookupCss — fontScale applied at resolution time', () => {
  it('leaves non-font atoms untouched', () => {
    __registerAtomsFromRecord({ 'bg-primary': { backgroundColor: '#6366f1' } })
    const result = lookupCss('bg-primary', ctx('common', { fontScale: 1.5 }))
    expect(result).toEqual([{ backgroundColor: '#6366f1' }])
  })

  it('multiplies fontSize by fontScale', () => {
    __registerAtomsFromRecord({ 'text-sm': { fontSize: 14 } })
    const result = lookupCss('text-sm', ctx('common', { fontScale: 1.5 })) as readonly { fontSize: number }[]
    expect(result[0]!.fontSize).toBeCloseTo(21, 4)
  })

  it('multiplies lineHeight by fontScale alongside fontSize', () => {
    __registerAtomsFromRecord({ 'text-base': { fontSize: 16, lineHeight: 24 } })
    const result = lookupCss('text-base', ctx('common', { fontScale: 1.25 })) as readonly { fontSize: number; lineHeight: number }[]
    expect(result[0]!.fontSize).toBeCloseTo(20, 4)
    expect(result[0]!.lineHeight).toBeCloseTo(30, 4)
  })

  it('fontScale = 1 returns the atom value by reference (no allocation)', () => {
    const value = { fontSize: 14 }
    __registerAtomsFromRecord({ 'text-sm': value })
    const result = lookupCss('text-sm', ctx('common', { fontScale: 1 }))
    expect(result[0]).toBe(value)
  })

  it('array hoist caches per-fontScale — same scale returns same reference', () => {
    __registerAtomsFromRecord({ 'text-sm': { fontSize: 14 } })
    const hoist = ['text-sm'] as const
    const a = lookupCss(hoist, ctx('common', { fontScale: 1.25 }))
    const b = lookupCss(hoist, ctx('common', { fontScale: 1.25 }))
    const c = lookupCss(hoist, ctx('common', { fontScale: 1.5 }))
    expect(b).toBe(a)
    expect(c).not.toBe(a)
  })

  it('dynamic string input also respects fontScale', () => {
    __registerAtomsFromRecord({
      'text-sm': { fontSize: 14 },
      'leading-6': { lineHeight: 24 },
    })
    const result = lookupCss('text-sm leading-6', ctx('common', { fontScale: 2 })) as readonly {
      fontSize?: number
      lineHeight?: number
    }[]
    expect(result[0]!.fontSize).toBeCloseTo(28, 4)
    expect(result[1]!.lineHeight).toBeCloseTo(48, 4)
  })
})
