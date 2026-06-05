import { afterEach, describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { act, create, type TestRenderer } from '../_test-renderer'
import { useInteract, type UseInteractResult } from '../../../src/runtime/hooks/use-interact'
import {
  __registerAtomsFromRecord,
  __resetLookupCssState,
  lookupCss,
  type InteractState,
} from '../../../src/runtime/lookup-css'
import { ctx } from '../_ctx'

/**
 * Matrix for `useInteract` — every interact-state transition (idle →
 * active/focus/both → idle) crossed with the resolved-style swap each
 * state produces through `lookupCss`, plus the allocation/no-remount
 * invariants (shared idle ref, stable bundle ref while state is unchanged).
 */

afterEach(() => {
  __resetLookupCssState()
  captures.value = undefined
})

const captures: { value?: UseInteractResult } = {}

/**
 * Build a probe that exposes the live `useInteract` result via the shared
 * sink. The hook call lives in a factory-returned component so the
 * `captures.value = ...` assignment isn't flagged by the React-hooks
 * immutability lint when it sits directly in a rendered component body.
 * @returns Probe component.
 */
function makeProbe(): () => null {
  /**
   * Probe — runs `useInteract` on render and stashes the result.
   * @returns Null (no host output).
   */
  return function Probe(): null {
    captures.value = useInteract()
    return null
  }
}
const Probe = makeProbe()

const NULL_PRESS = null as unknown as Parameters<UseInteractResult['onPressIn']>[0]
const NULL_FOCUS = null as unknown as Parameters<UseInteractResult['onFocus']>[0]

/** Atoms used to assert the state → resolved-style swap. */
const HOIST = ['bg-base', 'active:bg-active', 'focus:bg-focus'] as const
const BASE = { backgroundColor: '#base00' }
const ACTIVE = { backgroundColor: '#active0' }
const FOCUS = { backgroundColor: '#focus0' }

/**
 * Register the three-atom fixture once per test that needs the swap.
 */
function registerInteractAtoms(): void {
  __registerAtomsFromRecord({
    'bg-base': BASE,
    'active:bg-active': ACTIVE,
    'focus:bg-focus': FOCUS,
  })
}

/**
 * Resolve `HOIST` against the common scheme for a given interact state —
 * the exact path the transformer wires from `useInteract().state`.
 * @param state Live interact flags (or undefined for idle).
 * @returns Resolved style array.
 */
function resolveFor(state: InteractState | undefined): readonly unknown[] {
  return lookupCss(HOIST, ctx('common'), undefined, state)
}

describe('useInteract — state transitions drive the resolved-style swap', () => {
  it('idle emits base only; active adds the active atom; back to idle drops it', () => {
    registerInteractAtoms()
    let renderer!: TestRenderer
    act(() => {
      renderer = create(createElement(Probe))
    })
    expect(resolveFor(captures.value!.state)).toEqual([BASE])

    act(() => captures.value!.onPressIn(NULL_PRESS))
    expect(captures.value!.state.active).toBe(true)
    expect(resolveFor(captures.value!.state)).toEqual([BASE, ACTIVE])

    act(() => captures.value!.onPressOut(NULL_PRESS))
    expect(captures.value!.state.active).toBe(false)
    expect(resolveFor(captures.value!.state)).toEqual([BASE])
    renderer.unmount()
  })

  it('focus adds the focus atom independently of active', () => {
    registerInteractAtoms()
    let renderer!: TestRenderer
    act(() => {
      renderer = create(createElement(Probe))
    })
    act(() => captures.value!.onFocus(NULL_FOCUS))
    expect(captures.value!.state.focus).toBe(true)
    expect(resolveFor(captures.value!.state)).toEqual([BASE, FOCUS])

    act(() => captures.value!.onBlur(NULL_FOCUS))
    expect(captures.value!.state.focus).toBe(false)
    expect(resolveFor(captures.value!.state)).toEqual([BASE])
    renderer.unmount()
  })

  it('active + focus together emit base + both gated atoms (state index 3)', () => {
    registerInteractAtoms()
    let renderer!: TestRenderer
    act(() => {
      renderer = create(createElement(Probe))
    })
    act(() => {
      captures.value!.onPressIn(NULL_PRESS)
      captures.value!.onFocus(NULL_FOCUS)
    })
    expect(captures.value!.state).toEqual({ active: true, focus: true })
    expect(resolveFor(captures.value!.state)).toEqual([BASE, ACTIVE, FOCUS])
    renderer.unmount()
  })
})

describe('useInteract — allocation / no-remount invariants', () => {
  it('starts in the shared idle reference (active/focus both false)', () => {
    act(() => {
      create(createElement(Probe))
    })
    expect(captures.value!.state.active).toBe(false)
    expect(captures.value!.state.focus).toBe(false)
  })

  it('returns the SAME idle state reference across re-renders while idle', () => {
    let renderer!: TestRenderer
    act(() => {
      renderer = create(createElement(Probe))
    })
    const first = captures.value!.state
    act(() => renderer.update(createElement(Probe)))
    expect(captures.value!.state).toBe(first)
    renderer.unmount()
  })

  it('returns the SAME result bundle across re-renders when state is unchanged', () => {
    let renderer!: TestRenderer
    act(() => {
      renderer = create(createElement(Probe))
    })
    const first = captures.value!
    act(() => renderer.update(createElement(Probe)))
    expect(captures.value!).toBe(first)
    renderer.unmount()
  })

  it('a fresh non-idle state object is allocated only while engaged, then idle ref returns', () => {
    let renderer!: TestRenderer
    act(() => {
      renderer = create(createElement(Probe))
    })
    const idle = captures.value!.state
    act(() => captures.value!.onPressIn(NULL_PRESS))
    const engaged = captures.value!.state
    expect(engaged).not.toBe(idle)
    expect(engaged).toEqual({ active: true, focus: false })
    // Releasing returns the shared idle reference, not a new equal object.
    act(() => captures.value!.onPressOut(NULL_PRESS))
    expect(captures.value!.state).toBe(idle)
    renderer.unmount()
  })

  it('handler callbacks are referentially stable across renders (useCallback)', () => {
    let renderer!: TestRenderer
    act(() => {
      renderer = create(createElement(Probe))
    })
    const first = captures.value!
    act(() => renderer.update(createElement(Probe)))
    expect(captures.value!.onPressIn).toBe(first.onPressIn)
    expect(captures.value!.onPressOut).toBe(first.onPressOut)
    expect(captures.value!.onFocus).toBe(first.onFocus)
    expect(captures.value!.onBlur).toBe(first.onBlur)
    renderer.unmount()
  })
})
