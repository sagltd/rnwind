import { describe, expect, it } from 'bun:test'
import {
  expandBorderColor,
  expandBorderRadius,
  expandFourSided,
  expandGap,
  expandLogicalBlock,
  expandLogicalInline,
  flexToEntries,
} from '../../../src/core/parser/shorthand'

/**
 * Build a typed length-percentage with a px dimension.
 * @param value Number of pixels.
 * @returns Typed dimension node.
 */
const pxDim = (value: number) => ({ type: 'dimension' as const, value: { unit: 'px' as const, value } })
/**
 * Build a `DimensionPercentageForLengthPercentageOrAuto` pixel length — used by `padding` / `margin`.
 * @param value Number of pixels.
 * @returns Typed length-percentage node.
 */
const pxLength = (value: number) => ({ type: 'length-percentage' as const, value: pxDim(value) })
const autoLength = { type: 'auto' as const }

describe('expandFourSided (padding/margin)', () => {
  it('collapses when all four sides match', () => {
    expect(
      expandFourSided('padding', {
        top: pxLength(8),
        right: pxLength(8),
        bottom: pxLength(8),
        left: pxLength(8),
      } as never),
    ).toEqual([['padding', 8]])
  })

  it('expands when sides differ', () => {
    const entries = expandFourSided('margin', {
      top: pxLength(4),
      right: pxLength(8),
      bottom: pxLength(12),
      left: pxLength(16),
    } as never)
    expect(entries).toEqual([
      ['marginTop', 4],
      ['marginRight', 8],
      ['marginBottom', 12],
      ['marginLeft', 16],
    ])
  })

  it('collapses `auto` when every side is auto', () => {
    expect(
      expandFourSided('margin', {
        top: autoLength,
        right: autoLength,
        bottom: autoLength,
        left: autoLength,
      } as never),
    ).toEqual([['margin', 'auto']])
  })

  it('returns empty when any side is unrepresentable', () => {
    expect(
      expandFourSided('padding', {
        top: pxLength(8),
        right: pxLength(8),
        bottom: pxLength(8),
        left: { type: 'length-percentage', value: { type: 'calc', value: { type: 'number', value: 1 } } },
      } as never),
    ).toEqual([])
  })

  it('collapses both axes when horizontal and vertical pairs match', () => {
    expect(
      expandFourSided('padding', {
        top: pxLength(4),
        right: pxLength(8),
        bottom: pxLength(4),
        left: pxLength(8),
      } as never),
    ).toEqual([
      ['paddingVertical', 4],
      ['paddingHorizontal', 8],
    ])
  })

  it('collapses horizontal axis only when verticals differ', () => {
    expect(
      expandFourSided('margin', {
        top: pxLength(4),
        right: pxLength(8),
        bottom: pxLength(12),
        left: pxLength(8),
      } as never),
    ).toEqual([
      ['marginTop', 4],
      ['marginBottom', 12],
      ['marginHorizontal', 8],
    ])
  })

  it('collapses vertical axis only when horizontals differ', () => {
    expect(
      expandFourSided('padding', {
        top: pxLength(4),
        right: pxLength(8),
        bottom: pxLength(4),
        left: pxLength(12),
      } as never),
    ).toEqual([
      ['paddingVertical', 4],
      ['paddingRight', 8],
      ['paddingLeft', 12],
    ])
  })
})

describe('expandLogicalInline / expandLogicalBlock', () => {
  it('inline maps to Left/Right when sides differ', () => {
    expect(
      expandLogicalInline('padding', {
        inlineStart: pxLength(4),
        inlineEnd: pxLength(8),
      } as never),
    ).toEqual([
      ['paddingLeft', 4],
      ['paddingRight', 8],
    ])
  })
  it('inline collapses to Horizontal when sides match', () => {
    expect(
      expandLogicalInline('padding', {
        inlineStart: pxLength(8),
        inlineEnd: pxLength(8),
      } as never),
    ).toEqual([['paddingHorizontal', 8]])
  })
  it('block maps to Top/Bottom when sides differ', () => {
    expect(
      expandLogicalBlock('margin', {
        blockStart: pxLength(4),
        blockEnd: pxLength(8),
      } as never),
    ).toEqual([
      ['marginTop', 4],
      ['marginBottom', 8],
    ])
  })
  it('block collapses to Vertical when sides match', () => {
    expect(
      expandLogicalBlock('margin', {
        blockStart: pxLength(8),
        blockEnd: pxLength(8),
      } as never),
    ).toEqual([['marginVertical', 8]])
  })
  it('returns empty when sides are unrepresentable', () => {
    expect(
      expandLogicalInline('padding', {
        inlineStart: { type: 'length-percentage', value: { type: 'calc', value: { type: 'number', value: 1 } } },
        inlineEnd: pxLength(8),
      } as never),
    ).toEqual([])
    expect(
      expandLogicalBlock('padding', {
        blockStart: pxLength(4),
        blockEnd: { type: 'length-percentage', value: { type: 'calc', value: { type: 'number', value: 1 } } },
      } as never),
    ).toEqual([])
  })
})

describe('expandBorderRadius', () => {
  it('collapses when every corner matches', () => {
    expect(
      expandBorderRadius({
        topLeft: [pxDim(6)],
        topRight: [pxDim(6)],
        bottomRight: [pxDim(6)],
        bottomLeft: [pxDim(6)],
      } as never),
    ).toEqual([['borderRadius', 6]])
  })

  it('expands when corners differ', () => {
    const entries = expandBorderRadius({
      topLeft: [pxDim(4)],
      topRight: [pxDim(8)],
      bottomRight: [pxDim(12)],
      bottomLeft: [pxDim(16)],
    } as never)
    expect(entries).toEqual([
      ['borderTopLeftRadius', 4],
      ['borderTopRightRadius', 8],
      ['borderBottomRightRadius', 12],
      ['borderBottomLeftRadius', 16],
    ])
  })

  it('returns empty when the first corner is unrepresentable', () => {
    expect(
      expandBorderRadius({
        topLeft: [{ type: 'calc', value: { type: 'number', value: 1 } }],
        topRight: [pxDim(8)],
        bottomRight: [pxDim(8)],
        bottomLeft: [pxDim(8)],
      } as never),
    ).toEqual([])
  })
})

describe('expandBorderColor', () => {
  it('collapses when every side matches', () => {
    expect(
      expandBorderColor({
        top: { type: 'rgb', r: 0, g: 0, b: 0, alpha: 1 },
        right: { type: 'rgb', r: 0, g: 0, b: 0, alpha: 1 },
        bottom: { type: 'rgb', r: 0, g: 0, b: 0, alpha: 1 },
        left: { type: 'rgb', r: 0, g: 0, b: 0, alpha: 1 },
      } as never),
    ).toEqual([['borderColor', '#000000']])
  })

  it('expands when sides differ', () => {
    const entries = expandBorderColor({
      top: { type: 'rgb', r: 255, g: 0, b: 0, alpha: 1 },
      right: { type: 'rgb', r: 0, g: 255, b: 0, alpha: 1 },
      bottom: { type: 'rgb', r: 0, g: 0, b: 255, alpha: 1 },
      left: { type: 'rgb', r: 255, g: 255, b: 0, alpha: 1 },
    } as never)
    expect(entries).toEqual([
      ['borderTopColor', '#ff0000'],
      ['borderRightColor', '#00ff00'],
      ['borderBottomColor', '#0000ff'],
      ['borderLeftColor', '#ffff00'],
    ])
  })
})

describe('expandGap', () => {
  it('collapses when axes match', () => {
    expect(
      expandGap({
        row: { type: 'length-percentage', value: pxDim(4) },
        column: { type: 'length-percentage', value: pxDim(4) },
      } as never),
    ).toEqual([['gap', 4]])
  })
  it('expands when axes differ', () => {
    const entries = expandGap({
      row: { type: 'length-percentage', value: pxDim(4) },
      column: { type: 'length-percentage', value: pxDim(8) },
    } as never)
    expect(entries).toEqual([
      ['rowGap', 4],
      ['columnGap', 8],
    ])
  })
  it('returns empty when either axis is unrepresentable', () => {
    expect(
      expandGap({
        row: { type: 'normal' },
        column: { type: 'length-percentage', value: pxDim(8) },
      } as never),
    ).toEqual([])
  })
})

describe('flexToEntries', () => {
  it('flex:1 collapses to {flex:1}', () => {
    expect(
      flexToEntries({
        grow: 1,
        shrink: 1,
        basis: { type: 'length-percentage', value: { type: 'percentage', value: 0 } },
      } as never),
    ).toEqual([['flex', 1]])
  })
  it('general flex expands to 3 longhands', () => {
    const entries = flexToEntries({
      grow: 2,
      shrink: 3,
      basis: { type: 'length-percentage', value: pxDim(100) },
    } as never)
    expect(entries).toEqual([
      ['flexGrow', 2],
      ['flexShrink', 3],
      ['flexBasis', 100],
    ])
  })
  it('auto basis skips flexBasis', () => {
    const entries = flexToEntries({
      grow: 1,
      shrink: 1,
      basis: autoLength,
    } as never)
    expect(entries).toEqual([
      ['flexGrow', 1],
      ['flexShrink', 1],
    ])
  })
  it('returns empty when basis is unrepresentable', () => {
    expect(
      flexToEntries({
        grow: 1,
        shrink: 1,
        basis: { type: 'length-percentage', value: { type: 'calc', value: { type: 'number', value: 1 } } },
      } as never),
    ).toEqual([])
  })
})
