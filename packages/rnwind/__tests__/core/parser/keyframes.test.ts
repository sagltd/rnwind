import { describe, expect, it } from 'bun:test'
import { keyframeSelectorOffset, keyframesName, pickAnimationName } from '../../../src/core/parser/keyframes'

describe('keyframesName', () => {
  it('returns the name when non-empty', () => {
    expect(keyframesName({ value: 'spin' } as never)).toBe('spin')
  })
  it('returns null when empty or not a string', () => {
    expect(keyframesName({ value: '' } as never)).toBeNull()
    expect(keyframesName({ value: 42 } as never)).toBeNull()
  })
})

describe('keyframeSelectorOffset', () => {
  it('empty selector list → null', () => {
    expect(keyframeSelectorOffset([])).toBeNull()
  })
  it("'from' / 'to' pass through", () => {
    expect(keyframeSelectorOffset([{ type: 'from' }] as never)).toBe('from')
    expect(keyframeSelectorOffset([{ type: 'to' }] as never)).toBe('to')
  })
  it('percentage becomes "N%"', () => {
    expect(keyframeSelectorOffset([{ type: 'percentage', value: 0.5 }] as never)).toBe('50%')
  })
  it('unknown selector types return null', () => {
    expect(keyframeSelectorOffset([{ type: 'timeline-range-offset' }] as never)).toBeNull()
  })
})

describe('pickAnimationName', () => {
  it('animation shorthand — first ident', () => {
    expect(
      pickAnimationName({
        property: 'animation',
        value: [{ name: { type: 'ident', value: 'spin' } }],
      } as never),
    ).toBe('spin')
  })
  it('animation shorthand — skips type=none', () => {
    expect(
      pickAnimationName({
        property: 'animation',
        value: [{ name: { type: 'none' } }, { name: { type: 'ident', value: 'pulse' } }],
      } as never),
    ).toBe('pulse')
  })
  it('animation shorthand — string name', () => {
    expect(
      pickAnimationName({
        property: 'animation',
        value: [{ name: { type: 'string', value: 'my-anim' } }],
      } as never),
    ).toBe('my-anim')
  })
  it('animation-name longhand — first ident', () => {
    expect(
      pickAnimationName({
        property: 'animation-name',
        value: [{ type: 'ident', value: 'bounce' }],
      } as never),
    ).toBe('bounce')
  })
  it('unparsed animation-name — first ident token', () => {
    expect(
      pickAnimationName({
        property: 'unparsed',
        value: {
          propertyId: { property: 'animation-name' },
          value: [{ type: 'token', value: { type: 'ident', value: 'my-keyframes' } }],
        },
      } as never),
    ).toBe('my-keyframes')
  })
  it('unparsed with dashed-ident', () => {
    expect(
      pickAnimationName({
        property: 'unparsed',
        value: {
          propertyId: { property: 'animation' },
          value: [{ type: 'dashed-ident', value: '--custom-anim' }],
        },
      } as never),
    ).toBe('--custom-anim')
  })
  it('unparsed for non-animation property → null', () => {
    expect(
      pickAnimationName({
        property: 'unparsed',
        value: { propertyId: { property: 'color' }, value: [] },
      } as never),
    ).toBeNull()
  })
  it('non-animation property → null', () => {
    expect(pickAnimationName({ property: 'color' } as never)).toBeNull()
  })
  it('animation with all-none names → null', () => {
    expect(
      pickAnimationName({
        property: 'animation',
        value: [{ name: { type: 'none' } }],
      } as never),
    ).toBeNull()
  })
  it('animation-name with non-ident entries → null', () => {
    expect(
      pickAnimationName({
        property: 'animation-name',
        value: [{ type: 'none' }],
      } as never),
    ).toBeNull()
  })
  it('unparsed animation with no ident tokens → null', () => {
    expect(
      pickAnimationName({
        property: 'unparsed',
        value: {
          propertyId: { property: 'animation-name' },
          value: [{ type: 'token', value: { type: 'white-space', value: ' ' } }],
        },
      } as never),
    ).toBeNull()
  })
})
