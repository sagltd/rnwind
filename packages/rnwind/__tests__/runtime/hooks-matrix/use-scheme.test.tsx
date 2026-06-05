import { afterEach, describe, expect, it } from 'bun:test'
import { createElement, useState, type ReactNode } from 'react'
import { act, render } from '@testing-library/react-native'
import {
  __registerAtomsFromRecord,
  __resetLookupCssState,
  lookupCss,
  registerAtoms,
} from '../../../src/runtime/lookup-css'
import { RnwindProvider, useRnwind } from '../../../src/runtime/components/rnwind-provider'
import { ctx } from '../_ctx'

/**
 * Matrix for scheme resolution — themed-atom lookup per scheme (the
 * `scheme → common` fallback in `lookupAtom`), the live light↔dark
 * provider transition, and the documented dark-only limitation: a themed
 * atom registered ONLY under `dark` never lands in the `common` fallback,
 * so light mode resolves nothing for it.
 */

afterEach(() => {
  __resetLookupCssState()
})

describe('lookupCss — themed atom resolves per active scheme', () => {
  it('picks the active scheme table; light and dark return their own values', () => {
    registerAtoms('light', { 'bg-bg': { backgroundColor: '#ffffff' } })
    registerAtoms('dark', { 'bg-bg': { backgroundColor: '#0a0a0a' } })
    const hoist = ['bg-bg'] as const
    expect(lookupCss(hoist, ctx('light'))).toEqual([{ backgroundColor: '#ffffff' }])
    expect(lookupCss(hoist, ctx('dark'))).toEqual([{ backgroundColor: '#0a0a0a' }])
  })

  it('falls back to the common table when the scheme table lacks the atom', () => {
    registerAtoms('common', { 'flex-1': { flex: 1 } })
    registerAtoms('dark', { 'bg-bg': { backgroundColor: '#0a0a0a' } })
    const hoist = ['flex-1'] as const
    // `flex-1` lives only in common — both schemes inherit it.
    expect(lookupCss(hoist, ctx('light'))).toEqual([{ flex: 1 }])
    expect(lookupCss(hoist, ctx('dark'))).toEqual([{ flex: 1 }])
  })

  it('scheme own-table value wins over the common fallback on overlap', () => {
    registerAtoms('common', { 'bg-bg': { backgroundColor: '#cccccc' } })
    registerAtoms('dark', { 'bg-bg': { backgroundColor: '#0a0a0a' } })
    const hoist = ['bg-bg'] as const
    // light has no own table → common; dark overrides via its own table.
    expect(lookupCss(hoist, ctx('light'))).toEqual([{ backgroundColor: '#cccccc' }])
    expect(lookupCss(hoist, ctx('dark'))).toEqual([{ backgroundColor: '#0a0a0a' }])
  })
})

describe('lookupCss — dark-only limitation (themed atom missing in light)', () => {
  it('a dark-only themed atom resolves nothing in light (NOT in common fallback by design)', () => {
    // Mirrors a theme that declares only a `dark:` variant. The themed atom
    // lands under `dark` but never `common`, so light has no value for it.
    registerAtoms('dark', { 'text-fg': { color: '#ffffff' } })
    const hoist = ['text-fg'] as const
    expect(lookupCss(hoist, ctx('dark'))).toEqual([{ color: '#ffffff' }])
    // Light: scheme table absent AND common absent → atom drops out entirely.
    expect(lookupCss(hoist, ctx('light'))).toEqual([])
  })

  it('declaring BOTH light AND dark fixes it — each scheme resolves its own value', () => {
    // The documented workaround: declare both variants so neither scheme misses.
    registerAtoms('light', { 'text-fg': { color: '#0a0a0a' } })
    registerAtoms('dark', { 'text-fg': { color: '#ffffff' } })
    const hoist = ['text-fg'] as const
    expect(lookupCss(hoist, ctx('light'))).toEqual([{ color: '#0a0a0a' }])
    expect(lookupCss(hoist, ctx('dark'))).toEqual([{ color: '#ffffff' }])
  })

  it('an unknown scheme with no own table still inherits common', () => {
    __registerAtomsFromRecord({ 'flex-1': { flex: 1 } })
    expect(lookupCss(['flex-1'] as const, ctx('brand'))).toEqual([{ flex: 1 }])
  })
})

const captures: Array<readonly unknown[]> = []
const HOIST = ['bg-bg']

/**
 * Probe mirroring a transformed JSX site — resolves the hoist against the
 * live rnwind context and records the result so the test can observe the
 * style array per render.
 * @returns Null — records into the module sink.
 */
function TransformedProbe(): null {
  captures.push(lookupCss(HOIST, useRnwind()))
  return null
}

describe('RnwindProvider — live light↔dark transition re-resolves themed atoms', () => {
  it('flips the resolved style each time the provider scheme changes', () => {
    registerAtoms('light', { 'bg-bg': { backgroundColor: '#ffffff' } })
    registerAtoms('dark', { 'bg-bg': { backgroundColor: '#000000' } })
    captures.length = 0

    const setters: Array<(next: 'light' | 'dark') => void> = []
    /**
     * Host publishing its `setScheme` so the test can drive a scheme flip
     * from outside the render tree.
     * @returns RnwindProvider carrying the current scheme.
     */
    function Host(): ReactNode {
      const [scheme, setScheme] = useState<'light' | 'dark'>('light')
      if (setters.length === 0) setters.push(setScheme)
      return createElement(RnwindProvider, { scheme } as never, createElement(TransformedProbe))
    }

    render(createElement(Host))
    expect(captures.at(-1)).toEqual([{ backgroundColor: '#ffffff' }])

    act(() => setters[0]!('dark'))
    expect(captures.at(-1)).toEqual([{ backgroundColor: '#000000' }])

    act(() => setters[0]!('light'))
    expect(captures.at(-1)).toEqual([{ backgroundColor: '#ffffff' }])
  })

  it('useRnwind exposes the active scheme name and updates it on transition', () => {
    const schemeCaptures: string[] = []
    /**
     * Probe recording the live `scheme` from `useRnwind()`.
     * @returns Null — records into the local sink.
     */
    function SchemeProbe(): null {
      schemeCaptures.push(useRnwind().scheme)
      return null
    }
    const setters: Array<(next: 'light' | 'dark') => void> = []
    /**
     * Host publishing its scheme setter.
     * @returns Provider carrying the current scheme.
     */
    function Host(): ReactNode {
      const [scheme, setScheme] = useState<'light' | 'dark'>('light')
      if (setters.length === 0) setters.push(setScheme)
      return createElement(RnwindProvider, { scheme } as never, createElement(SchemeProbe))
    }
    render(createElement(Host))
    expect(schemeCaptures.at(-1)).toBe('light')
    act(() => setters[0]!('dark'))
    expect(schemeCaptures.at(-1)).toBe('dark')
  })

  it('defaults to the light scheme when no provider wraps the consumer', () => {
    const schemeCaptures: string[] = []
    /**
     * Probe reading the context default (no provider in the tree).
     * @returns Null — records into the local sink.
     */
    function BareProbe(): null {
      schemeCaptures.push(useRnwind().scheme)
      return null
    }
    render(createElement(BareProbe))
    expect(schemeCaptures.at(-1)).toBe('light')
  })
})
