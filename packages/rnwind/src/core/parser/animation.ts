import type {
  Animation,
  AnimationDirection,
  AnimationFillMode,
  AnimationIterationCount,
  AnimationName,
  AnimationPlayState,
  EasingFunction,
  PropertyId,
  Time,
  Transition,
} from 'lightningcss'
import { kebabToCamel } from './case-convert'
import type { RNEntry } from './types'

/**
 * Convert one PropertyId ident into the camelCase RN style key
 * Reanimated v4's CSS engine matches against. Tailwind emits CSS names
 * in kebab-case (`background-color`); RN stores `backgroundColor` in
 * the actual style object, and Reanimated only fires a transition when
 * the watched key matches the changed key — so kebab-case here would
 * silently no-op every multi-word color/border transition.
 *
 * Special cases:
 *  - `'all'` passes through unchanged.
 *  - `--tw-*` Tailwind internal custom props are dropped — they have
 *    no RN equivalent and Reanimated can't watch them.
 *  - Other `--user-defined` custom props pass through verbatim.
 * @param property Typed property identifier.
 * @returns RN-style key, or null when the property has no RN equivalent.
 */
function propertyIdToString(property: PropertyId): string | null {
  // Custom properties surface in two shapes: either as `{property:
  // 'custom', value: {name: '--x'}}` or — when lightningcss recognises
  // the leading `--` directly in propertyId — as `{property: '--x'}`.
  // Handle both, drop Tailwind internals, keep user customs verbatim.
  if (property.property === 'custom' && 'value' in property) {
    const { value } = property
    const customName = value && typeof value === 'object' && 'name' in value && typeof value.name === 'string' ? value.name : null
    if (!customName) return null
    return customName.startsWith('--tw-') ? null : customName
  }
  if (typeof property.property === 'string' && property.property.startsWith('--')) {
    return property.property.startsWith('--tw-') ? null : property.property
  }
  if (property.property === 'all') return 'all'
  return kebabToCamel(property.property)
}

/**
 * Collapse a single-element list into its scalar, otherwise return the
 * list unchanged. Reanimated accepts both forms; the scalar is the
 * common case.
 * @param values Values to collapse.
 * @returns A scalar when the list has one element, otherwise the list.
 */
function singleOrArray<T>(values: readonly T[]): T | readonly T[] {
  if (values.length === 1) return values[0]!
  return values
}

/**
 * Render a number without trailing noise (strips IEEE drift beyond 4
 * decimals, then removes trailing zeros).
 * @param value Number to format.
 * @returns Compact string form.
 */
function formatNumber(value: number): string {
  const rounded = Math.round(value * 10_000) / 10_000
  return String(rounded)
}

/**
 * Reanimated v4's CSS engine doesn't accept `cubic-bezier(...)` as a
 * string — only the predefined keywords `linear`, `ease`, `ease-in`,
 * `ease-out`, `ease-in-out`, `step-start`, `step-end`. Tailwind's
 * `transition-colors` / `ease-in-out` / etc. emit the CSS-standard
 * Material curves as cubic-bezier; we snap those to the closest
 * predefined keyword by matching the well-known control-point shapes,
 * falling back to `ease-in-out` (the most common Tailwind default).
 *
 * Direct matches:
 *  - `cubic-bezier(0.25, 0.1, 0.25, 1)` → `ease` (CSS spec default)
 *  - `cubic-bezier(0.4, 0, 1, 1)`       → `ease-in`
 *  - `cubic-bezier(0, 0, 0.2, 1)`       → `ease-out`
 *  - `cubic-bezier(0.4, 0, 0.2, 1)`     → `ease-in-out` (Material standard)
 *  - linear shape (`x1=y1=0, x2=y2=1`)   → `linear`
 *
 * Anything else: classify by control-point shape — front-loaded curves
 * → `ease-in`, back-loaded → `ease-out`, both → `ease-in-out`.
 * @param x1 First control-point x (0–1).
 * @param y1 First control-point y (0–1).
 * @param x2 Second control-point x (0–1).
 * @param y2 Second control-point y (0–1).
 * @returns Closest matching CSS easing keyword.
 */
function snapCubicBezierToKeyword(x1: number, y1: number, x2: number, y2: number): string {
  if (matchesBezier(x1, y1, x2, y2, 0, 0, 1, 1)) return 'linear'
  if (matchesBezier(x1, y1, x2, y2, 0.25, 0.1, 0.25, 1)) return 'ease'
  if (matchesBezier(x1, y1, x2, y2, 0.4, 0, 1, 1)) return 'ease-in'
  if (matchesBezier(x1, y1, x2, y2, 0, 0, 0.2, 1)) return 'ease-out'
  if (matchesBezier(x1, y1, x2, y2, 0.4, 0, 0.2, 1)) return 'ease-in-out'
  // Heuristic for unknown bezier shapes:
  //  - x1 ≈ 0 → starts straight (decelerates) → ease-out
  //  - x2 ≈ 1 → ends straight (accelerates)   → ease-in
  //  - both small, both medium → ease-in-out
  const startsFlat = x1 < 0.1
  const endsFlat = x2 > 0.9
  if (startsFlat && !endsFlat) return 'ease-out'
  if (!startsFlat && endsFlat) return 'ease-in'
  return 'ease-in-out'
}

/**
 * Approximate equality of two cubic-bezier control-point sets — IEEE
 * float noise from lightningcss / culori means literal `===` rarely
 * holds, so we tolerate a tiny epsilon.
 * @param ax1 Actual first x.
 * @param ay1 Actual first y.
 * @param ax2 Actual second x.
 * @param ay2 Actual second y.
 * @param tx1 Target first x.
 * @param ty1 Target first y.
 * @param tx2 Target second x.
 * @param ty2 Target second y.
 * @returns Whether the two beziers are component-wise within 0.01 of each other.
 */
function matchesBezier(
  ax1: number,
  ay1: number,
  ax2: number,
  ay2: number,
  tx1: number,
  ty1: number,
  tx2: number,
  ty2: number,
): boolean {
  const tolerance = 0.01
  return (
    Math.abs(ax1 - tx1) < tolerance &&
    Math.abs(ay1 - ty1) < tolerance &&
    Math.abs(ax2 - tx2) < tolerance &&
    Math.abs(ay2 - ty2) < tolerance
  )
}

/**
 * Serialize a lightningcss `EasingFunction` into a CSS string Reanimated
 * v4's CSS engine understands. Reanimated accepts the same timing-function
 * strings as CSS transitions/animations, so we emit the canonical CSS
 * form.
 * @param fn Typed easing function.
 * @returns CSS string, e.g. `'linear'` / `'ease-in-out'` / `'cubic-bezier(0.4, 0, 0.2, 1)'`.
 */
export function easingFunctionToString(fn: EasingFunction): string {
  switch (fn.type) {
    case 'linear': {
      return 'linear'
    }
    case 'ease':
    case 'ease-in':
    case 'ease-out':
    case 'ease-in-out': {
      return fn.type
    }
    case 'cubic-bezier': {
      return snapCubicBezierToKeyword(fn.x1, fn.y1, fn.x2, fn.y2)
    }
    case 'steps': {
      const pos = fn.position?.type ?? 'end'
      return `steps(${fn.count}, ${pos})`
    }
    default: {
      return 'ease'
    }
  }
}

/**
 * Format a `Time` value into a CSS string (`150ms`, `1s`). Reanimated's
 * CSS engine accepts either `ms` or `s`; we pick `ms` unless the value
 * is a whole-second multiple for readability.
 * @param time Typed time value.
 * @returns CSS time string.
 */
export function timeToString(time: Time): string {
  if (time.type === 'milliseconds') return `${formatNumber(time.value)}ms`
  return `${formatNumber(time.value)}s`
}

/**
 * Convert a single `animation-name` value to a string. Tailwind's
 * `animate-none` produces `{ type: 'none' }` which we drop.
 * @param name Typed animation name.
 * @returns Keyframe identifier, or null when `none`.
 */
export function animationNameToString(name: AnimationName): string | null {
  if (name.type === 'none') return null
  if (name.type === 'ident') return name.value
  if (name.type === 'string') return name.value
  return null
}

/**
 * Convert a single `animation-iteration-count` value to the CSS shape
 * Reanimated wants: either a finite integer or the `'infinite'` string.
 * @param count Typed iteration count.
 * @returns Number or `'infinite'`.
 */
export function iterationCountToValue(count: AnimationIterationCount): number | string {
  if (count.type === 'infinite') return 'infinite'
  return count.value
}

/**
 * Decompose the `animation: <name> <duration> <timing> <iteration> …`
 * shorthand into the per-property RN entries Reanimated consumes. A single
 * `animation` declaration can name multiple animations — we emit the first
 * one (Tailwind's `animate-*` utilities always emit exactly one).
 * @param animations Parsed animation list from lightningcss.
 * @returns RN entries, empty when the shorthand names `none`.
 */
export function animationShorthandToEntries(animations: readonly Animation[]): readonly RNEntry[] {
  const [first] = animations
  if (!first) return []
  const name = animationNameToString(first.name)
  if (!name) return []
  const entries: RNEntry[] = [['animationName', name]]
  if (first.duration) entries.push(['animationDuration', timeToString(first.duration)])
  if (first.timingFunction) entries.push(['animationTimingFunction', easingFunctionToString(first.timingFunction)])
  if (first.iterationCount) entries.push(['animationIterationCount', iterationCountToValue(first.iterationCount)])
  if (first.direction && first.direction !== 'normal') entries.push(['animationDirection', first.direction])
  if (first.fillMode && first.fillMode !== 'none') entries.push(['animationFillMode', first.fillMode])
  if (first.delay && first.delay.value !== 0) entries.push(['animationDelay', timeToString(first.delay)])
  if (first.playState && first.playState !== 'running') entries.push(['animationPlayState', first.playState])
  return entries
}

/**
 * Emit `animationName` for a standalone `animation-name: spin` declaration.
 * @param names Typed `animation-name` list.
 * @returns Single-entry `animationName` or empty when `none`.
 */
export function animationNameEntries(names: readonly AnimationName[]): readonly RNEntry[] {
  const [first] = names
  if (!first) return []
  const name = animationNameToString(first)
  if (!name) return []
  return [['animationName', name]]
}

/**
 * Emit `animationDuration` for a standalone `animation-duration` declaration.
 * @param durations Typed duration list.
 * @returns Single-entry list.
 */
export function animationDurationEntries(durations: readonly Time[]): readonly RNEntry[] {
  const [first] = durations
  if (!first) return []
  return [['animationDuration', timeToString(first)]]
}

/**
 * Emit `animationTimingFunction` for a standalone `animation-timing-function`.
 * @param fns Typed timing-function list.
 * @returns Single-entry list.
 */
export function animationTimingFunctionEntries(fns: readonly EasingFunction[]): readonly RNEntry[] {
  const [first] = fns
  if (!first) return []
  return [['animationTimingFunction', easingFunctionToString(first)]]
}

/**
 * Emit `animationIterationCount` for a standalone declaration.
 * @param counts Typed iteration-count list.
 * @returns Single-entry list.
 */
export function animationIterationCountEntries(counts: readonly AnimationIterationCount[]): readonly RNEntry[] {
  const [first] = counts
  if (!first) return []
  return [['animationIterationCount', iterationCountToValue(first)]]
}

/**
 * Emit `animationDelay` for a standalone declaration.
 * @param delays Typed delay list.
 * @returns Single-entry list.
 */
export function animationDelayEntries(delays: readonly Time[]): readonly RNEntry[] {
  const [first] = delays
  if (!first) return []
  return [['animationDelay', timeToString(first)]]
}

/**
 * Emit `animationDirection` for a standalone declaration.
 * @param directions Typed direction list.
 * @returns Single-entry list.
 */
export function animationDirectionEntries(directions: readonly AnimationDirection[]): readonly RNEntry[] {
  const [first] = directions
  if (!first) return []
  return [['animationDirection', first]]
}

/**
 * Emit `animationFillMode` for a standalone declaration.
 * @param modes Typed fill-mode list.
 * @returns Single-entry list.
 */
export function animationFillModeEntries(modes: readonly AnimationFillMode[]): readonly RNEntry[] {
  const [first] = modes
  if (!first) return []
  return [['animationFillMode', first]]
}

/**
 * Emit `animationPlayState` for a standalone declaration.
 * @param states Typed play-state list.
 * @returns Single-entry list.
 */
export function animationPlayStateEntries(states: readonly AnimationPlayState[]): readonly RNEntry[] {
  const [first] = states
  if (!first) return []
  return [['animationPlayState', first]]
}

/**
 * Convert the `transition-property` list into an RN-consumable form.
 * Reanimated accepts either a string (`'all'`, `'opacity'`) or an array
 * of property names. We emit the array shape even for singletons so the
 * runtime can handle it uniformly.
 * @param properties Typed transition-property list.
 * @returns Single-entry list with `transitionProperty`.
 */
export function transitionPropertyEntries(properties: readonly PropertyId[]): readonly RNEntry[] {
  const names = properties.map((p) => propertyIdToString(p)).filter((name): name is string => name !== null)
  if (names.length === 0) return []
  if (names.length === 1) return [['transitionProperty', names[0]!]]
  return [['transitionProperty', names]]
}

/**
 * Decompose the `transition: <prop> <duration> <timing> <delay>` shorthand
 * into the per-property RN entries Reanimated consumes. A declaration can
 * name multiple transitions; we emit one entry per slot, collapsing
 * identical slots into a scalar.
 * @param transitions Parsed transition list from lightningcss.
 * @returns RN entries — zero or more.
 */
export function transitionShorthandToEntries(transitions: readonly Transition[]): readonly RNEntry[] {
  if (transitions.length === 0) return []
  const properties: string[] = []
  const durations: string[] = []
  const timings: string[] = []
  const delays: string[] = []
  for (const t of transitions) {
    const name = propertyIdToString(t.property)
    if (name) properties.push(name)
    if (t.duration) durations.push(timeToString(t.duration))
    if (t.timingFunction) timings.push(easingFunctionToString(t.timingFunction))
    if (t.delay) delays.push(timeToString(t.delay))
  }
  const entries: RNEntry[] = []
  if (properties.length > 0) entries.push(['transitionProperty', singleOrArray(properties)])
  if (durations.length > 0) entries.push(['transitionDuration', singleOrArray(durations)])
  if (timings.length > 0) entries.push(['transitionTimingFunction', singleOrArray(timings)])
  if (delays.some((d) => d !== '0s')) entries.push(['transitionDelay', singleOrArray(delays)])
  return entries
}

/**
 * Emit `transitionDuration` for a standalone declaration.
 * @param durations Typed duration list.
 * @returns Single-entry list.
 */
export function transitionDurationEntries(durations: readonly Time[]): readonly RNEntry[] {
  if (durations.length === 0) return []
  const strings = durations.map((d) => timeToString(d))
  return [['transitionDuration', singleOrArray(strings)]]
}

/**
 * Emit `transitionTimingFunction` for a standalone declaration.
 * @param fns Typed timing-function list.
 * @returns Single-entry list.
 */
export function transitionTimingFunctionEntries(fns: readonly EasingFunction[]): readonly RNEntry[] {
  if (fns.length === 0) return []
  const strings = fns.map((f) => easingFunctionToString(f))
  return [['transitionTimingFunction', singleOrArray(strings)]]
}

/**
 * Emit `transitionDelay` for a standalone declaration.
 * @param delays Typed delay list.
 * @returns Single-entry list.
 */
export function transitionDelayEntries(delays: readonly Time[]): readonly RNEntry[] {
  if (delays.length === 0) return []
  const strings = delays.map((d) => timeToString(d))
  return [['transitionDelay', singleOrArray(strings)]]
}
