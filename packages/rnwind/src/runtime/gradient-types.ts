/**
 * Typed contract for the component rnwind's transformer calls with a
 * gradient-class `className`. Matches `expo-linear-gradient` verbatim
 * so users can plug any gradient library that mirrors that API.
 *
 * A typical wiring:
 *
 * ```tsx
 * import { LinearGradient } from 'expo-linear-gradient'
 * import type { AsLinearGradientProps } from 'rnwind'
 *
 * // Assert at the type level — CI catches mismatches before runtime.
 * const _typeCheck: AsLinearGradientProps = {} as Parameters<typeof LinearGradient>[0]
 *
 * // Then use it in real JSX. rnwind fills in colors / start / end.
 * <LinearGradient className="bg-gradient-to-r from-red-500 to-blue-500" />
 * ```
 *
 * The rnwind transformer emits `colors` as a frozen `readonly string[]`,
 * and `start` / `end` as frozen `{x: number, y: number}` records.
 * Users pass the component; rnwind fills the props. Unused props
 * (`locations`, `dither`, …) are forwarded verbatim from the JSX site.
 */

/** A unit-square point. Matches the `LinearGradientPoint` object form. */
export interface LinearGradientPoint {
  /** Horizontal component, 0..1. */
  readonly x: number
  /** Vertical component, 0..1. */
  readonly y: number
}

/**
 * The exact prop shape rnwind fills onto a gradient component at
 * build time. A user-supplied `<LinearGradient>` (or any other
 * component) must accept these props — no wrapper, no adapter.
 */
export interface AsLinearGradientProps {
  /**
   * Gradient colour stops in source order. rnwind emits a frozen
   * `readonly string[]` with 2+ entries (at least `from` + `to`).
   * Compatible with expo-linear-gradient's `colors: readonly [ColorValue, ColorValue, ...ColorValue[]]`.
   */
  readonly colors: readonly string[]
  /**
   * Start point, in the unit square (0,0)=top-left → (1,1)=bottom-right.
   * rnwind emits a frozen `{x, y}` record matching the Tailwind
   * direction utility (`to-r` → `{x: 0, y: 0.5}`).
   */
  readonly start: LinearGradientPoint
  /** End point — same unit-square coordinates as `start`. */
  readonly end: LinearGradientPoint
  /**
   * Optional colour-stop positions matching `colors` length. rnwind
   * doesn't emit this today (Tailwind v4's stop-position atoms aren't
   * wired yet); listed here so the prop surface still matches
   * expo-linear-gradient when a consumer passes their own.
   */
  readonly locations?: readonly number[] | null
}
