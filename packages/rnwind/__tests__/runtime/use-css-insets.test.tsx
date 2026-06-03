import { afterEach, describe, expect, it } from 'bun:test'
import { createElement, useState, type ReactNode } from 'react'
import { act, render } from '@testing-library/react-native'
import { __resetLookupCssState, __registerAtomsFromRecord } from '../../src/runtime/lookup-css'
import { RnwindProvider, type Insets } from '../../src/runtime/components/rnwind-provider'
import { useCss } from '../../src/runtime/hooks/use-css'

/**
 * `useCss('pt-safe')` must resolve safe-area atoms against the active
 * insets from `RnwindProvider`. When insets are updated via state, the
 * hook must return a fresh style array so consumers re-render with the
 * new padding.
 */

afterEach(() => {
  __resetLookupCssState()
})

// Capture slot — test probe records the live `useCss()` output for
// assertions. Mutating an array instead of re-assigning a `let`
// satisfies `react-perf/no-reassigning-captured` (push isn't a
// variable rebind), and consumers read the latest via `lastCaptured()`.
const captured: Array<readonly unknown[]> = []
/**
 * Test probe — reads `useCss(cn)` and stashes the result so assertions
 * can observe what the hook returned.
 * @param props Probe props.
 * @param props.cn className input passed to `useCss()`.
 * @returns Null — the probe only exists to record output.
 */
function Probe({ cn }: { cn: string }): null {
  captured.push(useCss(cn) as readonly unknown[])
  return null
}

/**
 * Read the most recent `useCss()` result recorded by the probe.
 * @returns The last captured value, or `[]` when the probe never ran.
 */
function lastCaptured(): readonly unknown[] {
  return captured.at(-1) ?? []
}

/**
 * Clear the capture slot between test cases.
 */
function resetCaptured(): void {
  captured.length = 0
}

describe('useCss() safe-area insets', () => {
  it('resolves *-safe atoms against the provider insets', () => {
    __registerAtomsFromRecord({ 'pt-safe': { __safeStyle: [['paddingTop', 't', undefined, undefined]] } })
    resetCaptured()
    render(
      createElement(
        RnwindProvider,
        { scheme: 'light', insets: { top: 47, bottom: 34 } } as never,
        createElement(Probe, { cn: 'pt-safe' }),
      ),
    )
    expect(lastCaptured()).toEqual([{ paddingTop: 47 }])
  })

  it('re-resolves when the provider insets change via state', () => {
    __registerAtomsFromRecord({ 'pt-safe': { __safeStyle: [['paddingTop', 't', undefined, undefined]] } })
    resetCaptured()
    // Host publishes its setter into a module-level slot so the test
    // can drive an update from outside the render tree. Pushing into an
    // array avoids the `react-perf/no-reassigning-captured` rule.
    const setters: Array<(next: Partial<Insets>) => void> = []
    /**
     * Host component — owns the insets state + publishes the setter.
     * @param props Host props.
     * @param props.children Probe element.
     * @returns A RnwindProvider carrying the current insets.
     */
    function Host({ children }: { children: ReactNode }): ReactNode {
      const [insets, setInsets] = useState<Partial<Insets>>({ top: 10 })

      if (setters.length === 0) setters.push(setInsets)
      return createElement(RnwindProvider, { scheme: 'light', insets } as never, children)
    }
    render(createElement(Host, { children: createElement(Probe, { cn: 'pt-safe' }) }))
    expect(lastCaptured()).toEqual([{ paddingTop: 10 }])
    act(() => {
      setters[0]!({ top: 55 })
    })
    expect(lastCaptured()).toEqual([{ paddingTop: 55 }])
  })
})
