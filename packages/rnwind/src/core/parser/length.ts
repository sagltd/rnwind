import type {
  DimensionPercentageFor_LengthValue as LcDimensionPercentage,
  GapValue,
  LengthPercentageOrAuto,
  LengthValue,
  MaxSize,
  Size,
} from 'lightningcss'
import { REM_TO_PX } from './constants'

/** Alias for lightningcss's snake_case dimension-or-percentage type. */
type DimensionPercentage = LcDimensionPercentage

/** RN-compatible length/percent result, or `null` when unrepresentable. */
type LengthResult = number | string | null

/**
 * Round a percentage / length float to 4 decimal places so lightningcss's
 * IEEE-754 noise (`0.237 → 0.23700000345…`) doesn't leak into RN style
 * strings. 4 decimals is well below CSS subpixel precision.
 * @param n Raw float.
 * @returns Rounded float with trailing zeros trimmed.
 */
function roundFloat(n: number): number {
  return Math.round(n * 10_000) / 10_000
}

/**
 * "Fully rounded" sentinel — emitted for Tailwind's `rounded-full` (and
 * any other utility expanding to `calc(infinity * 1px)`). RN can't
 * render `Infinity` as a style value (the StyleSheet validator silently
 * drops it), but it accepts a finite large pixel count and renders the
 * same pill / circle shape. 9999 covers every realistic phone screen.
 */
const FULLY_ROUNDED_PX = 9999

/**
 * Convert a lightningcss `LengthValue` to a pixel number. Handles the
 * units Tailwind emits: px, rem, em. Tailwind v4's "fully rounded"
 * expansion (`calc(infinity * 1px)`) lands here as `value === Infinity`
 * — we clamp to a finite sentinel so RN can render it. Other non-finite
 * values (NaN from a malformed expression) are clamped to 0 rather
 * than leaking through as `null` in the serialized RN style.
 * @param length Typed length value.
 * @returns Finite pixel number.
 */
export function lengthToPx(length: LengthValue): number {
  const raw = length.value
  if (!Number.isFinite(raw)) return raw === Number.POSITIVE_INFINITY ? FULLY_ROUNDED_PX : 0
  switch (length.unit) {
    case 'px': {
      return raw
    }
    case 'rem':
    case 'em': {
      return raw * REM_TO_PX
    }
    default: {
      return raw
    }
  }
}

/**
 * Collapse a `DimensionPercentageFor_LengthValue` to a number (pixel) or
 * `'N%'` string. `calc()` variants are not evaluated here — they fall
 * through to `null` so the caller can skip or serialize via tokens.
 * @param value Typed dimension-or-percentage.
 * @returns Number, percent string, or `null` when unrepresentable.
 */
export function dimensionPercentageToNumber(value: DimensionPercentage): LengthResult {
  if (value.type === 'dimension') return lengthToPx(value.value)
  if (value.type === 'percentage') return `${roundFloat(value.value * 100)}%`
  return null
}

/**
 * Convert `LengthPercentageOrAuto` (per-side value type for padding /
 * margin / inset) to an RN scalar. `auto` maps to the string `'auto'`,
 * which RN's margin accepts for centering; non-margin callers can filter
 * it out if they need a number.
 * @param value Typed length-percentage-or-auto.
 * @returns RN scalar or `null` for unrepresentable shapes.
 */
export function lengthPercentageOrAutoToValue(value: LengthPercentageOrAuto): LengthResult {
  if (value.type === 'auto') return 'auto'
  return dimensionPercentageToNumber(value.value)
}

/**
 * Convert a lightningcss `Size` (used by width/height) or `MaxSize` (used
 * by max-width/max-height) to an RN scalar. Sizing keywords with no RN
 * analog (`min-content`, `fit-content`, `stretch`, …) fall through to
 * `null` so the caller drops them.
 * @param value Typed size value.
 * @returns RN scalar or `null` when unrepresentable.
 */
export function sizeLikeToValue(value: Size | MaxSize): LengthResult {
  if (value.type === 'auto' || value.type === 'none') return value.type === 'auto' ? 'auto' : null
  if (value.type === 'length-percentage') return dimensionPercentageToNumber(value.value)
  return null
}

/**
 * Convert a lightningcss `GapValue` (per-axis gap, used by `row-gap` /
 * `column-gap`) to an RN scalar. The `normal` keyword has no RN analog
 * and falls through to `null`.
 * @param value Typed gap value.
 * @returns Number, percent string, or `null`.
 */
export function gapValueToValue(value: GapValue): LengthResult {
  if (value.type === 'normal') return null
  return dimensionPercentageToNumber(value.value)
}
