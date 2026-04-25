import { afterEach, describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { act, render } from '@testing-library/react-native'
import { __registerAtomsFromRecord, __resetLookupCssState } from '../../src/runtime/lookup-css'
import { InteractiveBox } from '../../src/runtime/interactive-box'
import { ctx } from './_ctx'

afterEach(() => {
  __resetLookupCssState()
})

/**
 * Leaf component used by the tests — renders nothing, forwards every
 * prop it receives so assertions can read `.props.style`.
 *
 * @returns Always `null`; the component only exists to capture props.
 */
const Probe = (): null => null

/**
 * `active:` is the mobile-correct variant for press-and-hold styling —
 * on a touch device there is no cursor so `:hover` has no real
 * semantics, and press-state IS `:active` in CSS. rnwind drops the
 * `hover:` prefix entirely in favour of `active:`.
 *
 *  - `active:` atoms register with `__state: 'active'`.
 *  - `onPressIn` flips the active gate so the runtime reveals the
 *    style; `onPressOut` hides it again.
 */
describe('active: variant', () => {
  it('active:bg-sky-700 gates its style on press-in', () => {
    const BASE = { backgroundColor: '#00a6f4' }
    const ACTIVE = { backgroundColor: '#0069a8' }
    __registerAtomsFromRecord({
      'bg-sky-500': BASE,
      'active:bg-sky-700': ACTIVE,
    })
    const cn = ['bg-sky-500', 'active:bg-sky-700']

    const { UNSAFE_getByType: getByType } = render(createElement(InteractiveBox, { _rw: { as: Probe, cn, t: ctx('base') } }))

    const probe = getByType(Probe)
    // Idle — active variant hidden.
    expect(probe.props.style).toEqual([BASE])
    // Press-in — active variant visible.
    act(() => {
      ;(probe.props.onPressIn as () => void)()
    })
    expect(getByType(Probe).props.style).toEqual([BASE, ACTIVE])
    // Press-out — active variant hidden again.
    act(() => {
      ;(probe.props.onPressOut as () => void)()
    })
    expect(getByType(Probe).props.style).toEqual([BASE])
  })
})
