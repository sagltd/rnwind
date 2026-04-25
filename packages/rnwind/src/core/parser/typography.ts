import type { Display, FontSize, FontWeight, LineHeight, ZIndex } from 'lightningcss'
import { dimensionPercentageToNumber } from './length'
import type { RNEntry } from './types'

/**
 * Expand lightningcss's `Display` typed value to an RN `{display}` entry.
 *  - `keyword` variant (`none`, `flex`, `grid`, `inline`, …) passes through.
 *  - `pair` variant (the modern CSS model — `{inside: {type}, outside,
 *    isListItem}`) collapses to RN's `'flex'` / `'grid'` when the inside
 *    type matches, otherwise skips.
 * @param value Typed display value.
 * @returns RN entries (zero or one).
 */
export function displayToEntries(value: Display): readonly RNEntry[] {
  if (value.type === 'keyword') return [['display', value.value]]
  if (value.type === 'pair') {
    const inside = value.inside.type
    // `flow` is the default inside mode — maps to `block` / `inline` /
    // `inline-block` based on the outer; RN only distinguishes `block`-ish
    // from `flex`, so collapse the `flow` family to the `outside` keyword.
    if (inside === 'flow') return [['display', value.outside]]
    if (inside === 'flex') return [['display', 'flex']]
    if (inside === 'grid') return [['display', 'grid']]
  }
  return []
}

/**
 * Convert `FontSize` to a pixel number. The `length` variant carries a
 * `DimensionPercentage`; `absolute` / `relative` keyword variants have no
 * RN numeric equivalent and get dropped.
 * @param value Typed font-size value.
 * @returns Pixel size, or `null` when not a pure length.
 */
export function fontSizeToPx(value: FontSize): number | null {
  if (value.type !== 'length') return null
  const length = dimensionPercentageToNumber(value.value)
  if (typeof length !== 'number') return null
  return length
}

/**
 * Convert `FontWeight` to the form RN accepts — numbers for absolute
 * weights, `'bolder'` / `'lighter'` keywords pass through as strings.
 * @param value Typed font-weight value.
 * @returns RN font weight.
 */
export function fontWeightToValue(value: FontWeight): number | string {
  if (value.type === 'absolute') {
    if (value.value.type === 'weight') return value.value.value
    return value.value.type
  }
  return value.type
}

/**
 * Coerce `z-index` to a number. `{type: 'auto'}` has no RN equivalent so
 * it collapses to 0.
 * @param value Typed z-index value.
 * @returns Integer z-index.
 */
export function zIndexToNumber(value: ZIndex): number {
  if (value.type === 'auto') return 0
  return value.value
}

/**
 * Convert lightningcss `LineHeight` into RN's `lineHeight` entry. RN
 * accepts a single number (pixel value). For unitless multipliers we
 * multiply by the default 16-px font size (RN's base); for px values we
 * pass through; percentages are approximated the same way.
 * @param value Typed line-height.
 * @returns RN entry.
 */
export function lineHeightToEntries(value: LineHeight): readonly RNEntry[] {
  if (value.type === 'normal') return [['lineHeight', 20]]
  if (value.type === 'number') return [['lineHeight', Math.round(value.value * 16 * 10_000) / 10_000]]
  if (value.type === 'length') {
    const px = dimensionPercentageToNumber(value.value)
    if (typeof px === 'number') return [['lineHeight', Math.round(px * 10_000) / 10_000]]
  }
  return []
}
