/**
 * Dynamic style marker for values that depend on runtime insets.
 * The parser emits one of these in place of a concrete number whenever
 * a declaration uses `env(safe-area-inset-*)`, `max(env(...), n)`, or
 * `calc(env(...) + n)`. The runtime (see `lookup-css.ts` slow path)
 * reads the current insets from `useInsets()` and resolves to a
 * concrete number per render.
 *
 * Marker shape is intentionally object-literal so `JSON.stringify` /
 * style-builder emission roundtrip losslessly. The build-side
 * `envelopeSafeMarkers` converts these markers into the
 * `{__safeStyle: [[cssKey, sideTag, or, offset], ...]}` envelope the
 * runtime checks via a single property read.
 */
export interface SafeAreaMarker {
  readonly __safe: 't' | 'r' | 'b' | 'l' | 'screen-minus-y'
  /** `max(env(...), or)` — fallback value in px. */
  readonly or?: number
  /** `calc(env(...) + offset)` — stacked additional value in px. */
  readonly offset?: number
}

/**
 * RN-compatible style scalar / compound. Covers everything we emit:
 *  - primitives (`16`, `'#fff'`, `'flex-start'`)
 *  - arrays (`['color', 'opacity']` for `transitionProperty`,
 *    `[{rotate: '45deg'}, {scaleX: 2}]` for `transform`)
 *  - object records (`{width, height}` for `shadowOffset`)
 *  - safe-area markers (`{__safe: 't', or?: 16, offset?: 0}`) — resolved
 *    against the active insets at render time.
 */
export type RNStyleValue =
  | string
  | number
  | readonly string[]
  | readonly number[]
  | readonly Record<string, string | number>[]
  | { readonly [key: string]: string | number }
  | SafeAreaMarker

/** Flat RN style object (what `StyleSheet.create` accepts). */
export type RNStyle = Record<string, RNStyleValue>

/** One `[key, value]` pair the converter emits from a single declaration. */
export type RNEntry = readonly [string, RNStyleValue]
