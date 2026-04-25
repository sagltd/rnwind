import { afterEach, describe, expect, it } from 'bun:test'
import { __registerAtomsFromRecord, __resetLookupCssState, lookupCss } from '../../src/runtime/lookup-css'
import { ctx } from './_ctx'

afterEach(() => {
  __resetLookupCssState()
})

/**
 * Interactive (`active:` / `focus:`) atom gating happens inside
 * `lookupCss`: each atom name is inspected for the prefix, and only
 * atoms whose gate matches the current {@link InteractState} are
 * emitted. Hoisted atom-list inputs AND raw className strings both
 * respect the gate.
 */
describe('lookupCss: interactive (`active:` / `focus:`) gating', () => {
  it('active atom is silent unless { active: true }', () => {
    __registerAtomsFromRecord({
      'bg-red-500': { backgroundColor: '#fb2c36' },
      'active:bg-sky-700': { backgroundColor: '#0069a8' },
    })
    const hoist = ['bg-red-500', 'active:bg-sky-700'] as const
    expect(lookupCss(hoist, ctx('common'))).toEqual([{ backgroundColor: '#fb2c36' }])
    expect(lookupCss(hoist, ctx('common'), undefined, { active: false })).toEqual([{ backgroundColor: '#fb2c36' }])
    expect(lookupCss(hoist, ctx('common'), undefined, { active: true })).toEqual([
      { backgroundColor: '#fb2c36' },
      { backgroundColor: '#0069a8' },
    ])
  })

  it('focus atom is independent of active — both flags drive their own gate', () => {
    __registerAtomsFromRecord({
      'active:bg-sky-700': { backgroundColor: '#0069a8' },
      'focus:opacity-50': { opacity: 0.5 },
    })
    const hoist = ['active:bg-sky-700', 'focus:opacity-50'] as const
    expect(lookupCss(hoist, ctx('common'), undefined, { focus: true })).toEqual([{ opacity: 0.5 }])
    expect(lookupCss(hoist, ctx('common'), undefined, { active: true })).toEqual([{ backgroundColor: '#0069a8' }])
    expect(lookupCss(hoist, ctx('common'), undefined, { active: true, focus: true })).toEqual([
      { backgroundColor: '#0069a8' },
      { opacity: 0.5 },
    ])
  })

  it('same (hoist, scheme, state) returns the same array reference — zero-alloc hot path', () => {
    __registerAtomsFromRecord({ 'active:bg-sky-700': { backgroundColor: '#0069a8' } })
    const hoist = ['active:bg-sky-700'] as const
    const off = lookupCss(hoist, ctx('common'), undefined, { active: false })
    const on = lookupCss(hoist, ctx('common'), undefined, { active: true })
    expect(off).not.toBe(on)
    expect(off).toEqual([])
    expect(on).toEqual([{ backgroundColor: '#0069a8' }])
    expect(lookupCss(hoist, ctx('common'), undefined, { active: true })).toBe(on)
  })

  it('transition utilities stay unconditional — they appear in every state', () => {
    __registerAtomsFromRecord({
      'transition-colors': { transitionDuration: '150ms', transitionProperty: 'backgroundColor' },
      'active:bg-sky-700': { backgroundColor: '#0069a8' },
    })
    const hoist = ['transition-colors', 'active:bg-sky-700'] as const
    const activeOff = lookupCss(hoist, ctx('common'))
    const activeOn = lookupCss(hoist, ctx('common'), undefined, { active: true })
    expect(activeOff).toEqual([{ transitionDuration: '150ms', transitionProperty: 'backgroundColor' }])
    expect(activeOn).toEqual([
      { transitionDuration: '150ms', transitionProperty: 'backgroundColor' },
      { backgroundColor: '#0069a8' },
    ])
  })

  it('dynamic string input also respects the gate — active atoms appear only when the flag is on', () => {
    __registerAtomsFromRecord({
      'bg-red-500': { backgroundColor: '#fb2c36' },
      'active:bg-sky-700': { backgroundColor: '#0069a8' },
    })
    expect(lookupCss('bg-red-500 active:bg-sky-700', ctx('common'))).toEqual([{ backgroundColor: '#fb2c36' }])
    expect(lookupCss('bg-red-500 active:bg-sky-700', ctx('common'), undefined, { active: true })).toEqual([
      { backgroundColor: '#fb2c36' },
      { backgroundColor: '#0069a8' },
    ])
  })
})
