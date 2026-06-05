/* eslint-disable sonarjs/cognitive-complexity -- the main Declaration → RN-entries dispatcher is intentionally a flat switch so each branch keeps its narrowed value type */
import type { Declaration as LcDeclaration, TokenOrValue } from 'lightningcss'
import { kebabToCamel } from './case-convert'
import { cssColorToString, isCssWideColorKeyword, normalizeColorString } from './color'
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
import { coerceFontFamily, coerceUnparsedValue, serializeTokens, substituteThemeVars } from './tokens'
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
 * Web-only CSS properties Tailwind v4 emits that have NO React Native style
 * equivalent. Without this denylist they reach the generic `kebabToCamel`
 * fallback and emit dead keys (`objectPosition`, `textWrap`, `willChange`,
 * `float`, `columns`, `-webkit-line-clamp` → `WebkitLineClamp`, …) that bloat
 * every StyleSheet and read as "supported" when they do nothing. Dropping the
 * property name (kebab-case, pre-camel) is safe: it only excludes known
 * web-only props — anything RN supports is handled by a typed branch above.
 * (line-clamp's real RN behaviour comes from `numberOfLines` in text-truncate.)
 */
const RN_UNSUPPORTED_PROPERTIES: ReadonlySet<string> = new Set([
  'object-position',
  'text-wrap',
  'will-change',
  'columns',
  'float',
  'clear',
  'table-layout',
  'caption-side',
  // Web table-model props with no RN equivalent. `border-spacing` otherwise
  // reaches the generic fallback and leaks an unresolved `calc(0.25rem * N)`.
  'border-spacing',
  'border-collapse',
  'transform-style',
  'background-blend-mode',
  'scroll-behavior',
  'overscroll-behavior',
  'overscroll-behavior-x',
  'overscroll-behavior-y',
  'scroll-snap-type',
  'scroll-snap-align',
  'scroll-snap-stop',
  'break-after',
  'break-before',
  'break-inside',
  'content',
  'field-sizing',
  'forced-color-adjust',
  'text-shadow',
  // Web-only KEYS RN has no style prop for. `order` leaks through the negative
  // variant (`-order-1` → `order: calc(1 * -1)` unparsed → resolves to `-1`);
  // the positive `order-*` already drops since no typed branch claims it. Adding
  // it here drops BOTH signs. `isolation` (`isolate` / `isolation-auto`) reaches
  // the `custom` path as `isolation: isolate|auto` — also no RN equivalent.
  'order',
  'isolation',
  // `normal-nums` reaches the `custom` path as `font-variant-numeric: normal`
  // and leaked the non-RN key `fontVariantNumeric`. RN expresses numeric
  // variants via the `fontVariant` array, not this property — drop it. (The
  // `tabular-nums`/`oldstyle-nums`/… utilities carry their token in dropped
  // `--tw-numeric-*` vars and already resolve to {}; mapping those to
  // `fontVariant` is a tracked future enhancement, not a leak.)
  'font-variant-numeric',
  'touch-action',
  'backdrop-filter',
  '-webkit-backdrop-filter',
  '-webkit-line-clamp',
  '-webkit-box-orient',
  '-webkit-font-smoothing',
  '-moz-osx-font-smoothing',
])

/**
 * Valid value sets for RN enum style props (keyed by the camelCase RN key).
 * A value outside its prop's set is RN-invalid even when the string itself
 * looks clean — RN ignores or warns on it (`position: 'fixed'`, `display:
 * 'contents'`, `justifyContent: 'stretch' | 'baseline'`, `alignContent:
 * 'normal'`). This is the dimension the leak-shape (`var(`/`calc(`/NaN) check
 * misses. Both the typed `display` / `position` branches AND the generic
 * unparsed fallback consult this — Tailwind routes some keyword-only values
 * (`justify-content: baseline`) through the unparsed channel, which would
 * otherwise emit them via `kebabToCamel` with no enum awareness.
 */
const RN_ENUM_VALUES: Readonly<Record<string, ReadonlySet<string>>> = {
  position: new Set(['absolute', 'relative', 'static']),
  display: new Set(['flex', 'none']),
  justifyContent: new Set(['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly']),
  alignContent: new Set(['flex-start', 'flex-end', 'center', 'stretch', 'space-between', 'space-around', 'space-evenly']),
}

/** CSS single-sided logical-inline property → RN writing-direction Yoga key. */
const LOGICAL_INLINE_TO_RN: Record<string, string> = {
  'margin-inline-start': 'marginStart',
  'margin-inline-end': 'marginEnd',
  'padding-inline-start': 'paddingStart',
  'padding-inline-end': 'paddingEnd',
}

/**
 * Logical border-COLOR property → physical RN side key(s). Custom `@theme`
 * tokens reach the unparsed path as `border-inline-color: var(--color-x)`,
 * which a plain `kebabToCamel` would turn into `borderInlineColor` — a key RN
 * silently drops, so the border color never paints. Lower to the physical
 * keys RN actually honors, matching the typed `dispatchBorderDeclaration`.
 */
const LOGICAL_BORDER_COLOR_SIDES: Record<string, readonly string[]> = {
  'border-inline-color': ['borderLeftColor', 'borderRightColor'],
  'border-block-color': ['borderTopColor', 'borderBottomColor'],
  'border-inline-start-color': ['borderLeftColor'],
  'border-inline-end-color': ['borderRightColor'],
  'border-block-start-color': ['borderTopColor'],
  'border-block-end-color': ['borderBottomColor'],
}

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
 * Whether `text` has a whitespace char OUTSIDE any parenthesised group —
 * the signature of a multi-token CSS value (`2px solid #000`) rather than a
 * single color (`#000`, `rgb(1 2 3)`, `red`).
 * @param text Resolved value text.
 * @returns True when a top-level space is present.
 */
function hasTopLevelSpace(text: string): boolean {
  let depth = 0
  for (const ch of text.trim()) {
    if (ch === '(') depth += 1
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && (ch === ' ' || ch === '\t' || ch === '\n')) return true
  }
  return false
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
    // SVG paint props (`fill-<token>` / `stroke-<token>` via react-native-svg) —
    // they don't end in `-color`, so without this they'd skip normalization and
    // leak a raw `oklch(…)` string for custom `@theme` tokens.
    property === 'fill' ||
    property === 'stroke' ||
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
  if (RN_UNSUPPORTED_PROPERTIES.has(property)) return []
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
  // Skip values still carrying an unresolved `var(--tw-*)` ANYWHERE in the
  // string — they came from a `@property --tw-*` composable with no real
  // fallback (e.g. `filter: blur(8px) var(--tw-brightness) …`,
  // `transform: rotateX(45deg) var(--tw-rotate-y) …`, `touch-action`,
  // `scroll-snap-type`). RN can't evaluate the cascade, so a leaked `var()`
  // makes the whole declaration an invalid string RN rejects — drop it and
  // rely on RN's default rather than emit garbage. `var(--color-*)` refs are
  // already substituted above, so anything left is a genuine composable miss.
  if (typeof coerced === 'string' && coerced.includes('var(')) return []
  // RN `fontFamily` is a single typeface, not a CSS fallback list — take
  // the first family so `--font-x: "Name", sans-serif` works out of the box.
  if (property === 'font-family' && typeof coerced === 'string') {
    return [['fontFamily', coerceFontFamily(coerced)]]
  }
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
    // A color is a single token. Tailwind compiles an arbitrary shorthand like
    // `border-[2px_solid_#000]` to `border-color: 2px solid #000` (invalid for
    // a color property → unparsed), which would otherwise emit
    // `borderColor: "2px solid #000000"` — a string RN rejects. A top-level
    // space (outside parens — `rgb(1 2 3)` keeps its inner spaces) means it's a
    // multi-token shorthand, not a color: drop it.
    if (hasTopLevelSpace(coerced)) return []
    // CSS-wide cascade keywords (`inherit`, `currentColor`, `initial`, `unset`,
    // `revert`, `revert-layer`) have no RN equivalent — RN has no color
    // cascade. Drop rather than leak an invalid color string to RN.
    if (isCssWideColorKeyword(coerced)) return []
    // Lower modern color spaces (`oklch(…)`, `lab(…)`, `color(p3 …)`) that
    // RN can't paint to sRGB; hex/rgb/hsl/named pass through unchanged.
    const color = normalizeColorString(coerced) ?? coerced
    // Logical border-color utilities must lower to physical RN side keys —
    // RN ignores `borderInlineColor` / `borderInlineStartColor`.
    const sides = LOGICAL_BORDER_COLOR_SIDES[property]
    if (sides) return sides.map((key): RNEntry => [key, color])
    return [[kebabToCamel(property), color]]
  }
  const camelKey = kebabToCamel(property)
  // Enum props whose value Tailwind sometimes routes through the unparsed
  // channel (`justify-content: baseline` → `justifyContent: 'baseline'`),
  // bypassing the typed dispatcher's keyword map. RN rejects values outside
  // the prop's set, so gate them here exactly like the typed branches do.
  const enumValues = RN_ENUM_VALUES[camelKey]
  if (enumValues && typeof coerced === 'string' && !enumValues.has(coerced)) return []
  return [[camelKey, coerced]]
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
      const colorString = cssColorToString(decl.value)
      // `currentColor` (lightningcss `{type:'currentcolor'}`) and any other
      // CSS-wide cascade keyword have no RN equivalent — drop instead of
      // leaking the keyword string to RN.
      if (isCssWideColorKeyword(colorString)) return []
      return [[kebabToCamel(decl.property), colorString]]
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
      // `displayToEntries` can still emit `contents` (a CSS value RN rejects —
      // only `flex` / `none` are valid). Gate the result on the RN-valid set.
      return displayToEntries(decl.value).filter(([, value]) => typeof value === 'string' && RN_ENUM_VALUES.display.has(value))
    }
    case 'position': {
      // RN `position` accepts only `absolute` / `relative` / `static`; CSS
      // `fixed` / `sticky` are invalid for RN, so drop them.
      return RN_ENUM_VALUES.position.has(decl.value.type) ? [['position', decl.value.type]] : []
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
        dispatchLogicalInline(decl) ??
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

/**
 * Map single-sided CSS logical-inline props to RN's writing-direction-aware
 * Yoga keys: `ms-2` → `marginStart`, `pe-4` → `paddingEnd`, `start-2` →
 * `start`, `end-3` → `end`. RN resolves start/end against the layout
 * direction, so these stay RTL-correct. Returns null for any other property
 * (so the dispatch chain continues).
 * @param decl One declaration from a lightningcss style rule.
 * @returns RN entries, or null when not a logical-inline property.
 */
function dispatchLogicalInline(decl: LcDeclaration): readonly RNEntry[] | null {
  switch (decl.property) {
    case 'margin-inline-start':
    case 'margin-inline-end':
    case 'padding-inline-start':
    case 'padding-inline-end': {
      const v = lengthPercentageOrAutoToValue(decl.value)
      return v === null ? [] : [[LOGICAL_INLINE_TO_RN[decl.property], v]]
    }
    case 'inset-inline-start': {
      const v = lengthPercentageOrAutoToValue(decl.value)
      return v === null ? [] : [['start', v]]
    }
    case 'inset-inline-end': {
      const v = lengthPercentageOrAutoToValue(decl.value)
      return v === null ? [] : [['end', v]]
    }
    // Logical border-radius corners (`rounded-s/e/ss/se/ee/es-*`). RN has
    // matching keys — `kebabToCamel('border-start-start-radius')` is exactly
    // `borderStartStartRadius`. Value is a `[x, y]` tuple like physical corners.
    case 'border-start-start-radius':
    case 'border-start-end-radius':
    case 'border-end-start-radius':
    case 'border-end-end-radius': {
      const [xAxis] = decl.value
      const v = dimensionPercentageToNumber(xAxis)
      return v === null ? [] : [[kebabToCamel(decl.property), v]]
    }
    default: {
      return null
    }
  }
}
