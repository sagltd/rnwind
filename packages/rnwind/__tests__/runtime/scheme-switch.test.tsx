import { afterEach, describe, expect, it } from 'bun:test'
import { createElement, useState, type ReactNode } from 'react'
import { act, render } from '@testing-library/react-native'
import { __resetLookupCssState, lookupCss, registerAtoms } from '../../src/runtime/lookup-css'
import { RnwindProvider, useRnwind } from '../../src/runtime/components/rnwind-provider'

afterEach(() => {
  __resetLookupCssState()
})

const captures: Array<readonly unknown[]> = []
const HOIST = ['bg-bg']

/**
 * Mirrors transformer-emitted JSX: `const _t = useR_(); lookupCss(_c, _t)`.
 * Records every resolution into {@link captures} so assertions can
 * inspect what each render produced.
 * @returns Null — the probe only exists to record output.
 */
function TransformedProbe(): null {
  const _t = useRnwind()
  captures.push(lookupCss(HOIST, _t))
  return null
}

describe('RnwindProvider — scheme reactivity', () => {
  it('TRANSFORMER PATH: lookupCss(_c, useRnwind()) picks up the new scheme on a re-render', () => {
    registerAtoms('light', { 'bg-bg': { backgroundColor: '#ffffff' } })
    registerAtoms('dark', { 'bg-bg': { backgroundColor: '#000000' } })
    captures.length = 0

    const setters: Array<(next: 'light' | 'dark') => void> = []
    /**
     * Host component publishing its `setScheme` so the test can drive
     * an update from outside the render tree.
     * @returns RnwindProvider carrying the current scheme.
     */
    function Host(): ReactNode {
      const [scheme, setScheme] = useState<'light' | 'dark'>('light')
      if (setters.length === 0) setters.push(setScheme)
      return createElement(RnwindProvider, { scheme } as never, createElement(TransformedProbe))
    }

    render(createElement(Host))
    expect(captures.at(-1)).toEqual([{ backgroundColor: '#ffffff' }])

    act(() => {
      setters[0]!('dark')
    })
    expect(captures.at(-1)).toEqual([{ backgroundColor: '#000000' }])

    act(() => {
      setters[0]!('light')
    })
    expect(captures.at(-1)).toEqual([{ backgroundColor: '#ffffff' }])
  })
})
