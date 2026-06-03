import { afterEach, describe, expect, it } from 'bun:test'
import { createElement } from 'react'
 
import { act, create, type TestRenderer } from './_test-renderer'
import { __registerAtomsFromRecord, __resetLookupCssState, lookupCss } from '../../src/runtime/lookup-css'
import { RnwindProvider, useRnwind } from '../../src/runtime/components/rnwind-provider'
import { useCss } from '../../src/runtime/hooks/use-css'

type TestGlobals = {
  __RNWIND_TEST_WINDOW_DIMENSIONS?: { fontScale?: number; width?: number; height?: number }
}
const testGlobals = globalThis as unknown as TestGlobals

const cssCaptures: Array<readonly unknown[]> = []
const scaleCaptures: number[] = []

/**
 * Probe reading useCss('text-sm').
 * @returns Always `null`; pushes the captured style array into `cssCaptures`.
 */
function CssProbe(): null {
  cssCaptures.push(useCss('text-sm') as readonly unknown[])
  return null
}

/**
 * Probe reading useRnwind().fontScale.
 * @returns Always `null`; pushes the captured scalar into `scaleCaptures`.
 */
function ScaleProbe(): null {
  scaleCaptures.push(useRnwind().fontScale)
  return null
}

afterEach(() => {
  __resetLookupCssState()
  testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = undefined
  cssCaptures.length = 0
  scaleCaptures.length = 0
})

describe('RnwindProvider — fontScale reactivity', () => {
  it('useCss returns fontSize multiplied by useWindowDimensions().fontScale', () => {
    __registerAtomsFromRecord({ 'text-sm': { fontSize: 14 } })
    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { fontScale: 1.5 }

    act(() => {
      create(createElement(RnwindProvider, { scheme: 'light' }, createElement(CssProbe)))
    })
    expect(cssCaptures.length).toBeGreaterThan(0)
    const value = cssCaptures.at(-1)![0] as { fontSize: number }
    expect(value.fontSize).toBeCloseTo(21, 4)
  })

  it('useRnwind exposes fontScale', () => {
    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { fontScale: 1.25 }
    act(() => {
      create(createElement(RnwindProvider, { scheme: 'light' }, createElement(ScaleProbe)))
    })
    expect(scaleCaptures.at(-1)).toBeCloseTo(1.25, 4)
  })

  it('REACTIVITY: re-rendering with a new useWindowDimensions().fontScale produces freshly-scaled values', () => {
    __registerAtomsFromRecord({ 'text-sm': { fontSize: 16, lineHeight: 24 } })
    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { fontScale: 1 }

    let renderer: TestRenderer | null = null
    act(() => {
      renderer = create(createElement(RnwindProvider, { scheme: 'light' }, createElement(CssProbe)))
    })
    const firstStyle = cssCaptures.at(-1)![0] as { fontSize: number; lineHeight: number }
    expect(firstStyle.fontSize).toBeCloseTo(16, 4)

    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { fontScale: 1.5 }
    act(() => {
      renderer!.update(createElement(RnwindProvider, { scheme: 'light' }, createElement(CssProbe)))
    })
    const secondStyle = cssCaptures.at(-1)![0] as { fontSize: number; lineHeight: number }
    expect(secondStyle.fontSize).toBeCloseTo(24, 4)
    expect(secondStyle.lineHeight).toBeCloseTo(36, 4)

    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { fontScale: 0.75 }
    act(() => {
      renderer!.update(createElement(RnwindProvider, { scheme: 'light' }, createElement(CssProbe)))
    })
    const thirdStyle = cssCaptures.at(-1)![0] as { fontSize: number; lineHeight: number }
    expect(thirdStyle.fontSize).toBeCloseTo(12, 4)
  })

  it('TRANSFORMER PATH: lookupCss(_c, useRnwind()) picks up new fontScale on every render', () => {
    __registerAtomsFromRecord({ 'text-sm': { fontSize: 16, lineHeight: 24 } })
    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { fontScale: 1 }

    const transformerCaptures: Array<readonly unknown[]> = []
    const HOIST = ['text-sm']
    /**
     * Mirrors transformer-emitted JSX: const _t = _r(); lookupCss(_c, _t).
     * @returns Always `null`; records the resolved style chain.
     */
    function TransformedProbe(): null {
      const _t = useRnwind()
      transformerCaptures.push(lookupCss(HOIST, _t))
      return null
    }

    let renderer: TestRenderer | null = null
    act(() => {
      renderer = create(createElement(RnwindProvider, { scheme: 'light' }, createElement(TransformedProbe)))
    })
    expect((transformerCaptures.at(-1)![0] as { fontSize: number }).fontSize).toBeCloseTo(16, 4)

    testGlobals.__RNWIND_TEST_WINDOW_DIMENSIONS = { fontScale: 1.5 }
    act(() => {
      renderer!.update(createElement(RnwindProvider, { scheme: 'light' }, createElement(TransformedProbe)))
    })
    expect((transformerCaptures.at(-1)![0] as { fontSize: number }).fontSize).toBeCloseTo(24, 4)
  })
})
