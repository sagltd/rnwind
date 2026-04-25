/**
 * Detect `env(safe-area-inset-*)` usage in a lightningcss TokenOrValue
 * tree and convert the containing declaration into a runtime-resolved
 * {@link SafeAreaMarker}.
 *
 * Three shapes the NativeWind-compatible `*-safe` utilities produce
 * through Tailwind v4's compiler:
 *  - Pure `env(safe-area-inset-top)` → `{ __safe: 't' }`
 *  - `max(env(safe-area-inset-top), 16px)` → `{ __safe: 't', or: 16 }`
 *  - `calc(env(safe-area-inset-top) + 16px)` → `{ __safe: 't', offset: 16 }`
 *
 * The `h-screen-safe` / `min-h-screen-safe` / `max-h-screen-safe` shape
 * — `calc(100vh - (env(top) + env(bottom)))` — reports as
 * `{ __safe: 'screen-minus-y' }`; the runtime resolves against
 * `Dimensions.get('window').height` minus the current top + bottom
 * insets.
 *
 * Unrecognised compound shapes (e.g. `env(safe-area-inset-top, 12px)`
 * with a fallback) return `null` so the caller falls back to the
 * regular token-serialisation path.
 */

import type { TokenOrValue } from 'lightningcss'
import type { SafeAreaMarker } from './types'

/** Map UA env names to the compact side tag used in the marker. */
const SIDE_TAG: Record<string, SafeAreaMarker['__safe']> = {
  'safe-area-inset-top': 't',
  'safe-area-inset-right': 'r',
  'safe-area-inset-bottom': 'b',
  'safe-area-inset-left': 'l',
}

/** Rem → px factor used across the parser (matches `tokens.ts`). */
const REM_TO_PX = 16

/**
 * Theme-var lookup table we optionally receive. Values are stored as
 * raw CSS value strings (`'0.25rem'`, `'#fff'`, …); the safe-area
 * detector only needs the ones that resolve to lengths.
 */
type ThemeVars = ReadonlyMap<string, string>

/**
 * Try to compile a token list into a {@link SafeAreaMarker}. Returns
 * `null` when the tokens don't match any recognised safe-area pattern
 * — the caller should fall back to the regular unparsed-value path.
 * @param tokens Declaration value token list from lightningcss.
 * @param themeVars
 * @returns Marker object, or `null`.
 */
function detectSafeAreaMarker(tokens: readonly TokenOrValue[], themeVars?: ThemeVars): SafeAreaMarker | null {
  const nonWs = stripWhitespace(tokens)
  if (nonWs.length === 0) return null

  // Shape 1: pure env(safe-area-inset-*)
  if (nonWs.length === 1) {
    const side = envSide(nonWs[0]!)
    if (side !== null) return { __safe: side }
  }

  // Shape 2 / 3: max(env(...), n) or calc(env(...) + n)
  if (nonWs.length === 1 && isFunction(nonWs[0]!)) {
    const inner = functionInner(nonWs[0]!)
    if (inner) {
      const marker = tryFromFunction(inner.name, inner.args, themeVars)
      if (marker) return marker
    }
  }

  return null
}

/**
 * Short-circuit whether this token is a `function` token.
 * @param token
 */
function isFunction(token: TokenOrValue): boolean {
  return token.type === 'function'
}

/**
 * Pull `(name, args-without-whitespace)` out of a function token.
 * @param token A function-type TokenOrValue.
 * @returns Inner record, or null when the shape is unexpected.
 */
function functionInner(token: TokenOrValue): { name: string; args: readonly TokenOrValue[] } | null {
  if (token.type !== 'function') return null
  return { name: token.value.name, args: token.value.arguments }
}

/**
 * Pattern-match `max(env(...), n)` / `calc(env(...) + n)` / nested
 * screen-minus-y calc. Operates on the function's already-whitespace-
 * trimmed arg list so every branch can index by position.
 * @param name Function name (`max` / `calc`).
 * @param args Raw argument tokens (whitespace still present).
 * @param themeVars
 * @returns Marker, or null when not recognised.
 */
function tryFromFunction(name: string, args: readonly TokenOrValue[], themeVars: ThemeVars | undefined): SafeAreaMarker | null {
  if (name === 'max') return tryMax(args, themeVars)
  if (name === 'calc') return tryCalc(args, themeVars)
  return null
}

/**
 * `max(env(safe-area-inset-*), <length>)` — Tailwind v4's `*-safe-or-n`
 * shape. Optionally `max(env(...), calc(var(--spacing) * n))` — the
 * calc inside has already been resolved to a bare length by Tailwind's
 * compiler step.
 * @param args Whitespace-preserving argument tokens.
 * @param themeVars
 * @returns Marker, or null.
 */
function tryMax(args: readonly TokenOrValue[], themeVars: ThemeVars | undefined): SafeAreaMarker | null {
  const parts = splitTopLevelComma(args)
  if (parts.length !== 2) return null
  const firstToken = onlyNonWhitespace(parts[0]!)
  if (!firstToken) return null
  const firstSide = envSide(firstToken)
  if (firstSide === null) return null
  const rhs = coerceLengthPx(parts[1]!, themeVars)
  if (rhs === null) return null
  return { __safe: firstSide, or: rhs }
}

/**
 * Recognise:
 *  - `calc(env(safe-area-inset-*) + n)` — `*-safe-offset-n`
 *  - `calc(100vh - (env(...-top) + env(...-bottom)))` — `h-screen-safe`
 * @param args Whitespace-preserving calc argument tokens.
 * @param themeVars
 * @returns Marker, or null.
 */
function tryCalc(args: readonly TokenOrValue[], themeVars: ThemeVars | undefined): SafeAreaMarker | null {
  const [signIndex, sign] = findTopLevelPlusOrMinus(args)
  if (signIndex === -1) return reduceNestedCalc(args, themeVars)
  const lhs = stripWhitespace(args.slice(0, signIndex))
  const rhs = stripWhitespace(args.slice(signIndex + 1))
  const offset = matchOffset(lhs, rhs, sign, themeVars)
  if (offset) return offset
  if (sign === '-' && isViewportHeightHundred(lhs) && isParenthesisedTopBottomSum(rhs)) return { __safe: 'screen-minus-y' }
  return null
}

/**
 * Fall-through arm of {@link tryCalc}: when there's no +/− at the calc
 * body's top level, try to interpret the whole body as a nested
 * function (e.g. a bare `calc(max(...))`).
 * @param args Calc arguments.
 * @param themeVars Optional theme-vars table for length resolution.
 * @returns Marker or null.
 */
function reduceNestedCalc(args: readonly TokenOrValue[], themeVars: ThemeVars | undefined): SafeAreaMarker | null {
  const inner = onlyNonWhitespace(args)
  if (!inner) return null
  return detectSafeAreaMarker([inner], themeVars)
}

/**
 * Try to match `calc(env(side) ± amount)` against the two-side split of
 * the calc body. Returns a marker with positive / negative `offset`
 * based on the sign, or null when the shape doesn't fit.
 * @param lhs Left-hand tokens (whitespace already stripped).
 * @param rhs Right-hand tokens (whitespace already stripped).
 * @param sign The `+` or `-` delim captured between them.
 * @param themeVars Optional theme-vars table.
 * @returns Offset marker, or null.
 */
function matchOffset(
  lhs: readonly TokenOrValue[],
  rhs: readonly TokenOrValue[],
  sign: '+' | '-' | null,
  themeVars: ThemeVars | undefined,
): SafeAreaMarker | null {
  if (!sign || lhs.length !== 1 || rhs.length !== 1) return null
  const side = envSide(lhs[0]!)
  if (side === null) return null
  const amount = coerceLengthPx([rhs[0]!], themeVars)
  if (amount === null) return null
  return { __safe: side, offset: sign === '+' ? amount : -amount }
}

/**
 * Check whether a token is the env() that names one of the four safe-area sides.
 * @param token One TokenOrValue.
 * @returns The compact side tag, or `null` when the token isn't a safe-area env reference.
 */
function envSide(token: TokenOrValue): SafeAreaMarker['__safe'] | null {
  if (token.type !== 'env') return null
  const { name } = token.value
  if (name.type !== 'ua') return null
  return SIDE_TAG[name.value] ?? null
}

/**
 * Drop whitespace / comment tokens from a list so downstream branches
 * can pattern-match by index without counting spaces.
 * @param tokens Raw token list.
 * @returns Copy with whitespace tokens removed.
 */
function stripWhitespace(tokens: readonly TokenOrValue[]): readonly TokenOrValue[] {
  const out: TokenOrValue[] = []
  for (const token of tokens) {
    if (isWhitespaceToken(token)) continue
    out.push(token)
  }
  return out
}

/**
 * Like {@link stripWhitespace} but returns the single non-whitespace
 * token (or null when there's zero or more than one).
 * @param tokens Raw token list.
 * @returns The single meaningful token, or null.
 */
function onlyNonWhitespace(tokens: readonly TokenOrValue[]): TokenOrValue | null {
  const stripped = stripWhitespace(tokens)
  return stripped.length === 1 ? stripped[0]! : null
}

/**
 * Whether the token is pure whitespace / comment — ignorable when
 * matching by position.
 * @param token One TokenOrValue.
 * @returns True when the token carries no semantic value.
 */
function isWhitespaceToken(token: TokenOrValue): boolean {
  if (token.type !== 'token') return false
  const { value } = token
  return value.type === 'white-space' || value.type === 'comment'
}

/**
 * Split `a, b` top-level argument lists into their slices. Respects
 * nested function/paren groups so commas inside an inner `calc(a, b)`
 * don't cause an outer split.
 * @param args Raw argument token list.
 * @returns Array of slices (one per top-level comma-separated segment).
 */
function splitTopLevelComma(args: readonly TokenOrValue[]): readonly TokenOrValue[][] {
  // Functions already arrive as atomic `{type:'function', value}` nodes,
  // so commas inside them are never in `args` — a flat scan for the
  // raw `comma` token is enough.
  const parts: TokenOrValue[][] = [[]]
  for (const token of args) {
    if (token.type === 'token' && token.value.type === 'comma') {
      parts.push([])
      continue
    }
    parts.at(-1)!.push(token)
  }
  return parts
}

/**
 * Find the first top-level `+` / `-` delim in a calc body.
 * @param args Raw argument token list.
 * @returns Tuple of `[index, sign]` or `[-1, null]` when not found.
 */
function findTopLevelPlusOrMinus(args: readonly TokenOrValue[]): [number, '+' | '-' | null] {
  for (const [index, argument] of args.entries()) {
    const token = argument!
    if (token.type !== 'token') continue
    if (token.value.type !== 'delim') continue
    const delim = token.value.value as string
    if (delim === '+' || delim === '-') return [index, delim]
  }
  return [-1, null]
}

/**
 * Coerce a token list that should represent a CSS length (px / rem /
 * integer-number with no unit) into a px value.
 * @param tokens Tokens for the length fragment.
 * @param themeVars
 * @returns Px value, or null when the shape is unrecognised.
 */
function coerceLengthPx(tokens: readonly TokenOrValue[], themeVars: ThemeVars | undefined): number | null {
  const stripped = stripWhitespace(tokens)
  if (stripped.length !== 1) return null
  return coerceTokenToPx(stripped[0]!, themeVars)
}

/**
 * Convert one token to a px number, handling the lengths Tailwind v4
 * commonly emits after compile: `length` (px/rem), bare numbers,
 * `calc(0.25rem * 4)` nested functions.
 * @param token One TokenOrValue.
 * @param themeVars
 * @returns Px value, or null.
 */
function coerceTokenToPx(token: TokenOrValue, themeVars: ThemeVars | undefined): number | null {
  if (token.type === 'length') {
    const { unit, value } = token.value
    if (unit === 'px') return value
    if (unit === 'rem' || unit === 'em') return value * REM_TO_PX
    return null
  }
  if (token.type === 'token' && token.value.type === 'number') {
    return token.value.value
  }
  if (token.type === 'function' && token.value.name === 'calc') {
    return evaluateSimpleCalc(token.value.arguments, themeVars)
  }
  if (token.type === 'var') return resolveVariableToPx(token.value.name.ident, themeVars)
  return null
}

/**
 * Evaluate a trivial `calc(A * B)` where A / B are lengths or numbers
 * Tailwind compiles down to — the exact shape `var(--spacing)` resolves
 * to after `theme(inline)` substitution.
 * @param args Raw calc argument token list.
 * @param themeVars
 * @returns Px value, or null.
 */
function evaluateSimpleCalc(args: readonly TokenOrValue[], themeVars: ThemeVars | undefined): number | null {
  const stripped = stripWhitespace(args)
  if (stripped.length === 3) {
    const mul = stripped[1]!
    if (mul.type === 'token' && mul.value.type === 'delim' && (mul.value.value as string) === '*') {
      const left = coerceTokenToPx(stripped[0]!, themeVars)
      const right = coerceTokenToPx(stripped[2]!, themeVars)
      if (left !== null && right !== null) return left * right
    }
  }
  if (stripped.length === 1) return coerceTokenToPx(stripped[0]!, themeVars)
  return null
}

/**
 * Resolve a `var(--name)` reference to a px value using the supplied
 * theme-var table. Returns null when the name isn't registered or the
 * value isn't a recognisable length.
 * @param name Custom-property name (with leading `--`).
 * @param themeVars Lookup table (or undefined).
 * @returns Px value, or null.
 */
function resolveVariableToPx(name: string, themeVars: ThemeVars | undefined): number | null {
  if (!themeVars) return null
  const raw = themeVars.get(name)
  if (raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed.endsWith('rem')) {
    const n = Number(trimmed.slice(0, -3))
    return Number.isFinite(n) ? n * REM_TO_PX : null
  }
  if (trimmed.endsWith('em')) {
    const n = Number(trimmed.slice(0, -2))
    return Number.isFinite(n) ? n * REM_TO_PX : null
  }
  if (trimmed.endsWith('px')) {
    const n = Number(trimmed.slice(0, -2))
    return Number.isFinite(n) ? n : null
  }
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

/**
 * Whether the token list represents `100vh`.
 * @param tokens Whitespace-stripped token list.
 * @returns True when the only meaningful token is the length `100vh`.
 */
function isViewportHeightHundred(tokens: readonly TokenOrValue[]): boolean {
  if (tokens.length !== 1) return false
  const token = tokens[0]!
  if (token.type !== 'length') return false
  return token.value.unit === 'vh' && token.value.value === 100
}

/**
 * Whether the rhs of `calc(100vh - <rhs>)` is the nested `(env(top) + env(bottom))`
 * parenthesised sum Tailwind emits for `h-screen-safe` and siblings.
 * @param tokens Whitespace-stripped rhs token list.
 * @returns True on match.
 */
function isParenthesisedTopBottomSum(tokens: readonly TokenOrValue[]): boolean {
  // lightningcss emits bare `(...)` as a `parenthesis-block` token
  // followed by the inner tokens inline, then a `close-parenthesis`
  // token at the matching depth. Strip whitespace + the grouping tokens
  // and check that what remains is exactly `env(top) + env(bottom)`
  // (either order).
  const meaningful: TokenOrValue[] = []
  for (const token of tokens) {
    if (isWhitespaceToken(token)) continue
    if (token.type === 'token') {
      const t = token.value.type
      if (t === 'parenthesis-block' || t === 'close-parenthesis') continue
    }
    meaningful.push(token)
  }
  if (meaningful.length !== 3) return false
  const plus = meaningful[1]!
  if (plus.type !== 'token' || plus.value.type !== 'delim' || (plus.value.value as string) !== '+') return false
  const first = envSide(meaningful[0]!)
  const last = envSide(meaningful[2]!)
  return (first === 't' && last === 'b') || (first === 'b' && last === 't')
}

export { detectSafeAreaMarker }

