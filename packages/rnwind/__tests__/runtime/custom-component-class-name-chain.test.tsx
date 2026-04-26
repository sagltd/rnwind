import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { render } from '@testing-library/react-native'
import { __registerAtomsFromRecord, __resetLookupCssState } from '../../src/runtime/lookup-css'
import { InteractiveBox } from '../../src/runtime/interactive-box'
import { ctx } from './_ctx'

/**
 * Probe component used by the runtime-pipe tests below — renders nothing,
 * forwards every prop so `UNSAFE_getByType(Probe).props.style` exposes
 * the resolved style array `_ib` computed and handed down.
 * @returns Always `null`; only here to capture props.
 */
const Probe = (): null => null

/**
 * End-to-end runtime check for the FlatFlashList chain the user reports
 * as "still not working". The transformer side is already covered by
 * host-detection tests; this asserts the PIPE between them: a
 * forwarder hands a literal className string into `_ib`'s `cn` slot, and
 * `_ib`'s runtime resolve produces an RN style array carrying the right
 * entries for both `px-4` and `bg-background`. If this passes, the
 * "ignored" symptom is downstream of rnwind (cache, Metro bundle, host
 * component dropping `style`).
 */
describe('runtime: custom → forwarder → _ib chain (FlatFlashList shape)', () => {
  it('a literal className string flowing through `cn` slot resolves to the registered atoms', () => {
    const PX_4 = { paddingLeft: 16, paddingRight: 16 }
    const BG = { backgroundColor: '#FAFAF7' }
    __registerAtomsFromRecord({ 'px-4': PX_4, 'bg-background': BG })
    try {
      const { UNSAFE_getByType: getByType } = render(
        createElement(InteractiveBox, {
          _rw: { as: Probe, cn: 'px-4 bg-background', t: ctx('base') },
        }),
      )
      const probe = getByType(Probe)
      const styleArray = probe.props.style as Array<Record<string, unknown>>
      const flat = Object.assign({}, ...styleArray)
      expect(flat.paddingLeft).toBe(16)
      expect(flat.paddingRight).toBe(16)
      expect(flat.backgroundColor).toBe('#FAFAF7')
    } finally {
      __resetLookupCssState()
    }
  })

  it('caller-supplied `us` (sibling style={…}) merges in last so user inline styles override atoms', () => {
    __registerAtomsFromRecord({ 'p-4': { padding: 16 } })
    try {
      const userStyle = { padding: 32 }
      const { UNSAFE_getByType: getByType } = render(
        createElement(InteractiveBox, {
          _rw: { as: Probe, cn: 'p-4', t: ctx('base'), us: userStyle },
        }),
      )
      const probe = getByType(Probe)
      const styleArray = probe.props.style as Array<Record<string, unknown>>
      const flat = Object.assign({}, ...styleArray)
      // RN flattens left-to-right; userStyle (passed as `us`) lands last,
      // so it wins over the class-derived padding.
      expect(flat.padding).toBe(32)
    } finally {
      __resetLookupCssState()
    }
  })

  it('an empty / unregistered className string yields an empty style array (does not throw)', () => {
    const { UNSAFE_getByType: getByType } = render(
      createElement(InteractiveBox, {
        _rw: { as: Probe, cn: 'totally-unknown-class', t: ctx('base') },
      }),
    )
    const probe = getByType(Probe)
    expect(probe.props.style).toEqual([])
  })
})
