import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { createElement } from 'react'
// @ts-expect-error — no @types/react-test-renderer in this workspace, runtime API only.
import { act, create } from 'react-test-renderer'
import { __resetLookupCssState } from '../../src/runtime/lookup-css'
import { RnwindProvider } from '../../src/runtime/components/rnwind-provider'
import { triggerHaptic, useMountHaptic, __resetHapticWarnings } from '../../src/runtime/haptics'
import type { HapticRequest, OnHaptics } from '../../src/core/parser/haptics'

const SELECTION: HapticRequest = { kind: 'selection' }
const IMPACT_LIGHT: HapticRequest = { kind: 'impact', style: 'Light' }
const NOTIFICATION_SUCCESS: HapticRequest = { kind: 'notification', type: 'Success' }

afterEach(() => {
  __resetLookupCssState()
  __resetHapticWarnings()
})

describe('useMountHaptic', () => {
  it('fires every request once on mount through the provider dispatcher', () => {
    const onHaptics = mock<OnHaptics>(() => {})
    const requests: readonly HapticRequest[] = [SELECTION, IMPACT_LIGHT]
    /** Component under test — the transformer would emit this for `<View className="haptic-selection haptic-impact-light" />`. */
    function HapticHost(): null {
      useMountHaptic(requests)
      return null
    }
    act(() => {
      create(createElement(RnwindProvider, { scheme: 'light', onHaptics }, createElement(HapticHost)))
    })
    expect(onHaptics).toHaveBeenCalledTimes(2)
    expect(onHaptics.mock.calls[0]).toEqual([SELECTION, 'mount'])
    expect(onHaptics.mock.calls[1]).toEqual([IMPACT_LIGHT, 'mount'])
  })

  it('warns once per (kind, trigger) pair when no onHaptics is wired and stays quiet thereafter', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    const requests: readonly HapticRequest[] = [SELECTION, SELECTION, IMPACT_LIGHT]
    /** Component that fires three requests but only two unique tags. */
    function HapticHost(): null {
      useMountHaptic(requests)
      return null
    }
    act(() => {
      create(createElement(RnwindProvider, { scheme: 'light' }, createElement(HapticHost)))
    })
    // Two unique tags → exactly two warnings.
    expect(warn).toHaveBeenCalledTimes(2)
    expect((warn.mock.calls[0]?.[0] as string)).toContain('selection')
    expect((warn.mock.calls[1]?.[0] as string)).toContain('impact/Light')
    warn.mockRestore()
  })
})

describe('triggerHaptic', () => {
  it('forwards to the provider dispatcher with the supplied trigger', () => {
    const onHaptics = mock<OnHaptics>(() => {})
    triggerHaptic(onHaptics, NOTIFICATION_SUCCESS, 'pressIn')
    expect(onHaptics).toHaveBeenCalledTimes(1)
    expect(onHaptics.mock.calls[0]).toEqual([NOTIFICATION_SUCCESS, 'pressIn'])
  })

  it('warns once per (kind, trigger) pair when no dispatcher is wired', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    triggerHaptic(undefined, NOTIFICATION_SUCCESS, 'focus')
    triggerHaptic(undefined, NOTIFICATION_SUCCESS, 'focus')
    triggerHaptic(undefined, NOTIFICATION_SUCCESS, 'pressIn')
    // Same kind+trigger collapses to one warning; different trigger emits a fresh one.
    expect(warn).toHaveBeenCalledTimes(2)
    expect((warn.mock.calls[0]?.[0] as string)).toContain('notification/Success')
    warn.mockRestore()
  })
})
