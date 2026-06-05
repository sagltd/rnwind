import { afterEach, describe, expect, it } from 'bun:test'
import { createElement, useState, type ReactNode } from 'react'
import { act, render } from '@testing-library/react-native'
import {
  __registerAtomsFromRecord,
  __resetLookupCssState,
  activeBreakpointFor,
  registerAtoms,
  registerBreakpoints,
} from '../../../src/runtime/lookup-css'
import { __resetResolveState } from '../../../src/runtime/resolve'
import { RnwindProvider, useRnwind, type Insets } from '../../../src/runtime/components/rnwind-provider'
import { useCss } from '../../../src/runtime/hooks/use-css'

/**
 * Matrix for the context-dependent hooks reached through `useCss`:
 *  - safe-area insets: registration → resolved padding, missing-provider
 *    zero fallback, partial-side fallback, live re-resolve on state change.
 *  - responsive breakpoints: which atom wins per width tier, the tier
 *    boundaries (exactly-at vs one-below threshold), the active-breakpoint
 *    name the provider exposes.
 *
 * Tests register a global `__RNWIND_TEST_WINDOW_DIMENSIONS` to drive the
 * width `useWindowDimensions()` reports — the same hook the responsive
 * provider tests use.
 */

type TestGlobals = {
  __RNWIND_TEST_WINDOW_DIMENSIONS?: { fontScale?: number; width?: number; height?: number }
}
const testGlobals = globalThis as unknown as TestGlobals

afterEach(() => {
  __resetLookupCssState()
  __resetResolveState()
  testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = undefined
  captured.length = 0
})

const captured: unknown[] = []

/**
 * Probe reading `useCss(cn)` once per render, recording the resolved
 * single-object style for assertions.
 * @param props Probe props.
 * @param props.cn className input passed to `useCss`.
 * @returns Null — only records into the module sink.
 */
function CssProbe({ cn }: { cn: string }): null {
  captured.push(useCss(cn))
  return null
}

/**
 * Read the most recent `useCss` result.
 * @returns The last captured value, or `{}` when nothing ran.
 */
function lastCss(): unknown {
  return captured.at(-1) ?? {}
}

describe('useCss safe-area — inset registration → resolved padding', () => {
  it('resolves a *-safe atom against the provider insets', () => {
    __registerAtomsFromRecord({ 'pt-safe': { __safeStyle: [['paddingTop', 't', undefined, undefined]] } })
    render(
      createElement(
        RnwindProvider,
        { scheme: 'light', insets: { top: 47, bottom: 34 } } as never,
        createElement(CssProbe, { cn: 'pt-safe' }),
      ),
    )
    expect(lastCss()).toEqual({ paddingTop: 47 })
  })

  it('merges several *-safe atoms into one object, each side from its own inset', () => {
    __registerAtomsFromRecord({
      'pt-safe': { __safeStyle: [['paddingTop', 't', undefined, undefined]] },
      'pb-safe': { __safeStyle: [['paddingBottom', 'b', undefined, undefined]] },
    })
    render(
      createElement(
        RnwindProvider,
        { scheme: 'light', insets: { top: 47, bottom: 34 } } as never,
        createElement(CssProbe, { cn: 'pt-safe pb-safe' }),
      ),
    )
    expect(lastCss()).toEqual({ paddingTop: 47, paddingBottom: 34 })
  })

  it('falls back to 0 for a side the partial insets omit', () => {
    __registerAtomsFromRecord({ 'pb-safe': { __safeStyle: [['paddingBottom', 'b', undefined, undefined]] } })
    // Only `top` supplied — `bottom` defaults to 0 in the provider.
    render(
      createElement(
        RnwindProvider,
        { scheme: 'light', insets: { top: 20 } } as never,
        createElement(CssProbe, { cn: 'pb-safe' }),
      ),
    )
    expect(lastCss()).toEqual({ paddingBottom: 0 })
  })

  it('missing provider → zero insets → safe atom resolves to 0 (no crash)', () => {
    __registerAtomsFromRecord({ 'pt-safe': { __safeStyle: [['paddingTop', 't', undefined, undefined]] } })
    // No RnwindProvider — context default carries ZERO_INSETS.
    render(createElement(CssProbe, { cn: 'pt-safe' }))
    expect(lastCss()).toEqual({ paddingTop: 0 })
  })

  it('applies the `or` floor when the inset is below it', () => {
    // spec tuple [cssKey, side, orFloor, offset] — max(inset, orFloor).
    __registerAtomsFromRecord({ 'pt-safe-min': { __safeStyle: [['paddingTop', 't', 16, undefined]] } })
    render(
      createElement(
        RnwindProvider,
        { scheme: 'light', insets: { top: 4 } } as never,
        createElement(CssProbe, { cn: 'pt-safe-min' }),
      ),
    )
    // inset 4 < floor 16 → 16.
    expect(lastCss()).toEqual({ paddingTop: 16 })
  })

  it('re-resolves live when the provider insets change via state', () => {
    __registerAtomsFromRecord({ 'pt-safe': { __safeStyle: [['paddingTop', 't', undefined, undefined]] } })
    const setters: Array<(next: Partial<Insets>) => void> = []
    /**
     * Host owning the insets state + publishing its setter.
     * @param props Host props.
     * @param props.children Probe subtree.
     * @returns Provider carrying the current insets.
     */
    function Host({ children }: { children: ReactNode }): ReactNode {
      const [insets, setInsets] = useState<Partial<Insets>>({ top: 10 })
      if (setters.length === 0) setters.push(setInsets)
      return createElement(RnwindProvider, { scheme: 'light', insets } as never, children)
    }
    render(createElement(Host, { children: createElement(CssProbe, { cn: 'pt-safe' }) }))
    expect(lastCss()).toEqual({ paddingTop: 10 })
    act(() => setters[0]!({ top: 55 }))
    expect(lastCss()).toEqual({ paddingTop: 55 })
  })
})

describe('useCss responsive — which atom wins per width tier', () => {
  it('below the md threshold only the unprefixed atom wins', () => {
    registerAtoms('common', {
      'bg-base': { backgroundColor: '#3b82f6' },
      'md:bg-wide': { backgroundColor: '#ef4444' },
    })
    registerBreakpoints({ md: 768 })
    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 500 }
    render(
      createElement(
        RnwindProvider,
        { scheme: 'light' } as never,
        createElement(CssProbe, { cn: 'bg-base md:bg-wide' }),
      ),
    )
    expect(lastCss()).toEqual({ backgroundColor: '#3b82f6' })
  })

  it('at/above the md threshold the responsive atom wins (last-merged)', () => {
    registerAtoms('common', {
      'bg-base': { backgroundColor: '#3b82f6' },
      'md:bg-wide': { backgroundColor: '#ef4444' },
    })
    registerBreakpoints({ md: 768 })
    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 800 }
    render(
      createElement(
        RnwindProvider,
        { scheme: 'light' } as never,
        createElement(CssProbe, { cn: 'bg-base md:bg-wide' }),
      ),
    )
    // Both atoms merge; the md atom is last so its color wins.
    expect(lastCss()).toEqual({ backgroundColor: '#ef4444' })
  })

  it('live width change flips the resolved style across the threshold', () => {
    registerAtoms('common', {
      'bg-base': { backgroundColor: '#3b82f6' },
      'md:bg-wide': { backgroundColor: '#ef4444' },
    })
    registerBreakpoints({ md: 768 })
    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 400 }
    const { rerender } = render(
      createElement(RnwindProvider, { scheme: 'light' } as never, createElement(CssProbe, { cn: 'bg-base md:bg-wide' })),
    )
    expect(lastCss()).toEqual({ backgroundColor: '#3b82f6' })

    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 900 }
    act(() => {
      rerender(
        createElement(RnwindProvider, { scheme: 'light' } as never, createElement(CssProbe, { cn: 'bg-base md:bg-wide' })),
      )
    })
    expect(lastCss()).toEqual({ backgroundColor: '#ef4444' })
  })
})

describe('responsive — tier boundaries (mobile-first, min-width inclusive)', () => {
  it('fires exactly AT the threshold and not one px below', () => {
    registerAtoms('common', { 'p-1': { padding: 4 }, 'sm:p-2': { padding: 8 } })
    registerBreakpoints({ sm: 640 })

    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 639 }
    const { rerender } = render(
      createElement(RnwindProvider, { scheme: 'light' } as never, createElement(CssProbe, { cn: 'p-1 sm:p-2' })),
    )
    expect(lastCss()).toEqual({ padding: 4 }) // 639 < 640 → sm off

    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 640 }
    act(() => {
      rerender(createElement(RnwindProvider, { scheme: 'light' } as never, createElement(CssProbe, { cn: 'p-1 sm:p-2' })))
    })
    expect(lastCss()).toEqual({ padding: 8 }) // 640 >= 640 → sm on
  })

  it('the provider exposes the active breakpoint NAME for the current width', () => {
    registerBreakpoints({ sm: 640, md: 768, lg: 1024 })
    const nameCaptures: string[] = []
    /**
     * Probe recording the live `activeBreakpoint` name.
     * @returns Null — records into the local sink.
     */
    function NameProbe(): null {
      nameCaptures.push(useRnwind().activeBreakpoint)
      return null
    }
    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 800 }
    render(createElement(RnwindProvider, { scheme: 'light' } as never, createElement(NameProbe)))
    expect(nameCaptures.at(-1)).toBe('md')
  })

  it('activeBreakpointFor matches the documented tier semantics', () => {
    registerBreakpoints({ sm: 640, md: 768, lg: 1024 })
    // Below all thresholds → smallest registered name (not the abstract base).
    expect(activeBreakpointFor(320)).toBe('sm')
    expect(activeBreakpointFor(640)).toBe('sm')
    expect(activeBreakpointFor(768)).toBe('md')
    expect(activeBreakpointFor(2000)).toBe('lg')
  })

  it('empty breakpoint registry → all atoms pass and the name is the base sentinel', () => {
    registerAtoms('common', { 'md:bg-wide': { backgroundColor: '#ef4444' } })
    // No registerBreakpoints → the md gate is a no-op, atom always emits.
    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 0 }
    render(createElement(RnwindProvider, { scheme: 'light' } as never, createElement(CssProbe, { cn: 'md:bg-wide' })))
    expect(lastCss()).toEqual({ backgroundColor: '#ef4444' })
    expect(activeBreakpointFor(0)).toBe('base')
  })
})
