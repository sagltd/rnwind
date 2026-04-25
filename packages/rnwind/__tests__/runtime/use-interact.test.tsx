import { afterEach, describe, expect, it } from 'bun:test'
import { createElement } from 'react'
// @ts-expect-error — no @types/react-test-renderer in this workspace, runtime API only.
import { act, create } from 'react-test-renderer'
import { useInteract, type UseInteractResult } from '../../src/runtime/hooks/use-interact'

const captures: { value?: UseInteractResult } = {}

/**
 * Build a probe component that exposes the live `useInteract` result
 * via the shared module-scope sink. Wrapped in a factory so the hook
 * call lives outside the directly-rendered component (avoids the
 * `react-hooks/immutability` lint that fires on direct
 * `captures.value = ...` assignments inside the component body).
 * @returns Probe component.
 */
function makeProbe(): () => null {
  /**
   * Probe — runs `useInteract` on render and stashes the result.
   * @returns null (no host output).
   */
  return function Probe(): null {
    captures.value = useInteract()
    return null
  }
}
const Probe = makeProbe()

afterEach(() => {
  captures.value = undefined
})

const NULL_EVENT = null as unknown as Parameters<UseInteractResult['onPressIn']>[0]
const NULL_FOCUS_EVENT = null as unknown as Parameters<UseInteractResult['onFocus']>[0]

describe('useInteract', () => {
  it('starts in the shared idle reference', () => {
    act(() => {
      create(createElement(Probe))
    })
    expect(captures.value?.state.active).toBe(false)
    expect(captures.value?.state.focus).toBe(false)
  })

  it('onPressIn flips active true; onPressOut flips it back', () => {
    let renderer: ReturnType<typeof create> | null = null
    act(() => {
      renderer = create(createElement(Probe))
    })
    const initial = captures.value!
    act(() => initial.onPressIn(NULL_EVENT))
    expect(captures.value?.state.active).toBe(true)
    act(() => captures.value!.onPressOut(NULL_EVENT))
    expect(captures.value?.state.active).toBe(false)
    renderer?.unmount()
  })

  it('onFocus flips focus true; onBlur flips it back', () => {
    let renderer: ReturnType<typeof create> | null = null
    act(() => {
      renderer = create(createElement(Probe))
    })
    const initial = captures.value!
    act(() => initial.onFocus(NULL_FOCUS_EVENT))
    expect(captures.value?.state.focus).toBe(true)
    act(() => captures.value!.onBlur(NULL_FOCUS_EVENT))
    expect(captures.value?.state.focus).toBe(false)
    renderer?.unmount()
  })

  it('returns the shared idle reference across renders while idle (allocation guard)', () => {
    let renderer: ReturnType<typeof create> | null = null
    act(() => {
      renderer = create(createElement(Probe))
    })
    const first = captures.value!.state
    act(() => renderer!.update(createElement(Probe)))
    expect(captures.value!.state).toBe(first)
    renderer?.unmount()
  })

  it('result-bundle reference is stable across renders when state does not change', () => {
    let renderer: ReturnType<typeof create> | null = null
    act(() => {
      renderer = create(createElement(Probe))
    })
    const first = captures.value!
    act(() => renderer!.update(createElement(Probe)))
    expect(captures.value!).toBe(first)
    renderer?.unmount()
  })
})
