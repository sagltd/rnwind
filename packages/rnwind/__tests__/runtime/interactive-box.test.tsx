import { afterEach, describe, expect, it } from 'bun:test'
import { createElement, Fragment } from 'react'
import { act, render } from '@testing-library/react-native'
import { __registerAtomsFromRecord, __resetLookupCssState } from '../../src/runtime/lookup-css'
import { InteractiveBox } from '../../src/runtime/interactive-box'
import { ctx } from './_ctx'

afterEach(() => {
  __resetLookupCssState()
})

/**
 * Leaf component used by the tests below — renders nothing, accepts any
 * props. Hoisted to module scope so every test reuses the same ref
 * (otherwise `UNSAFE_getAllByType(Probe)` would resolve against a different
 * function identity per render).
 * @returns Always `null`.
 */
const Probe = (): null => null

/**
 * Regression test for the "press-everywhere" bug: in the earlier
 * design the transformer injected ONE `useInteract()` at the top of the
 * enclosing component and wired every interactive JSX element's press /
 * focus handlers to the shared hook. That meant pressing one button
 * flipped the `active` flag on the shared state object, so every
 * element reading `_i.state.active` turned into its active variant
 * simultaneously — "pressing one button makes all four buttons glow".
 *
 * The fix is to move the hook inside a per-element `InteractiveBox`
 * wrapper so each rendered instance allocates its own state. This
 * test renders two sibling elements with identical interactive
 * className, fires `onPressIn` on one, and asserts the other's
 * resolved style is *still* the non-active baseline.
 */
describe('InteractiveBox: per-instance interact state', () => {
  it('pressing one interactive element does not flip active on its sibling', () => {
    const BASE = { backgroundColor: '#00a6f4' }
    const ACTIVE = { backgroundColor: '#0069a8' }
    __registerAtomsFromRecord({
      'bg-sky-500': BASE,
      'active:bg-sky-700': ACTIVE,
    })
    const cn = ['bg-sky-500', 'active:bg-sky-700']

    const { UNSAFE_getAllByType: getAllByType } = render(
      createElement(
        Fragment,
        null,
        createElement(InteractiveBox, { _rw: { as: Probe, cn, t: ctx('base') }, testID: 'a' }),
        createElement(InteractiveBox, { _rw: { as: Probe, cn, t: ctx('base') }, testID: 'b' }),
      ),
    )

    const probes = getAllByType(Probe)
    const [a, b] = probes
    expect(probes).toHaveLength(2)
    // Baseline — neither element is pressed yet.
    expect(a!.props.style).toEqual([BASE])
    expect(b!.props.style).toEqual([BASE])
    // Press A.
    act(() => {
      ;(a!.props.onPressIn as () => void)()
    })
    // A's style now includes the active atom; B must stay on baseline.
    const probesAfter = getAllByType(Probe)
    const [aAfter, bAfter] = probesAfter
    expect(aAfter!.props.style).toEqual([BASE, ACTIVE])
    expect(bAfter!.props.style).toEqual([BASE])
  })
})
