import { describe, expect, it } from 'bun:test'
import { createElement, useState, type ReactNode } from 'react'
import { act, render } from '@testing-library/react-native'
import { RnwindProvider, useR_ } from '../../src/runtime/components/rnwind-provider'

/**
 * Mirrors the transformed `ToggleTile` from `transitions.tsx`: parent
 * has `useR_()` hoisted ahead of its `useState`. The render-prop body
 * is forwarded straight through.
 * @param props ToggleTile props.
 * @param props.children Render prop receiving the current `on` value.
 * @returns Whatever the render-prop returns.
 */
function ToggleTile({ children }: { children: (on: boolean) => ReactNode }): ReactNode {
  useR_()
  const [on] = useState(false)
  return children(on)
}

/**
 * Mirrors the transformed `Transitions` outer component — `useR_()`
 * injected at the top, render-prop closes over the parent's context
 * binding.
 * @returns Transitions JSX.
 */
function Transitions(): ReactNode {
  useR_()
  return createElement(ToggleTile, {
    children: (on: boolean) => createElement('Animated.View', { 'data-on': String(on) }),
  })
}

/**
 * Reproduce the transformer-emitted shape of `transitions.tsx`'s
 * `ToggleTile` + render-prop pattern. Switching the outer
 * RnwindProvider's scheme must not shift hooks order in the inner
 * ToggleTile across renders.
 */
describe('render-prop hooks stability', () => {
  it('switching scheme on RnwindProvider does not shift hooks order in nested ToggleTile', () => {
    const setters: Array<(next: 'light' | 'dark') => void> = []
    /**
     * Host component publishing its `setScheme` so the test can drive
     * an update from outside the render tree.
     * @returns RnwindProvider carrying the current scheme.
     */
    function Host(): ReactNode {
      const [scheme, setScheme] = useState<'light' | 'dark'>('light')
      if (setters.length === 0) setters.push(setScheme)
      return createElement(RnwindProvider, { scheme } as never, createElement(Transitions))
    }

    expect(() => {
      render(createElement(Host))
    }).not.toThrow()

    expect(() => {
      act(() => {
        setters[0]!('dark')
      })
    }).not.toThrow()

    expect(() => {
      act(() => {
        setters[0]!('light')
      })
    }).not.toThrow()
  })
})
