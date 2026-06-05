import { describe, expect, it } from 'bun:test'
import {
  displayToEntries,
  fontSizeToPx,
  fontWeightToValue,
  lineHeightToEntries,
  zIndexToNumber,
} from '../../../src/core/parser/typography'

describe('displayToEntries', () => {
  it('RN-valid keyword (none/flex/contents) passes through', () => {
    expect(displayToEntries({ type: 'keyword', value: 'none' } as never)).toEqual([['display', 'none']])
    expect(displayToEntries({ type: 'keyword', value: 'flex' } as never)).toEqual([['display', 'flex']])
    expect(displayToEntries({ type: 'keyword', value: 'contents' } as never)).toEqual([['display', 'contents']])
  })
  it('web-only keyword (block/inline/grid) → dropped (RN has no analog)', () => {
    expect(displayToEntries({ type: 'keyword', value: 'block' } as never)).toEqual([])
    expect(displayToEntries({ type: 'keyword', value: 'inline' } as never)).toEqual([])
    expect(displayToEntries({ type: 'keyword', value: 'grid' } as never)).toEqual([])
  })
  it('pair with flow (block/inline) → dropped', () => {
    expect(
      displayToEntries({
        type: 'pair',
        inside: { type: 'flow' },
        outside: 'block',
        isListItem: false,
      } as never),
    ).toEqual([])
  })
  it('pair with flex → "flex"; grid → dropped', () => {
    expect(displayToEntries({ type: 'pair', inside: { type: 'flex' }, outside: 'block', isListItem: false } as never)).toEqual([
      ['display', 'flex'],
    ])
    expect(displayToEntries({ type: 'pair', inside: { type: 'grid' }, outside: 'block', isListItem: false } as never)).toEqual([])
  })
  it('unknown pair shape → empty', () => {
    expect(displayToEntries({ type: 'pair', inside: { type: 'table' }, outside: 'block', isListItem: false } as never)).toEqual(
      [],
    )
  })
  it('unknown top-level type → empty', () => {
    expect(displayToEntries({ type: 'other' } as never)).toEqual([])
  })
})

describe('fontSizeToPx', () => {
  it('length variant', () => {
    expect(fontSizeToPx({ type: 'length', value: { type: 'dimension', value: { unit: 'px', value: 18 } } } as never)).toBe(18)
  })
  it('absolute keyword → null', () => {
    expect(fontSizeToPx({ type: 'absolute', value: 'medium' } as never)).toBeNull()
  })
  it('length variant with non-numeric (percentage) → null', () => {
    expect(fontSizeToPx({ type: 'length', value: { type: 'percentage', value: 0.5 } } as never)).toBeNull()
  })
})

describe('fontWeightToValue', () => {
  it('absolute weight number', () => {
    expect(fontWeightToValue({ type: 'absolute', value: { type: 'weight', value: 600 } } as never)).toBe(600)
  })
  it('absolute normal/bold keywords', () => {
    expect(fontWeightToValue({ type: 'absolute', value: { type: 'normal' } } as never)).toBe('normal')
    expect(fontWeightToValue({ type: 'absolute', value: { type: 'bold' } } as never)).toBe('bold')
  })
  it('bolder/lighter', () => {
    expect(fontWeightToValue({ type: 'bolder' } as never)).toBe('bolder')
    expect(fontWeightToValue({ type: 'lighter' } as never)).toBe('lighter')
  })
})

describe('zIndexToNumber', () => {
  it('auto → 0', () => expect(zIndexToNumber({ type: 'auto' } as never)).toBe(0))
  it('integer passes through', () => expect(zIndexToNumber({ type: 'integer', value: 42 } as never)).toBe(42))
})

describe('lineHeightToEntries', () => {
  it('normal → 20', () => {
    expect(lineHeightToEntries({ type: 'normal' } as never)).toEqual([['lineHeight', 20]])
  })
  it('number multiplies by 16', () => {
    expect(lineHeightToEntries({ type: 'number', value: 1.5 } as never)).toEqual([['lineHeight', 24]])
  })
  it('length px passes through', () => {
    expect(
      lineHeightToEntries({
        type: 'length',
        value: { type: 'dimension', value: { unit: 'px', value: 22 } },
      } as never),
    ).toEqual([['lineHeight', 22]])
  })
  it('length percentage → empty', () => {
    expect(lineHeightToEntries({ type: 'length', value: { type: 'percentage', value: 0.5 } } as never)).toEqual([])
  })
  it('unknown shape → empty', () => {
    expect(lineHeightToEntries({ type: 'what' } as never)).toEqual([])
  })
})
