import type { Token, TokenOrValue } from 'lightningcss'
import { rgb as culoriRgb } from 'culori'
import { BARE_NUMBER_REGEX, CALC_MUL_REGEX, CALC_RATIO_REGEX, LENGTH_PX_REGEX, LENGTH_REM_REGEX, REM_TO_PX } from './constants'
import { cssColorToString } from './color'
import type { RNStyleValue } from './types'

/**
 * Extract the fallback clause of a `var(--name, fallback)` by walking the
 * string with paren-depth tracking. Linear-time; safe on nested
 * `var(--a, var(--b, var(--c, 1rem)))` without regex backtracking.
 * @param text CSS value already trimmed.
 * @returns Fallback text, or `null` when `text` is not a `var(..., ...)`
 *   with a fallback.
 */
function extractVariableFallback(text: string): string | null {
  if (!text.startsWith('var(') || !text.endsWith(')')) return null
  const inner = text.slice(4, -1)
  let depth = 0
  for (let index = 0; index < inner.length; index += 1) {
    const ch = inner[index]
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ',' && depth === 0) return inner.slice(index + 1).trim()
  }
  return null
}

/**
 * Find the matching `)` for the opening `var(` whose body starts at
 * `start`. Returns `-1` when the parens are unbalanced.
 * @param text Source text.
 * @param start Index just past the opening `var(`.
 * @returns Index of the matching `)`, or `-1`.
 */
function findBalancedParenEnd(text: string, start: number): number {
  let depth = 1
  for (let index = start; index < text.length; index += 1) {
    const ch = text[index]
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

/**
 * Resolve a `var(…)` body (the bit between parentheses). Reads the
 * variable name, then either returns the table lookup or recurses into
 * the fallback clause. When neither resolves, re-wraps as `var(…)` so
 * downstream coercion still sees a well-formed reference.
 * @param body Text between the outer parentheses of a `var()` call.
 * @param table var → value map.
 * @returns Substituted text fragment.
 */
function resolveVariableBody(body: string, table: ReadonlyMap<string, string>): string {
  let depth = 0
  let commaIndex = -1
  for (const [index, ch] of [...body].entries()) {
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ',' && depth === 0) {
      commaIndex = index
      break
    }
  }
  const rawName = (commaIndex === -1 ? body : body.slice(0, commaIndex)).trim()
  const fallback = commaIndex === -1 ? null : body.slice(commaIndex + 1).trim()
  const resolved = table.get(rawName)
  if (resolved !== undefined) return resolved
  if (fallback !== null) return substitutePass(fallback, table)
  return `var(${body})`
}

/**
 * One pass of left-to-right `var(...)` substitution. Separate from the
 * fixed-point driver so the recursion depth stays bounded.
 * @param text Value text to scan.
 * @param table var → value map.
 * @returns Value text after one pass.
 */
function substitutePass(text: string, table: ReadonlyMap<string, string>): string {
  let out = ''
  let index = 0
  while (index < text.length) {
    const head = text.indexOf('var(', index)
    if (head === -1) {
      out += text.slice(index)
      break
    }
    out += text.slice(index, head)
    const end = findBalancedParenEnd(text, head + 4)
    if (end === -1) {
      out += text.slice(head)
      break
    }
    const body = text.slice(head + 4, end)
    out += resolveVariableBody(body, table)
    index = end + 1
  }
  return out
}

/**
 * Serialize a list of `TokenOrValue` nodes into a CSS-ish value string.
 * Preserves the CSS form closely enough for downstream numeric coercion.
 * @param tokens Token list from an unparsed declaration or custom-property body.
 * @returns Concatenated CSS-value fragment.
 */
export function serializeTokens(tokens: readonly TokenOrValue[]): string {
  let out = ''
  for (const token of tokens) out += serializeToken(token)
  return out.trim()
}

/**
 * Serialize one `TokenOrValue` node back to CSS text. Handles the shapes
 * Tailwind v4 actually emits in utility-class bodies: raw tokens, `var()`
 * references, and numeric functions (`calc()`).
 * @param token One token node.
 * @returns CSS-value fragment.
 */
export function serializeToken(token: TokenOrValue): string {
  switch (token.type) {
    case 'token': {
      return serializeRawToken(token.value)
    }
    case 'var': {
      const head = token.value.name.ident
      const { fallback } = token.value
      if (!fallback || fallback.length === 0) return `var(${head})`
      return `var(${head}, ${serializeTokens(fallback)})`
    }
    case 'function': {
      return `${token.value.name}(${serializeTokens(token.value.arguments)})`
    }
    case 'length': {
      return `${token.value.value}${token.value.unit}`
    }
    case 'dashed-ident': {
      return token.value
    }
    case 'angle': {
      return `${token.value.value}${token.value.type}`
    }
    case 'time': {
      const unit = token.value.type === 'milliseconds' ? 'ms' : 's'
      return `${token.value.value}${unit}`
    }
    case 'resolution': {
      return `${token.value.value}${token.value.type}`
    }
    case 'color': {
      // Pre-resolved CSS color (`oklch(...)`, `rgb(...)`, etc.) — render
      // it back to a hex/rgba string RN can read.
      return cssColorToString(token.value)
    }
    case 'env':
    case 'unresolved-color':
    case 'url':
    case 'animation-name': {
      return ''
    }
    default: {
      return ''
    }
  }
}

/**
 * Serialize a raw `Token` back to CSS text. `TokenOrValue` with
 * `type === 'token'` wraps one of these; the discriminated union lets
 * TypeScript narrow per branch without casts.
 * @param token Raw token.
 * @returns CSS text fragment.
 */
export function serializeRawToken(token: Token): string {
  switch (token.type) {
    case 'ident':
    case 'at-keyword':
    case 'string':
    case 'unquoted-url':
    case 'function': {
      return token.value
    }
    case 'hash':
    case 'id-hash': {
      return `#${token.value}`
    }
    case 'number': {
      return String(token.value)
    }
    case 'percentage': {
      return `${token.value * 100}%`
    }
    case 'dimension': {
      return `${token.value}${token.unit}`
    }
    case 'white-space': {
      return ' '
    }
    case 'delim': {
      return token.value
    }
    case 'comma': {
      return ','
    }
    case 'colon':
    case 'semicolon':
    case 'parenthesis-block':
    case 'square-bracket-block':
    case 'curly-bracket-block':
    case 'cdo':
    case 'cdc':
    case 'include-match':
    case 'dash-match':
    case 'prefix-match':
    case 'suffix-match':
    case 'substring-match':
    case 'comment':
    case 'bad-url':
    case 'bad-string': {
      return ''
    }
    default: {
      return ''
    }
  }
}

/**
 * Coerce the flat serialization of an unparsed value into an RN scalar.
 * Handles the shapes Tailwind v4 actually emits: bare numbers, pixel /
 * rem lengths, calc ratios, and `var(--x, fallback)` where we recurse into
 * the fallback. Anything else passes through as a string.
 * @param text Serialized CSS value.
 * @returns Coerced primitive, or `null` when unrepresentable.
 */
export function coerceUnparsedValue(text: string): RNStyleValue | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  if (BARE_NUMBER_REGEX.test(trimmed)) return Number(trimmed)
  const px = LENGTH_PX_REGEX.exec(trimmed)
  if (px) return Number(px[1])
  const rem = LENGTH_REM_REGEX.exec(trimmed)
  if (rem) return Number(rem[1]) * REM_TO_PX
  const colorMix = evaluateColorMixWithTransparent(trimmed)
  if (colorMix !== null) return colorMix
  const fallback = extractVariableFallback(trimmed)
  if (fallback !== null) return coerceUnparsedValue(fallback)
  const calcRatio = CALC_RATIO_REGEX.exec(trimmed)
  if (calcRatio) {
    const right = Number(calcRatio[2])
    if (right === 0) return null
    return Number(calcRatio[1]) / right
  }
  const calcMul = CALC_MUL_REGEX.exec(trimmed)
  if (calcMul) {
    // Unit-aware multiply: `calc(0.5rem * 2)` → 16 (rem scaled to px).
    // Regex captures `(number)(unit?) * (number)` — the unit is implicit
    // in the match position; rebuild via the full match text.
    const unitMatch = /^calc\(\s*-?\d+(?:\.\d+)?(rem|px)?/.exec(trimmed)
    const unit = unitMatch?.[1]
    const base = Number(calcMul[1]) * Number(calcMul[2])
    return unit === 'rem' ? base * REM_TO_PX : base
  }
  return unquoteCssString(trimmed)
}

/**
 * Evaluate the specific `color-mix(in <space>, <color> <pct>%, transparent)`
 * shape Tailwind v4 emits for opacity-suffixed themed colors (e.g.
 * `border-text/20`, `bg-on-background/30`). The result is the original
 * color with `alpha = originalAlpha * pct/100` — no actual color-space
 * conversion is needed because mixing a color with `transparent` only
 * changes its alpha, regardless of the named space (oklab / srgb /
 * lab / …) — the chrominance is preserved.
 *
 * Returns null when the expression isn't this shape (handed back to
 * the caller for the next coercion strategy).
 * @param text Trimmed CSS value.
 * @returns RN-compatible `rgba(...)` string, or null when unmatched.
 */
function evaluateColorMixWithTransparent(text: string): string | null {
  const lower = text.toLowerCase()
  if (!lower.startsWith('color-mix(')) return null
  // Match the trailing `, transparent)` (allowing optional whitespace).
  const tail = /,\s*transparent\s*\)\s*$/.exec(text)
  if (!tail) return null
  // Skip the `in <space>` clause (everything up to the FIRST comma after
  // the opening paren). Walking by hand instead of regex because the
  // color slot may itself contain `(...)` (e.g. `rgb(...)`).
  const inComma = text.indexOf(',', 'color-mix('.length)
  if (inComma === -1 || inComma > tail.index) return null
  const middle = text.slice(inComma + 1, tail.index).trim()
  // `<color> <pct>%` — the `<num>%` token is at the END of `middle`.
  // Anchored, no backtracking — explicit `% ` then end.
  const pctMatch = COLOR_MIX_PCT_TAIL.exec(middle)
  if (!pctMatch) return null
  const pct = Number(pctMatch[1]) / 100
  if (!Number.isFinite(pct)) return null
  const colorText = middle.slice(0, pctMatch.index).trim()
  if (colorText.length === 0) return null
  return applyAlphaToCssColor(colorText, pct)
}

/** End-anchored `<num>%` matcher used to slice a color-mix percentage off the right of an expression. */
// eslint-disable-next-line sonarjs/slow-regex -- end-anchored, atomic-style group; bounded backtracking is safe.
const COLOR_MIX_PCT_TAIL = /(-?\d+(?:\.\d+)?)%$/

/**
 * Multiply the alpha channel of a serialized CSS color by `multiplier`
 * (0…1). Recognises `#rgb` / `#rrggbb` / `#rrggbbaa` hex, named colors
 * (only `transparent` matters here), and `rgb(…)` / `rgba(…)` forms —
 * which is what theme tokens resolve to after substitution.
 * @param color CSS color text.
 * @param multiplier Alpha multiplier (0…1).
 * @returns `rgba(r, g, b, a)` string with the adjusted alpha.
 */
function applyAlphaToCssColor(color: string, multiplier: number): string | null {
  const trimmed = color.trim()
  if (trimmed === 'transparent') return 'rgba(0, 0, 0, 0)'
  // Nested color-mix — Tailwind's `shadow-<token>/<opacity>` emits
  // `color-mix(… color-mix(… <token> N%, transparent) <alpha>, transparent)`.
  // Resolve the inner mix to a concrete color first, then apply this alpha.
  if (trimmed.toLowerCase().startsWith('color-mix(')) {
    const inner = evaluateColorMixWithTransparent(trimmed)
    if (inner !== null) return applyAlphaToCssColor(inner, multiplier)
  }
  return alphaFromHex(trimmed, multiplier) ?? alphaFromRgbFunction(trimmed, multiplier) ?? alphaFromCulori(trimmed, multiplier)
}

/**
 * Round a composed alpha to 4 decimals — `0.2 * 1` round-trips through f32 as
 * `0.20000000298…`; the rounded form keeps generated rgba strings compact.
 * @param alpha Raw alpha product.
 * @returns Rounded alpha.
 */
function roundAlpha(alpha: number): number {
  return Math.round(alpha * 10_000) / 10_000
}

/**
 * Apply the alpha multiplier to a hex literal, expanding 3/4/6/8-digit forms.
 * @param text Candidate hex color string.
 * @param multiplier Alpha multiplier (0…1).
 * @returns `rgba(…)` string, or null when `text` is not a hex literal.
 */
function alphaFromHex(text: string, multiplier: number): string | null {
  const hexMatch = /^#([0-9a-fA-F]{3,8})$/.exec(text)
  if (!hexMatch) return null
  const expanded = expandHex(hexMatch[1]!)
  if (!expanded) return null
  return `rgba(${expanded.r}, ${expanded.g}, ${expanded.b}, ${roundAlpha(expanded.alpha * multiplier)})`
}

/**
 * Apply alpha to an `rgb(…)` / `rgba(…)` literal. Walks the channels by
 * hand instead of a multi-capture regex (the linter flags the regex
 * form as backtracking-prone).
 * @param text Candidate `rgb(…)` / `rgba(…)` color string.
 * @param multiplier Alpha multiplier (0…1).
 * @returns `rgba(…)` string, or null when `text` is not an rgb function.
 */
function alphaFromRgbFunction(text: string, multiplier: number): string | null {
  if (!text.startsWith('rgb(') && !text.startsWith('rgba(')) return null
  const inner = text.slice(text.indexOf('(') + 1, -1)
  const channels = inner.split(/\s*[\s,]\s*/).filter((part) => part.length > 0)
  if (channels.length !== 3 && channels.length !== 4) return null
  const r = Math.round(Number(channels[0]))
  const g = Math.round(Number(channels[1]))
  const b = Math.round(Number(channels[2]))
  const baseAlpha = channels.length === 4 ? Number(channels[3]) : 1
  if (![r, g, b, baseAlpha].every((value) => Number.isFinite(value))) return null
  return `rgba(${r}, ${g}, ${b}, ${roundAlpha(baseAlpha * multiplier)})`
}

/**
 * Fallback for wide-gamut color forms (`oklch`, `oklab`, `lab`, `lch`,
 * `hsl`, …) — culori parses every CSS color shape and yields RGB. Lets
 * `color-mix(in oklab, oklch(...) 50%, transparent)` resolve when
 * Tailwind emits the source color in a wide-gamut space (every
 * built-in `bg-red-500` / `shadow-red-500` does, in v4).
 * @param text Candidate wide-gamut / named CSS color string.
 * @param multiplier Alpha multiplier (0…1).
 * @returns `rgba(…)` string, or null when culori can't parse `text`.
 */
function alphaFromCulori(text: string, multiplier: number): string | null {
  try {
    const parsed = culoriRgb(text) as { r?: number; g?: number; b?: number; alpha?: number } | undefined
    if (!parsed) return null
    if (![parsed.r, parsed.g, parsed.b].every((v) => typeof v === 'number' && Number.isFinite(v))) return null
    const r = Math.round(Math.max(0, Math.min(1, parsed.r!)) * 255)
    const g = Math.round(Math.max(0, Math.min(1, parsed.g!)) * 255)
    const b = Math.round(Math.max(0, Math.min(1, parsed.b!)) * 255)
    const baseAlpha = typeof parsed.alpha === 'number' ? parsed.alpha : 1
    return `rgba(${r}, ${g}, ${b}, ${roundAlpha(baseAlpha * multiplier)})`
  } catch {
    // culori threw on an unrecognised CSS form — fall through.
    return null
  }
}

/**
 * Expand `#rgb` / `#rrggbb` / `#rrggbbaa` hex to its `{r, g, b, alpha}`
 * components. Returns null when the digit count doesn't match a CSS hex
 * shape.
 * @param digits Hex digits without the leading `#`.
 * @returns Decoded color or null.
 */
function expandHex(digits: string): { r: number; g: number; b: number; alpha: number } | null {
  const {length} = digits
  if (length === 3 || length === 4) {
    const r = Number.parseInt(digits[0]! + digits[0]!, 16)
    const g = Number.parseInt(digits[1]! + digits[1]!, 16)
    const b = Number.parseInt(digits[2]! + digits[2]!, 16)
    const alpha = length === 4 ? Number.parseInt(digits[3]! + digits[3]!, 16) / 255 : 1
    return Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) ? null : { r, g, b, alpha }
  }
  if (length === 6 || length === 8) {
    const r = Number.parseInt(digits.slice(0, 2), 16)
    const g = Number.parseInt(digits.slice(2, 4), 16)
    const b = Number.parseInt(digits.slice(4, 6), 16)
    const alpha = length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1
    return Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) ? null : { r, g, b, alpha }
  }
  return null
}

/**
 * Strip the matched outer quote characters from a CSS string literal.
 * `--font-sans: 'Inter-Medium'` flows through `var(--font-sans)`
 * substitution as the raw value text — quotes included. Without this
 * step `fontFamily` lands on the RN style as `"'Inter-Medium'"` (with
 * literal quote characters), which RN can't match against the registered
 * native font and silently falls back to the system face.
 *
 * Only strips when both ends agree (`'…'` or `"…"`) and there are no
 * other top-level quote chars — keeps multi-segment fallbacks like
 * `'Inter', sans-serif` untouched (those get split downstream).
 * @param text Trimmed CSS value.
 * @returns Same text with outer matching quotes removed, or unchanged.
 */
function unquoteCssString(text: string): string {
  if (text.length < 2) return text
  const first = text.codePointAt(0)
  const last = text.codePointAt(text.length - 1)
  if (first === undefined || first !== last) return text
  if (first !== 34 && first !== 39) return text // " or '
  const inner = text.slice(1, -1)
  // Don't unquote when the inner string itself contains an unescaped
  // matching quote — that means we'd be merging two adjacent literals.
  if (inner.includes(text[0]!)) return text
  return inner
}

/**
 * Coerce a CSS `font-family` value into the SINGLE typeface name RN wants.
 * CSS font-family is a fallback LIST (`"Montserrat", sans-serif`), but RN's
 * `fontFamily` takes one family — so take the first entry and strip its
 * quotes. This is what lets the standard Tailwind convention
 * (`--font-display: "Name", sans-serif`) work out of the box: `font-display`
 * resolves to `{ fontFamily: 'Name' }`, not the raw quoted list.
 * @param value Resolved `font-family` value (possibly a quoted list).
 * @returns Bare first-family name.
 */
export function coerceFontFamily(value: string): string {
  const first = value.split(',')[0]?.trim() ?? value
  return unquoteCssString(first)
}

/**
 * Generic CSS font-family keywords — NOT real React Native typefaces. A
 * `font-family` stack made only of these (e.g. the default `font-sans`:
 * `ui-sans-serif, system-ui, sans-serif`) should fall back to RN's system
 * font rather than emit a bogus `fontFamily`.
 */
const GENERIC_FONT_FAMILIES: ReadonlySet<string> = new Set([
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
  'system-ui',
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'math',
  'emoji',
  'fangsong',
  '-apple-system',
  'blinkmacsystemfont',
  // Emoji / symbol fonts that Tailwind appends to the default sans stack —
  // never the intended text typeface.
  'apple color emoji',
  'segoe ui emoji',
  'segoe ui symbol',
  'noto color emoji',
])

/**
 * Pick the first CONCRETE typeface from a typed `font-family` LIST (a CSS
 * fallback stack). RN takes one family, and generic keywords aren't real
 * faces, so skip them. Returns undefined when the whole stack is generic
 * (→ caller emits nothing → system font).
 * @param families Typed `font-family` value — an array of family-name strings.
 * @returns First concrete family name, or undefined.
 */
export function firstConcreteFontFamily(families: readonly unknown[]): string | undefined {
  for (const entry of families) {
    if (typeof entry !== 'string') continue
    const bare = coerceFontFamily(entry)
    if (bare.length > 0 && !GENERIC_FONT_FAMILIES.has(bare.toLowerCase())) return bare
  }
  return undefined
}

/**
 * Substitute every `var(--name [, fallback])` reference in `text` with
 * the value from `table` (or the fallback clause when the name misses).
 * Paren-balanced so nested `var(…)` refs don't confuse the scanner.
 * Iterates to a fixed point so multi-hop substitutions land in one call
 * (with a safety cap so a malformed self-referential token can't loop).
 * @param text Raw CSS value.
 * @param table var name → resolved value map.
 * @returns Substituted text.
 */
export function substituteThemeVars(text: string, table: ReadonlyMap<string, string>): string {
  let current = text
  for (let pass = 0; pass < 8; pass += 1) {
    const next = substitutePass(current, table)
    if (next === current) return next
    current = next
  }
  return current
}
