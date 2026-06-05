import type { Display, FontSize, FontWeight, LineHeight, ZIndex } from 'lightningcss'
import { dimensionPercentageToNumber } from './length'
import type { RNEntry } from './types'

/**
 * Display values React Native's `display` style prop actually accepts.
 * Everything else (`block`, `inline`, `inline-block`, `grid`, `table`, …)
 * has no RN analog — RN lays out as flex by default, and emitting an invalid
 * value triggers a dev warning + silent drop. So we drop them outright.
 */
const RN_DISPLAY_VALUES: ReadonlySet<string> = new Set(['none', 'flex', 'contents'])

/**
 * Expand lightningcss's `Display` typed value to an RN `{display}` entry,
 * keeping only the values RN supports (`none` / `flex` / `contents`).
 *  - `keyword` variant emits only when the keyword is RN-valid.
 *  - `pair` variant (the modern CSS model) collapses `flex` inside to
 *    `'flex'`; `flow` (`block`/`inline`) and `grid` have no RN analog → drop.
 * @param value Typed display value.
 * @returns RN entries (zero or one).
 */
export function displayToEntries(value: Display): readonly RNEntry[] {
  if (value.type === 'keyword') return RN_DISPLAY_VALUES.has(value.value) ? [['display', value.value]] : []
  if (value.type === 'pair' && value.inside.type === 'flex') return [['display', 'flex']]
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
