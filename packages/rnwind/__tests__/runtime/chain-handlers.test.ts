import { describe, expect, it, mock } from 'bun:test'
import type { GestureResponderEvent, NativeSyntheticEvent, TargetedEvent } from 'react-native'
import { chainFocus, chainPress } from '../../src/runtime/chain-handlers'

const PRESS_EVENT = { nativeEvent: { locationX: 0 } } as unknown as GestureResponderEvent
const FOCUS_EVENT = { nativeEvent: {} } as unknown as NativeSyntheticEvent<TargetedEvent>

describe('chainPress', () => {
  it('returns rnwind handler unchanged when user handler is null', () => {
    const ours = mock(() => {})
    expect(chainPress(null, ours)).toBe(ours)
  })

  it('returns rnwind handler unchanged when user handler is undefined', () => {
    const ours = mock(() => {})
    expect(chainPress(undefined, ours)).toBe(ours)
  })

  it('chains user → ours; both fire on the same event', () => {
    const calls: string[] = []
    const user = mock(() => calls.push('user'))
    const ours = mock(() => calls.push('ours'))
    chainPress(user, ours)(PRESS_EVENT)
    expect(calls).toEqual(['user', 'ours'])
    expect(user).toHaveBeenCalledWith(PRESS_EVENT)
    expect(ours).toHaveBeenCalledWith(PRESS_EVENT)
  })
})

describe('chainFocus', () => {
  it('returns rnwind handler unchanged when user handler is null', () => {
    const ours = mock(() => {})
    expect(chainFocus(null, ours)).toBe(ours)
  })

  it('returns rnwind handler unchanged when user handler is undefined', () => {
    const ours = mock(() => {})
    expect(chainFocus(undefined, ours)).toBe(ours)
  })

  it('chains user → ours; both fire on the same event', () => {
    const calls: string[] = []
    const user = mock(() => calls.push('user'))
    const ours = mock(() => calls.push('ours'))
    chainFocus(user, ours)(FOCUS_EVENT)
    expect(calls).toEqual(['user', 'ours'])
    expect(user).toHaveBeenCalledWith(FOCUS_EVENT)
    expect(ours).toHaveBeenCalledWith(FOCUS_EVENT)
  })
})
