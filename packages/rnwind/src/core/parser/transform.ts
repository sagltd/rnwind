import type { Angle, LengthValue, NumberOrPercentage, Rotate, Scale, Transform, Translate } from 'lightningcss'
import type { RNEntry } from './types'
import { lengthToPx } from './length'

type RnTransformRecord = Record<string, string | number>

type DimensionPercent =
  | { type: 'dimension'; value: LengthValue }
  | { type: 'percentage'; value: number }
  | { type: 'calc'; value: unknown }

/**
 * Map a single typed transform function into zero-or-more RN transform
 * operations. Compound ops (like `translate`, `scale`, `skew`) expand
 * into per-axis entries the way RN expects them.
 * @param fn Typed transform function.
 * @returns RN transform operations.
 */
function mapTransformFunction(fn: Transform): RnTransformRecord[] | null {
  switch (fn.type) {
    case 'rotate':
    case 'rotateZ': {
      return [{ rotate: angleToString(fn.value) }]
    }
    case 'rotateX': {
      return [{ rotateX: angleToString(fn.value) }]
    }
    case 'rotateY': {
      return [{ rotateY: angleToString(fn.value) }]
    }
    case 'scale': {
      const [x, y] = fn.value
      return [{ scaleX: numberOrPercentageToNumber(x) }, { scaleY: numberOrPercentageToNumber(y) }]
    }
    case 'scaleX': {
      return [{ scaleX: numberOrPercentageToNumber(fn.value) }]
    }
    case 'scaleY': {
      return [{ scaleY: numberOrPercentageToNumber(fn.value) }]
    }
    case 'translateX': {
      return [{ translateX: lengthOrPercentToNumber(fn.value) }]
    }
    case 'translateY': {
      return [{ translateY: lengthOrPercentToNumber(fn.value) }]
    }
    case 'translate': {
      const [x, y] = fn.value
      const out: RnTransformRecord[] = [{ translateX: lengthOrPercentToNumber(x) }]
      if (y) out.push({ translateY: lengthOrPercentToNumber(y) })
      return out
    }
    case 'translate3d': {
      const [x, y] = fn.value
      return [{ translateX: lengthOrPercentToNumber(x) }, { translateY: lengthOrPercentToNumber(y) }]
    }
    case 'skew': {
      const [x, y] = fn.value
      const out: RnTransformRecord[] = [{ skewX: angleToString(x) }]
      if (y) out.push({ skewY: angleToString(y) })
      return out
    }
    case 'skewX': {
      return [{ skewX: angleToString(fn.value) }]
    }
    case 'skewY': {
      return [{ skewY: angleToString(fn.value) }]
    }
    default: {
      // RN doesn't have a direct equivalent for `matrix()` / `matrix3d()` /
      // `perspective()` at the transform-op level — skip silently. Tailwind's
      // generated transforms stay within rotate/translate/scale/skew.
      return null
    }
  }
}

/**
 * Serialize a typed angle into the CSS degree string RN accepts
 * (`'45deg'`, `'0.5turn'` → `'180deg'`).
 * @param angle Typed angle.
 * @returns Degree string.
 */
function angleToString(angle: Angle): string {
  switch (angle.type) {
    case 'deg': {
      return `${formatNumber(angle.value)}deg`
    }
    case 'rad': {
      return `${formatNumber((angle.value * 180) / Math.PI)}deg`
    }
    case 'grad': {
      return `${formatNumber((angle.value * 360) / 400)}deg`
    }
    case 'turn': {
      return `${formatNumber(angle.value * 360)}deg`
    }
    default: {
      return '0deg'
    }
  }
}

/**
 * Convert a `NumberOrPercentage` to a plain number. Percentages become
 * their fractional equivalent (e.g. `50%` → `0.5`). Rounded so a literal
 * like `scale-[1.7]` doesn't carry lightningcss's f32 noise
 * (`1.7000000476837158`) into the RN `transform` array.
 * @param value Typed value.
 * @returns Plain number.
 */
function numberOrPercentageToNumber(value: NumberOrPercentage): number {
  return roundNumber(value.value)
}

/**
 * Convert a length-or-percentage used by translate into the shape RN
 * accepts (`number` for px, `string` for `%`). Percentages stay as
 * strings so RN layout can resolve them against the element size. Pixel
 * values are rounded to shed f32 noise (`3.3px` → `3.299999952…`).
 * @param value Typed length or percentage.
 * @returns RN-style translate value.
 */
function lengthOrPercentToNumber(value: DimensionPercent | { type: 'value'; value: LengthValue }): number | string {
  if (value.type === 'dimension') return roundNumber(lengthToPx(value.value))
  if (value.type === 'value') return roundNumber(lengthToPx(value.value))
  if (value.type === 'percentage') return `${formatNumber(value.value * 100)}%`
  return 0
}

/**
 * Round a number to 4 decimals — sheds lightningcss's f32 representation
 * noise while staying well below subpixel / sub-percent precision.
 * @param value Raw number.
 * @returns Rounded number.
 */
function roundNumber(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/**
 * Render a number without trailing IEEE noise.
 * @param value Number to format.
 * @returns Compact string form.
 */
function formatNumber(value: number): string {
  return String(roundNumber(value))
}

/**
 * Convert lightningcss's typed `transform: ...` value into RN's
 * `transform: [{ op: value }, ...]` array. RN supports a restricted subset
 * of CSS transforms — this function picks out the ones it actually
 * handles and drops the rest.
 *
 * Reanimated v4's CSS engine reads this same array shape, so the output
 * is drop-in for both static RN `style` props and `Animated.View` styles.
 * @param fns Typed transform function list.
 * @returns Zero-or-one RN entry with the `transform` array.
 */
export function transformFunctionsToEntries(fns: readonly Transform[]): readonly RNEntry[] {
  const ops: RnTransformRecord[] = []
  for (const fn of fns) {
    const mapped = mapTransformFunction(fn)
    if (mapped) ops.push(...mapped)
  }
  if (ops.length === 0) return []
  return [['transform', ops]]
}

/**
 * Convert Tailwind v4's typed `rotate: ...` (individual property) into
 * the RN transform array. Tailwind's `rotate-*` utilities emit this
 * property rather than the classic `transform: rotate(...)` shorthand.
 * @param value Typed rotate value.
 * @returns Zero-or-one RN entry.
 */
export function rotateToEntries(value: Rotate | 'none'): readonly RNEntry[] {
  if (value === 'none') return []
  return [['transform', [{ rotate: angleToString(value.angle) }]]]
}

/**
 * Convert Tailwind v4's typed `translate: ...` into the RN transform
 * array. Both axes are emitted as separate ops so each is independently
 * animatable by Reanimated.
 * @param value Typed translate value.
 * @returns Zero-or-one RN entry.
 */
export function translateToEntries(value: Translate | 'none'): readonly RNEntry[] {
  if (value === 'none') return []
  const ops: RnTransformRecord[] = [{ translateX: lengthOrPercentToNumber(value.x) }]
  const yNumber = lengthOrPercentToNumber(value.y)
  if (yNumber !== 0) ops.push({ translateY: yNumber })
  return [['transform', ops]]
}

/**
 * Convert Tailwind v4's typed `scale: ...` into the RN transform array.
 * @param value Typed scale value.
 * @returns Zero-or-one RN entry.
 */
export function scaleToEntries(value: Scale | 'none'): readonly RNEntry[] {
  if (value === 'none') return []
  return [['transform', [{ scaleX: numberOrPercentageToNumber(value.x) }, { scaleY: numberOrPercentageToNumber(value.y) }]]]
}
