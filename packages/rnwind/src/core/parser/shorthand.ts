import type {
  BorderColor,
  BorderRadius,
  Flex,
  Gap,
  Margin,
  MarginBlock,
  MarginInline,
  Padding,
  PaddingBlock,
  PaddingInline,
} from 'lightningcss'
import { cssColorToString } from './color'
import { dimensionPercentageToNumber, gapValueToValue, lengthPercentageOrAutoToValue } from './length'
import type { RNEntry } from './types'

/**
 * Expand `margin` / `padding` shorthand (`{top, right, bottom, left}`) to
 * RN entries. When all four sides share the same converted value, collapse
 * to the single-key shorthand RN accepts; otherwise emit four longhands.
 * @param property `'padding'` or `'margin'`.
 * @param value Typed shorthand record.
 * @returns RN entries.
 */
export function expandFourSided(property: 'padding' | 'margin', value: Padding | Margin): readonly RNEntry[] {
  const top = lengthPercentageOrAutoToValue(value.top)
  const right = lengthPercentageOrAutoToValue(value.right)
  const bottom = lengthPercentageOrAutoToValue(value.bottom)
  const left = lengthPercentageOrAutoToValue(value.left)
  if (top === null || right === null || bottom === null || left === null) return []
  if (top === right && right === bottom && bottom === left) return [[property, top]]
  return [
    [`${property}Top`, top],
    [`${property}Right`, right],
    [`${property}Bottom`, bottom],
    [`${property}Left`, left],
  ]
}

/**
 * Expand `padding-inline` / `margin-inline` (logical property) into RN's
 * physical left / right pair. RN has no RTL-aware logical props at the
 * style-object level, so we lower at compile time.
 * @param property `'padding'` or `'margin'`.
 * @param value Typed inline shorthand.
 * @returns RN entries.
 */
export function expandLogicalInline(property: 'padding' | 'margin', value: PaddingInline | MarginInline): readonly RNEntry[] {
  const start = lengthPercentageOrAutoToValue(value.inlineStart)
  const end = lengthPercentageOrAutoToValue(value.inlineEnd)
  if (start === null || end === null) return []
  return [
    [`${property}Left`, start],
    [`${property}Right`, end],
  ]
}

/**
 * Expand `padding-block` / `margin-block` (logical property) into RN's
 * physical top / bottom pair.
 * @param property `'padding'` or `'margin'`.
 * @param value Typed block shorthand.
 * @returns RN entries.
 */
export function expandLogicalBlock(property: 'padding' | 'margin', value: PaddingBlock | MarginBlock): readonly RNEntry[] {
  const start = lengthPercentageOrAutoToValue(value.blockStart)
  const end = lengthPercentageOrAutoToValue(value.blockEnd)
  if (start === null || end === null) return []
  return [
    [`${property}Top`, start],
    [`${property}Bottom`, end],
  ]
}

/**
 * Expand a `border-radius` shorthand into RN corner entries. Each corner
 * is a 2-tuple `[x, y]` in lightningcss; RN exposes one radius per corner
 * so we use the x-axis. When all four corners match, collapse to the
 * single `borderRadius` key.
 * @param value Typed `BorderRadius` record.
 * @returns RN entries.
 */
export function expandBorderRadius(value: BorderRadius): readonly RNEntry[] {
  const corners: Array<[string, number | string | null]> = [
    ['borderTopLeftRadius', dimensionPercentageToNumber(value.topLeft[0])],
    ['borderTopRightRadius', dimensionPercentageToNumber(value.topRight[0])],
    ['borderBottomRightRadius', dimensionPercentageToNumber(value.bottomRight[0])],
    ['borderBottomLeftRadius', dimensionPercentageToNumber(value.bottomLeft[0])],
  ]
  const [first] = corners
  if (first?.[1] == null) return []
  if (corners.every(([, v]) => v === first[1])) return [['borderRadius', first[1]]]
  return corners.filter((entry): entry is [string, number | string] => entry[1] !== null)
}

/**
 * Expand a `border-color` shorthand into RN longhands. When all four
 * sides match, collapse to a single `borderColor`; otherwise emit per-side
 * props.
 * @param value Typed `BorderColor` record.
 * @returns RN entries.
 */
export function expandBorderColor(value: BorderColor): readonly RNEntry[] {
  const top = cssColorToString(value.top)
  const right = cssColorToString(value.right)
  const bottom = cssColorToString(value.bottom)
  const left = cssColorToString(value.left)
  if (top === right && right === bottom && bottom === left) return [['borderColor', top]]
  return [
    ['borderTopColor', top],
    ['borderRightColor', right],
    ['borderBottomColor', bottom],
    ['borderLeftColor', left],
  ]
}

/**
 * Expand `gap` shorthand (`{row, column}`) into RN entries. When both
 * axes equal the same value collapse to the single `gap` key; otherwise
 * emit `rowGap` + `columnGap`.
 * @param value Typed `Gap` record.
 * @returns RN entries.
 */
export function expandGap(value: Gap): readonly RNEntry[] {
  const row = gapValueToValue(value.row)
  const column = gapValueToValue(value.column)
  if (row === null || column === null) return []
  if (row === column) return [['gap', row]]
  return [
    ['rowGap', row],
    ['columnGap', column],
  ]
}

/**
 * Convert `Flex` shorthand to RN entries. When the shape matches `flex:
 * 1` (`{grow:1, shrink:1, basis: 0%}`), emit the single `flex` key RN
 * understands. Otherwise expand to the three longhands.
 * @param value Typed `Flex` record.
 * @returns RN entries.
 */
export function flexToEntries(value: Flex): readonly RNEntry[] {
  const basis = lengthPercentageOrAutoToValue(value.basis)
  if (basis === null) return []
  if (value.grow === 1 && value.shrink === 1 && basis === '0%') return [['flex', 1]]
  const entries: RNEntry[] = [
    ['flexGrow', value.grow],
    ['flexShrink', value.shrink],
  ]
  if (basis !== 'auto') entries.push(['flexBasis', basis])
  return entries
}
