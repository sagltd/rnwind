import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { render } from '@testing-library/react-native'
import { RnwindProvider, useRnwind, type Insets } from '../../src/runtime/components/rnwind-provider'

const useInsets = (): Insets => useRnwind().insets

/**
 * `useInsets()` is a new hook; this file pins the public contract:
 * - Without a provider, insets default to zero on every side.
 * - With a provider that passes partial insets, missing sides fall back
 *   to zero; supplied sides land verbatim.
 * - The returned object reference is shared across the no-insets case
 *   so downstream memoisation works (cheap `===` equality).
 */

// Capture slot — a mutable container holding the latest insets reads.
// Using an array (push is not a reassignment) sidesteps the
// `react-perf/no-reassigning-captured` rule while staying ergonomic.
const captured: Array<Insets | null> = []
const Probe = (): null => {
  captured.push(useInsets())
  return null
}

/**
 * Read the most recent `useInsets()` result observed by the probe.
 * @returns The latest captured value, or `null` when the probe never ran.
 */
function lastCaptured(): Insets | null {
  return captured.at(-1) ?? null
}

/**
 * Clear the capture slot between test cases.
 */
function resetCaptured(): void {
  captured.length = 0
}

describe('useInsets()', () => {
  it('defaults to { top: 0, right: 0, bottom: 0, left: 0 } outside a provider', () => {
    resetCaptured()
    render(createElement(Probe))
    expect(lastCaptured() as unknown).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })

  it('reads the live value from RnwindProvider', () => {
    resetCaptured()
    render(createElement(RnwindProvider, { scheme: 'light', insets: { top: 47, bottom: 34 } } as never, createElement(Probe)))
    expect(lastCaptured() as unknown).toEqual({ top: 47, right: 0, bottom: 34, left: 0 })
  })

  it('returns the shared zero-insets reference when every side is zero, for stable ===', () => {
    resetCaptured()
    render(createElement(RnwindProvider, { scheme: 'light', insets: {} } as never, createElement(Probe)))
    const a = lastCaptured()
    resetCaptured()
    render(
      createElement(
        RnwindProvider,
        { scheme: 'light', insets: { top: 0, right: 0, bottom: 0, left: 0 } } as never,
        createElement(Probe),
      ),
    )
    const b = lastCaptured()
    expect(a).toBe(b)
  })
})
