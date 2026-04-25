import type { Token, TokenOrValue } from 'lightningcss'
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
