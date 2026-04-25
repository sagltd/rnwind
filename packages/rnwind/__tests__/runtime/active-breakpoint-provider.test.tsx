import { afterEach, describe, expect, it } from 'bun:test'
import { createElement } from 'react'
// @ts-expect-error — no @types/react-test-renderer in this workspace, runtime API only.
import { act, create } from 'react-test-renderer'
import {
  __registerAtomsFromRecord,
  __resetLookupCssState,
  lookupCss,
  registerBreakpoints,
} from '../../src/runtime/lookup-css'
import { RnwindProvider, useRnwind } from '../../src/runtime/components/rnwind-provider'

type TestGlobals = {
  __RNWIND_TEST_WINDOW_DIMENSIONS?: { fontScale?: number; width?: number; height?: number }
}
const testGlobals = globalThis as unknown as TestGlobals

const captures: string[] = []

/**
 * Probe reading useRnwind().activeBreakpoint.
 * @returns null — captures via side effect into the shared array.
 */
function Probe(): null {
  captures.push(useRnwind().activeBreakpoint)
  return null
}

/**
 * Build a probe component that simulates a transformed JSX site:
 * grabs the rnwind context and pushes the resolved style array into
 * the supplied capture sink. One factory keeps the per-test probes
 * differentiated by their bound hoist/sink rather than duplicating
 * identical bodies (sonarjs/no-identical-functions).
 * @param hoist Atom-name list a transformed `<View className="..." />` would emit.
 * @param sink Array to push each render's resolved style into.
 * @returns Probe component bound to the supplied hoist + sink.
 */
function makeStyleProbe(hoist: readonly string[], sink: Array<readonly unknown[]>): () => null {
  /**
   * Probe component — runs `lookupCss(hoist, ctx)` once per render and
   * stashes the result for later assertion.
   * @returns null (no host output).
   */
  return function StyleProbe(): null {
    sink.push(lookupCss(hoist, useRnwind()))
    return null
  }
}

afterEach(() => {
  __resetLookupCssState()
  testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = undefined
  captures.length = 0
})

describe('RnwindProvider — activeBreakpoint reactivity', () => {
  it('exposes the smallest registered breakpoint name when below all thresholds', () => {
    registerBreakpoints({ sm: 640, md: 768, lg: 1024 })
    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 320 }
    act(() => {
      create(createElement(RnwindProvider, { scheme: 'light' }, createElement(Probe)))
    })
    expect(captures.at(-1)).toBe('sm')
  })

  it("exposes 'base' only when no breakpoints are registered at all (tests, plain RN bundle)", () => {
    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 1500 }
    act(() => {
      create(createElement(RnwindProvider, { scheme: 'light' }, createElement(Probe)))
    })
    expect(captures.at(-1)).toBe('base')
  })

  it('exposes the highest matching breakpoint name', () => {
    registerBreakpoints({ sm: 640, md: 768, lg: 1024, xl: 1280 })
    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 1100 }
    act(() => {
      create(createElement(RnwindProvider, { scheme: 'light' }, createElement(Probe)))
    })
    expect(captures.at(-1)).toBe('lg')
  })

  it('REACTIVITY: each width change flips activeBreakpoint to the right tier', () => {
    registerBreakpoints({ sm: 640, md: 768, lg: 1024 })
    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 500 }
    let renderer: ReturnType<typeof create> | null = null
    act(() => {
      renderer = create(createElement(RnwindProvider, { scheme: 'light' }, createElement(Probe)))
    })
    // Below sm threshold but breakpoints registered → smallest tier name.
    expect(captures.at(-1)).toBe('sm')

    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 700 }
    act(() => {
      renderer!.update(createElement(RnwindProvider, { scheme: 'light' }, createElement(Probe)))
    })
    expect(captures.at(-1)).toBe('sm')

    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 800 }
    act(() => {
      renderer!.update(createElement(RnwindProvider, { scheme: 'light' }, createElement(Probe)))
    })
    expect(captures.at(-1)).toBe('md')

    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 1280 }
    act(() => {
      renderer!.update(createElement(RnwindProvider, { scheme: 'light' }, createElement(Probe)))
    })
    expect(captures.at(-1)).toBe('lg')
  })

  it('user-defined breakpoint surfaces through the provider', () => {
    registerBreakpoints({ md: 768, '3xl': 1920 })
    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 2000 }
    act(() => {
      create(createElement(RnwindProvider, { scheme: 'light' }, createElement(Probe)))
    })
    expect(captures.at(-1)).toBe('3xl')
  })
})

describe('RnwindProvider — components using responsive classes re-render on width change', () => {
  it('TRANSFORMER PATH: hoist with `md:*` atom flips its style array when width crosses the threshold', () => {
    __registerAtomsFromRecord({
      'bg-blue-500': { backgroundColor: '#3b82f6' },
      'md:bg-red-500': { backgroundColor: '#ef4444' },
    })
    registerBreakpoints({ md: 768 })

    const styleCaptures: Array<readonly unknown[]> = []
    // Mirrors transformer-emitted JSX: const _t = _r(); lookupCss(HOIST, _t).
    const HOIST = ['bg-blue-500', 'md:bg-red-500']
    const TransformedProbe = makeStyleProbe(HOIST, styleCaptures)

    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 500 }
    let renderer: ReturnType<typeof create> | null = null
    act(() => {
      renderer = create(createElement(RnwindProvider, { scheme: 'light' }, createElement(TransformedProbe)))
    })
    // Below md → only the unprefixed atom emits a style.
    expect(styleCaptures.at(-1)).toEqual([{ backgroundColor: '#3b82f6' }])

    // Width crosses md threshold — useWindowDimensions fires, useMemo re-runs,
    // lookupCss returns a fresh array containing both atoms.
    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 800 }
    act(() => {
      renderer!.update(createElement(RnwindProvider, { scheme: 'light' }, createElement(TransformedProbe)))
    })
    expect(styleCaptures.at(-1)).toEqual([{ backgroundColor: '#3b82f6' }, { backgroundColor: '#ef4444' }])

    // Drop back below threshold — md atom is filtered out again.
    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 400 }
    act(() => {
      renderer!.update(createElement(RnwindProvider, { scheme: 'light' }, createElement(TransformedProbe)))
    })
    expect(styleCaptures.at(-1)).toEqual([{ backgroundColor: '#3b82f6' }])
  })

  it('cached style array reference IS reused while staying in the same tier (no spurious re-allocation)', () => {
    __registerAtomsFromRecord({
      a: { padding: 4 },
      'md:a': { padding: 16 },
    })
    registerBreakpoints({ md: 768 })

    const styleCaptures: Array<readonly unknown[]> = []
    const HOIST = ['a', 'md:a']
    const TransformedProbe = makeStyleProbe(HOIST, styleCaptures)

    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 600 }
    let renderer: ReturnType<typeof create> | null = null
    act(() => {
      renderer = create(createElement(RnwindProvider, { scheme: 'light' }, createElement(TransformedProbe)))
    })
    const firstNarrow = styleCaptures.at(-1)!

    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 700 } // still under md
    act(() => {
      renderer!.update(createElement(RnwindProvider, { scheme: 'light' }, createElement(TransformedProbe)))
    })
    // Same tier (0) → cached array is the SAME reference (zero realloc).
    expect(styleCaptures.at(-1)).toBe(firstNarrow)

    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { width: 900 } // crosses md
    act(() => {
      renderer!.update(createElement(RnwindProvider, { scheme: 'light' }, createElement(TransformedProbe)))
    })
    // Different tier → different array, with the responsive atom included.
    expect(styleCaptures.at(-1)).not.toBe(firstNarrow)
    expect(styleCaptures.at(-1)).toEqual([{ padding: 4 }, { padding: 16 }])
  })
})
