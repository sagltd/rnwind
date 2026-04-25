import { afterEach, describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { act, render } from '@testing-library/react-native'
import { __registerAtomsFromRecord, __resetLookupCssState } from '../../src/runtime/lookup-css'
import { InteractiveBox } from '../../src/runtime/interactive-box'
import { RnwindProvider } from '../../src/runtime'
import { ctx } from './_ctx'

afterEach(() => {
  __resetLookupCssState()
})

/**
 * High-fidelity reproduction of the user's bug report: active-variant
 * effects on `<Pressable className="active:bg-sky-700" />` appear to
 * "do nothing" in the running expo-go app.
 *
 * This test replicates the full transformer pipeline for a single
 * interactive element (parser-produced atom registry shape +
 * transformer-produced `<InteractiveBox>` + real React render) and
 * asserts that the *style prop the inner RN component receives* flips
 * to include the active atom when `onPressIn` fires. If that assertion
 * holds end-to-end, the UI path is intact; if it fails we have a
 * concrete reproduction.
 */
describe('InteractiveBox integration — props propagate end-to-end', () => {
  it('wrapping a Pressable-shaped component: onPressIn flips the inner style prop', () => {
    // Parser-produced atom shape (multi-scheme theme, active-uniform
    // across schemes). In the new model the atom value is the bare
    // style; `precomputeHoist` detects the `active:` prefix and routes
    // it into the stated hoist's 4-state precompute.
    __registerAtomsFromRecord({
      'bg-sky-500': { backgroundColor: '#00a6f4' },
      'active:bg-sky-700': { backgroundColor: '#0069a8' },
      'transition-colors': { transitionDuration: '150ms' },
    })
    const cn = ['bg-sky-500', 'active:bg-sky-700', 'transition-colors']

    // Minimal Pressable stand-in. Renders nothing, forwards its props.
    // We deliberately do NOT stub RN's Pressable — this test runs
    // InteractiveBox against a plain component so the only thing
    // exercised is the rnwind-side composition.
    interface PressableLikeProps {
      onPressIn?: () => void
      onPressOut?: () => void
      style?: unknown
      children?: unknown
    }
    const PressableLike = (_props: PressableLikeProps): null => null

    const { UNSAFE_getByType: getByType } = render(
      createElement(
        RnwindProvider,
        { scheme: 'light' },
        createElement(InteractiveBox, {
          _rw: { as: PressableLike, cn, t: ctx('light') },
          children: 'button',
        }),
      ),
    )

    const inner = getByType(PressableLike)
    // Baseline: just the two non-interactive atoms, no active.
    expect(inner.props.style).toEqual([{ backgroundColor: '#00a6f4' }, { transitionDuration: '150ms' }])
    // Sanity — rnwind MUST have attached onPressIn so the press can drive state.
    expect(typeof inner.props.onPressIn).toBe('function')

    act(() => {
      inner.props.onPressIn()
    })
    // After press the inner component must receive a style array that
    // contains the active atom. If this fails, the rendered Pressable
    // would never see the active ref and the user's UI stays flat —
    // which is exactly the bug report.
    const after = getByType(PressableLike)
    expect(after.props.style).toEqual([
      { backgroundColor: '#00a6f4' },
      { backgroundColor: '#0069a8' },
      { transitionDuration: '150ms' },
    ])
  })
})
