import { describe, expect, it } from 'bun:test'
import { createElement, type ComponentType } from 'react'
import { render } from '@testing-library/react-native'
import { __registerAtomsFromRecord, __resetLookupCssState } from '../../src/runtime/lookup-css'
import { InteractiveBox } from '../../src/runtime/interactive-box'
import { ctx } from './_ctx'

/**
 * Reproduces the user's FlatFlashList chain shape one runtime hop at a
 * time, so the regression "any className passed to <StyledFlashList> is
 * ignored" can be definitively localised.
 *
 * Chain under test:
 *   `<FlatFlashList className="px-4 bg-background" />` (mobile-expanse)
 *     → `<StyledFlashList {...rest} className={className} style={style}
 *         contentContainerClassName={contentContainerClassName}
 *         contentContainerStyle={resolvedContentContainerStyle} />` (ui)
 *     ─ transformer rewrites this site →
 *   `<_ib {...rest} _rw={{as: StyledFlashList, cn: className, t: _t,
 *         us: style}}
 *         contentContainerStyle={_l(contentContainerClassName, _t,
 *         resolvedContentContainerStyle)} />`
 *
 * If `_ib` actually feeds the right `style` prop into the wrapped
 * `StyledFlashList` mock, the runtime chain is sound — and any "ignored"
 * symptom in the running app is downstream (Metro bundle staleness,
 * `@shopify/flash-list`'s own behaviour, the user's mock setup, etc.).
 */
describe('runtime: <FlatFlashList /> chain delivers className-resolved style to StyledFlashList', () => {
  it('user className "px-4 bg-background" lands as a finite RN style on the wrapped tag', () => {
    const PX_4 = { paddingLeft: 16, paddingRight: 16 }
    const BG = { backgroundColor: '#FAFAF7' }
    __registerAtomsFromRecord({ 'px-4': PX_4, 'bg-background': BG })
    try {
      // Captures the style array `_ib` would hand to FlashList. A class
      // component lets us inspect props through @testing-library/react-native's
      // tree without relying on imperative refs.
      let capturedProps: Record<string, unknown> | null = null
      const StyledFlashListMock: ComponentType<Record<string, unknown>> = (props): null => {
        capturedProps = props
        return null
      }
      // What the rewritten flat-flash-list.tsx renders at runtime — the
      // SAME shape `transformAst` produces (see host-detection.test.ts +
      // a manual dump from `transformAst` on the real file).
      render(
        createElement(InteractiveBox, {
          // Spread props first (mimics `{...flashListProps}`).
          'data-test': 'forwarded-passthrough',
          // _rw spec packed by transformer.
          _rw: { as: StyledFlashListMock, cn: 'px-4 bg-background', t: ctx('base'), us: undefined },
          // contentContainerStyle is set explicitly by the transformer's
          // `_l(contentContainerClassName, _t, resolvedContentContainerStyle)`.
          // Pass an already-resolved array to mirror the runtime shape.
          contentContainerStyle: [{ paddingBottom: 96 }],
        }),
      )

      // The mocked FlashList must have received a populated style array.
      expect(capturedProps).not.toBeNull()
      const props = capturedProps as unknown as Record<string, unknown>
      const style = props.style as Array<Record<string, unknown>>
      expect(Array.isArray(style)).toBe(true)
      expect(style.length).toBeGreaterThan(0)

      // Flatten to verify the EXACT atoms reach the wrapped component.
      const flat = Object.assign({}, ...style)
      expect(flat.paddingLeft).toBe(16)
      expect(flat.paddingRight).toBe(16)
      expect(flat.backgroundColor).toBe('#FAFAF7')

      // The non-rnwind passthrough props survive intact.
      expect(props['data-test']).toBe('forwarded-passthrough')
      // contentContainerStyle stays as-is (transformer-built array).
      expect(props.contentContainerStyle).toEqual([{ paddingBottom: 96 }])
    } finally {
      __resetLookupCssState()
    }
  })

  it('reproduces the spread-vs-explicit ordering — explicit style wins over what comes through the spread', () => {
    __registerAtomsFromRecord({ 'p-4': { padding: 16 } })
    try {
      let capturedProps: Record<string, unknown> | null = null
      const StyledMock: ComponentType<Record<string, unknown>> = (props): null => {
        capturedProps = props
        return null
      }
      // Feed _ib a "user style" via the `us` slot — the value the user
      // wrote inline as `style={someTextStyle}` on FlatFlashList.
      const userStyle = { padding: 32 }
      render(
        createElement(InteractiveBox, {
          _rw: { as: StyledMock, cn: 'p-4', t: ctx('base'), us: userStyle },
        }),
      )
      const props = capturedProps as unknown as Record<string, unknown>
      const flat = Object.assign({}, ...(props.style as Array<Record<string, unknown>>))
      // RN flatten is left-to-right; userStyle is the last positional in
      // lookupCss → user always wins. This is the same precedence rule
      // documented in docs/architecture.md.
      expect(flat.padding).toBe(32)
    } finally {
      __resetLookupCssState()
    }
  })

  it('atom name registered at runtime determines what reaches the inner component (no atom = empty array)', () => {
    // Intentionally do NOT register `px-4` so we can prove the system
    // would silently produce an empty style if the cache were stale —
    // matching the user's "className is ignored" symptom exactly.
    let capturedProps: Record<string, unknown> | null = null
    const StyledMock: ComponentType<Record<string, unknown>> = (props): null => {
      capturedProps = props
      return null
    }
    render(
      createElement(InteractiveBox, {
        _rw: { as: StyledMock, cn: 'px-4', t: ctx('base'), us: undefined },
      }),
    )
    const props = capturedProps as unknown as Record<string, unknown>
    expect(props.style).toEqual([])
  })
})
