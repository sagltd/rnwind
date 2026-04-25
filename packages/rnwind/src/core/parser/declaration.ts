/* eslint-disable sonarjs/cognitive-complexity -- the main Declaration → RN-entries dispatcher is intentionally a flat switch so each branch keeps its narrowed value type */
import type { Declaration as LcDeclaration, TokenOrValue } from 'lightningcss'
import { kebabToCamel } from './case-convert'
import { cssColorToString } from './color'
import { dimensionPercentageToNumber, gapValueToValue, lengthPercentageOrAutoToValue, sizeLikeToValue } from './length'
import {
  expandBorderColor,
  expandBorderRadius,
  expandFourSided,
  expandGap,
  expandLogicalBlock,
  expandLogicalInline,
  flexToEntries,
} from './shorthand'
import { coerceUnparsedValue, serializeTokens, substituteThemeVars } from './tokens'
import { displayToEntries, fontSizeToPx, fontWeightToValue, zIndexToNumber } from './typography'
import { dispatchMotionDeclaration } from './motion-dispatcher'
import { dispatchTypographyDeclaration } from './typography-dispatcher'
import { dispatchLayoutDeclaration } from './layout-dispatcher'
import { dispatchColorPropertyDeclaration } from './color-properties-dispatcher'
import { dispatchBorderDeclaration } from './border-dispatcher'
import { detectSafeAreaMarker } from './safe-area'
import type { RNEntry } from './types'

/** CSS timing-function properties that need `cubic-bezier(...)` snapping. */
const TIMING_FUNCTION_PROPS = new Set(['transition-timing-function', 'animation-timing-function'])

/** CSS easing keywords Reanimated v4's CSS engine accepts as strings. */
const CSS_EASING_KEYWORDS = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end'])

/** CSS properties with no useful RN equivalent — silently dropped. */
const UNSUPPORTED_LOGICAL_PROPS = new Set([
  'border-inline-style',
  'border-block-style',
  'border-inline-start-style',
  'border-inline-end-style',
  'border-block-start-style',
  'border-block-end-style',
])

/**
 * Pick the closest predefined CSS easing keyword for a `cubic-bezier`
 * control-point set. Mirrors {@link snapCubicBezierToKeyword} in
 * `animation.ts` — kept here so the unparsed-string path doesn't need
 * to import a typed-only helper.
 * @param x1 First control-point x (0–1).
 * @param y1 First control-point y (0–1).
 * @param x2 Second control-point x (0–1).
 * @param y2 Second control-point y (0–1).
 * @returns CSS easing keyword.
 */
function snapBezier(x1: number, y1: number, x2: number, y2: number): string {
  const tol = 0.01
  const eq = (a: number, b: number): boolean => Math.abs(a - b) < tol
  if (eq(x1, 0) && eq(y1, 0) && eq(x2, 1) && eq(y2, 1)) return 'linear'
  if (eq(x1, 0.25) && eq(y1, 0.1) && eq(x2, 0.25) && eq(y2, 1)) return 'ease'
  if (eq(x1, 0.4) && eq(y1, 0) && eq(x2, 1) && eq(y2, 1)) return 'ease-in'
  if (eq(x1, 0) && eq(y1, 0) && eq(x2, 0.2) && eq(y2, 1)) return 'ease-out'
  if (eq(x1, 0.4) && eq(y1, 0) && eq(x2, 0.2) && eq(y2, 1)) return 'ease-in-out'
  const startsFlat = x1 < 0.1
  const endsFlat = x2 > 0.9
  if (startsFlat && !endsFlat) return 'ease-out'
  if (!startsFlat && endsFlat) return 'ease-in'
  return 'ease-in-out'
}

/**
 * Snap a cubic-bezier expression string to the closest CSS keyword
 * Reanimated v4's CSS engine accepts. Strings that already are keywords
 * pass through unchanged.
 * @param value Resolved value text from an unparsed timing-function declaration.
 * @returns CSS easing keyword.
 */
function coerceCubicBezierString(value: string): string {
  const text = value.trim()
  if (CSS_EASING_KEYWORDS.has(text)) return text
  const match = /^cubic-bezier\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)$/.exec(text)
  if (!match) return 'ease-in-out'
  const [, x1, y1, x2, y2] = match
  return snapBezier(Number(x1), Number(y1), Number(x2), Number(y2))
}

/**
 * Fast-path check for the handful of color property names Tailwind emits.
 * @param property Kebab-case CSS property name.
 * @returns Whether the property's value should be treated as a color.
 */
function isColorProperty(property: string): boolean {
  return (
    property === 'color' ||
    property === 'background-color' ||
    (property.startsWith('border-') && property.endsWith('-color')) ||
    property.endsWith('-color')
  )
}

/**
 * Convert an unparsed declaration (typical Tailwind v4 output containing
 * `var()` / `calc()`) into RN entries. Serializes the token list, then
 * coerces the flat string into a number / keyword / length via a tight
 * set of shapes Tailwind actually emits.
 * @param property Real property name (kebab-case).
 * @param tokens Token list from lightningcss.
 * @param themeVars Optional lookup table for resolving `var(--x)` references.
 * @returns RN entries — usually one, empty when unusable.
 */
function unparsedToEntries(
  property: string,
  tokens: readonly TokenOrValue[],
  themeVars: ReadonlyMap<string, string> | undefined,
): readonly RNEntry[] {
  if (property.length === 0) return []
  // Safe-area detection runs BEFORE token serialization because
  // `env()` serializes to an empty string, which would strip the side
  // info we need. If the tokens encode a recognised `env(safe-area-inset-*)`
  // pattern (pure / `max(..., n)` / `calc(...+n)` / `h-screen-safe`),
  // emit a runtime-resolved marker instead.
  if (UNSUPPORTED_LOGICAL_PROPS.has(property)) return []
  const safe = detectSafeAreaMarker(tokens, themeVars)
  if (safe !== null) return [[kebabToCamel(property), safe]]
  let text = serializeTokens(tokens)
  if (themeVars && themeVars.size > 0) text = substituteThemeVars(text, themeVars)
  const coerced = coerceUnparsedValue(text)
  if (coerced === null) return []
  // Skip values that didn't resolve past their `var()` wrapper — they
  // came from a `@property --tw-*` token without a real fallback.
  // Tailwind v4's `border-N` emits `border-style: var(--tw-border-style)`
  // expecting the cascade to fill it in; in RN we drop them and rely on
  // RN's default (solid).
  if (typeof coerced === 'string' && coerced.startsWith('var(')) return []
  // Logical-direction CSS properties RN doesn't have direct equivalents
  // for. Keep the dropped names in one place so it's easy to audit.
  if (UNSUPPORTED_LOGICAL_PROPS.has(property)) return []
  if (TIMING_FUNCTION_PROPS.has(property) && typeof coerced === 'string') {
    // `transition-colors` and similar emit `var(--tw-ease, cubic-bezier(...))`
    // which serializes to a cubic-bezier STRING after substitution.
    // Reanimated v4's CSS engine rejects those — snap to the closest
    // predefined keyword (same logic as the typed `EasingFunction` path).
    return [[kebabToCamel(property), coerceCubicBezierString(coerced)]]
  }
  if (isColorProperty(property) && typeof coerced === 'string') {
    // Resolved user-theme color strings (e.g. `#ff0099`) go straight to
    // the RN style — no further conversion needed.
    return [[kebabToCamel(property), coerced]]
  }
  return [[kebabToCamel(property), coerced]]
}

/**
 * Convert one lightningcss `Declaration` into zero-or-more RN style
 * entries. Shorthand declarations (padding/margin/border-radius/flex) can
 * emit multiple entries; skipped or unsupported properties emit none.
 *
 * The switch branches on `decl.property` so TypeScript narrows
 * `decl.value` to the exact typed shape for each branch — no casts
 * required. Unknown properties fall through to `[]`.
 * @param decl One declaration from a lightningcss style rule.
 * @param themeVars Optional lookup table for resolving `var(--x)` references inside unparsed values.
 * @returns Array of `[key, value]` entries.
 */
export function declarationToRnEntries(decl: LcDeclaration, themeVars?: ReadonlyMap<string, string>): readonly RNEntry[] {
  switch (decl.property) {
    case 'custom': {
      // Lightningcss routes two shapes through `custom`:
      //  - Actual CSS custom properties (`--my-var`): no RN meaning, drop.
      //  - Real properties it doesn't have a dedicated typed entry for
      //    (e.g. `object-fit`, `pointer-events`, future CSS keyword-only
      //    props): treat like an unparsed declaration so the keyword
      //    surfaces in the RN style.
      const customName = decl.value.name
      if (customName.startsWith('--')) return []
      return unparsedToEntries(customName, decl.value.value ?? [], themeVars)
    }
    case 'unparsed': {
      return unparsedToEntries(decl.value.propertyId.property, decl.value.value, themeVars)
    }
    case 'color':
    case 'background-color':
    case 'border-top-color':
    case 'border-right-color':
    case 'border-bottom-color':
    case 'border-left-color': {
      // `background-color` narrows to `CssColor | 'background'` — the
      // literal keyword means UA default. Skip the keyword.
      if (typeof decl.value === 'string') return []
      return [[kebabToCamel(decl.property), cssColorToString(decl.value)]]
    }
    case 'border-color': {
      return expandBorderColor(decl.value)
    }
    case 'opacity': {
      // Lightningcss hands us an `f32` for opacity, so values like `0.8`
      // round-trip as `0.800000011920929`. Snap to 4 decimals to match the
      // rest of the parser's numeric convention.
      return [[decl.property, Math.round(decl.value * 10_000) / 10_000]]
    }
    case 'z-index': {
      return [['zIndex', zIndexToNumber(decl.value)]]
    }
    case 'top':
    case 'right':
    case 'bottom':
    case 'left': {
      const v = lengthPercentageOrAutoToValue(decl.value)
      if (v === null) return []
      return [[decl.property, v]]
    }
    case 'inset': {
      const top = lengthPercentageOrAutoToValue(decl.value.top)
      const right = lengthPercentageOrAutoToValue(decl.value.right)
      const bottom = lengthPercentageOrAutoToValue(decl.value.bottom)
      const left = lengthPercentageOrAutoToValue(decl.value.left)
      if (top === null || right === null || bottom === null || left === null) return []
      return [
        ['top', top],
        ['right', right],
        ['bottom', bottom],
        ['left', left],
      ]
    }
    case 'inset-inline': {
      const start = lengthPercentageOrAutoToValue(decl.value.inlineStart)
      const end = lengthPercentageOrAutoToValue(decl.value.inlineEnd)
      if (start === null || end === null) return []
      return [
        ['left', start],
        ['right', end],
      ]
    }
    case 'inset-block': {
      const start = lengthPercentageOrAutoToValue(decl.value.blockStart)
      const end = lengthPercentageOrAutoToValue(decl.value.blockEnd)
      if (start === null || end === null) return []
      return [
        ['top', start],
        ['bottom', end],
      ]
    }
    case 'width':
    case 'height':
    case 'min-width':
    case 'min-height':
    case 'max-width':
    case 'max-height': {
      const v = sizeLikeToValue(decl.value)
      if (v === null) return []
      return [[kebabToCamel(decl.property), v]]
    }
    case 'gap': {
      return expandGap(decl.value)
    }
    case 'row-gap':
    case 'column-gap': {
      const v = gapValueToValue(decl.value)
      if (v === null) return []
      return [[kebabToCamel(decl.property), v]]
    }
    case 'font-style': {
      return [['fontStyle', decl.value.type]]
    }
    case 'display': {
      return displayToEntries(decl.value)
    }
    case 'position': {
      return [['position', decl.value.type]]
    }
    case 'font-size': {
      const px = fontSizeToPx(decl.value)
      if (px === null) return []
      return [['fontSize', px]]
    }
    case 'font-weight': {
      return [['fontWeight', fontWeightToValue(decl.value)]]
    }
    case 'padding': {
      return expandFourSided('padding', decl.value)
    }
    case 'margin': {
      return expandFourSided('margin', decl.value)
    }
    case 'padding-inline': {
      return expandLogicalInline('padding', decl.value)
    }
    case 'padding-block': {
      return expandLogicalBlock('padding', decl.value)
    }
    case 'margin-inline': {
      return expandLogicalInline('margin', decl.value)
    }
    case 'margin-block': {
      return expandLogicalBlock('margin', decl.value)
    }
    case 'padding-top':
    case 'padding-right':
    case 'padding-bottom':
    case 'padding-left':
    case 'margin-top':
    case 'margin-right':
    case 'margin-bottom':
    case 'margin-left': {
      const v = lengthPercentageOrAutoToValue(decl.value)
      if (v === null) return []
      return [[kebabToCamel(decl.property), v]]
    }
    case 'border-radius': {
      return expandBorderRadius(decl.value)
    }
    case 'border-top-left-radius':
    case 'border-top-right-radius':
    case 'border-bottom-left-radius':
    case 'border-bottom-right-radius': {
      const [xAxis] = decl.value
      const v = dimensionPercentageToNumber(xAxis)
      if (v === null) return []
      return [[kebabToCamel(decl.property), v]]
    }
    case 'flex': {
      return flexToEntries(decl.value)
    }
    case 'flex-grow':
    case 'flex-shrink': {
      return [[kebabToCamel(decl.property), decl.value]]
    }
    case 'flex-basis': {
      const v = lengthPercentageOrAutoToValue(decl.value)
      if (v === null) return []
      return [['flexBasis', v]]
    }
    default: {
      return (
        dispatchLayoutDeclaration(decl) ??
        dispatchTypographyDeclaration(decl) ??
        dispatchColorPropertyDeclaration(decl) ??
        dispatchBorderDeclaration(decl) ??
        dispatchMotionDeclaration(decl) ??
        []
      )
    }
  }
}
