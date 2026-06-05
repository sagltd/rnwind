import type { CssColor, LABColor } from 'lightningcss'
import { formatHex, interpolate, rgb as culoriRgb } from 'culori'

/**
 * Clamp a 0-255 float to the integer byte range RN color strings accept.
 * @param value Unclamped float (may be negative or above 255).
 * @returns Integer in `[0, 255]`.
 */
function clampByte(value: number): number {
  if (value < 0) return 0
  if (value > 255) return 255
  return Math.round(value)
}

/**
 * Two-digit hex encoding of a 0-255 byte.
 * @param byte Byte value (may be out-of-range — clamped).
 * @returns Zero-padded two-char hex string.
 */
function byteToHex(byte: number): string {
  const hex = clampByte(byte).toString(16)
  return hex.length === 1 ? `0${hex}` : hex
}

/**
 * Format an integer-RGB triple + alpha as `#rrggbb` or `rgba(r, g, b, a)`.
 * @param r 0-255 red.
 * @param g 0-255 green.
 * @param b 0-255 blue.
 * @param alpha 0-1 alpha.
 * @returns Color string.
 */
function rgbIntsToString(r: number, g: number, b: number, alpha: number): string {
  if (alpha >= 1) return `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`
  // Round the alpha to shed f32 noise (`0.2 → 0.20000000298…`) — RN parses
  // either, but the rounded form keeps generated StyleSheets compact.
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 10_000) / 10_000})`
}

/**
 * Format a float-RGB triple + alpha (CSS `color(srgb …)` forms) as
 * hex/rgba.
 * @param r 0-1 red.
 * @param g 0-1 green.
 * @param b 0-1 blue.
 * @param alpha 0-1 alpha.
 * @returns Color string.
 */
function floatRgbToString(r: number, g: number, b: number, alpha: number): string {
  return rgbIntsToString(clampByte(r * 255), clampByte(g * 255), clampByte(b * 255), alpha)
}

/**
 * Dispatch a LAB-family color through culori's hex formatter.
 * @param color Typed LAB-family color.
 * @returns `#rrggbb` string, or `null` when culori couldn't convert.
 */
function culoriHexFor(color: LABColor): string | null {
  switch (color.type) {
    case 'oklch': {
      return formatHex({ mode: 'oklch', l: color.l, c: color.c, h: color.h }) ?? null
    }
    case 'oklab': {
      return formatHex({ mode: 'oklab', l: color.l, a: color.a, b: color.b }) ?? null
    }
    case 'lab': {
      return formatHex({ mode: 'lab', l: color.l, a: color.a, b: color.b }) ?? null
    }
    case 'lch': {
      return formatHex({ mode: 'lch', l: color.l, c: color.c, h: color.h }) ?? null
    }
    default: {
      return null
    }
  }
}

/**
 * Composite a culori-produced sRGB hex with the source alpha into the RN
 * color string. Shared tail for every culori-backed conversion (lab
 * family, XYZ, wide-gamut RGB): opaque → the hex as-is; translucent →
 * `rgba(...)` rebuilt from the hex channels.
 * @param hex sRGB hex from culori, or `null` when culori rejected the color.
 * @param alpha Source alpha (0–1).
 * @returns RN color string.
 */
function withAlpha(hex: string | null, alpha: number): string {
  if (!hex) return alpha < 1 ? 'rgba(0, 0, 0, 0)' : 'transparent'
  if (alpha >= 1) return hex
  const back = culoriRgb(hex)
  if (!back) return hex
  return rgbIntsToString(clampByte(back.r * 255), clampByte(back.g * 255), clampByte(back.b * 255), alpha)
}

/**
 * Convert a LAB / LCH / OKLAB / OKLCH color to sRGB hex via culori. RN
 * can't evaluate these modern color spaces at paint time; compile-time
 * lowering to sRGB is the only portable path.
 * @param color Typed lab-family color.
 * @returns Hex or rgba string in sRGB.
 */
function labFamilyToHex(color: LABColor): string {
  return withAlpha(culoriHexFor(color), color.alpha)
}

/**
 * Convert a wide-gamut `color(<space> r g b)` triple to sRGB hex via
 * culori. The channels are NOT sRGB — each space (display-p3, rec2020,
 * a98-rgb, prophoto-rgb, srgb-linear) carries its own primaries / transfer
 * function, so a bare `channel * 255` would mis-paint. culori does the
 * gamut + gamma conversion to sRGB.
 * @param mode culori mode key for the source space.
 * @param r Source red (0–1).
 * @param g Source green (0–1).
 * @param b Source blue (0–1).
 * @param alpha Alpha channel (0–1).
 * @returns sRGB color string RN accepts.
 */
function wideGamutToHex(mode: 'lrgb' | 'p3' | 'a98' | 'prophoto' | 'rec2020', r: number, g: number, b: number, alpha: number): string {
  return withAlpha(formatHex({ mode, r, g, b }) ?? null, alpha)
}

/**
 * Convert a CSS `color(xyz-d50 …)` / `color(xyz-d65 …)` value to sRGB hex
 * via culori.
 * @param color Typed XYZ color (discriminated by `type`).
 * @param color.type Whether the color is in the D50 or D65 XYZ space.
 * @param color.x CIE X component (0–1).
 * @param color.y CIE Y component (0–1).
 * @param color.z CIE Z component (0–1).
 * @param color.alpha Alpha channel (0–1).
 * @returns `#rrggbb` string, or `'transparent'` when culori rejects it.
 */
function xyzToHex(color: { type: 'xyz-d50' | 'xyz-d65'; x: number; y: number; z: number; alpha: number }): string {
  const mode = color.type === 'xyz-d50' ? 'xyz50' : 'xyz65'
  return withAlpha(formatHex({ mode, x: color.x, y: color.y, z: color.z }) ?? null, color.alpha)
}

/**
 * Map a CSS `color-mix(in <space>, …)` interpolation space to the culori mode
 * key culori's {@link interpolate} understands. `srgb` is culori's `rgb`;
 * `srgb-linear` is `lrgb`; the lab/lch/oklab/oklch/hsl/hwb spaces share their
 * CSS name. Unknown spaces fall back to `rgb` so a mix still resolves to a
 * concrete color rather than leaking the raw expression.
 * @param space Lowercased interpolation-space token (after `in `).
 * @returns culori interpolation mode key.
 */
function colorMixModeFor(space: string): string {
  if (space === 'srgb') return 'rgb'
  if (space === 'srgb-linear') return 'lrgb'
  const known = new Set(['oklab', 'oklch', 'lab', 'lch', 'hsl', 'hwb', 'xyz', 'xyz-d50', 'xyz-d65'])
  return known.has(space) ? space : 'rgb'
}

/**
 * Split a `color-mix()` argument list at top-level commas (parens-aware) so a
 * nested `rgb(0, 0, 0)` color slot doesn't fragment the split.
 * @param body Text between the outer `color-mix(` parentheses.
 * @returns Comma-separated argument fragments (trimmed).
 */
function splitColorMixArgs(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < body.length; index += 1) {
    const ch = body[index]
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(body.slice(start).trim())
  return parts
}

/**
 * Peel an optional trailing `<num>%` weight off a `color-mix()` color slot.
 * `#ff0000 50%` → `{ color: '#ff0000', weight: 0.5 }`; a bare color → weight
 * `null` (caller fills the complement / defaults to 50/50).
 * @param slot One color argument (color text, optionally suffixed with a percentage).
 * @returns Color text plus its 0–1 weight, or null weight when unspecified.
 */
function parseColorMixSlot(slot: string): { color: string; weight: number | null } {
  const trimmed = slot.trim()
  if (!trimmed.endsWith('%')) return { color: trimmed, weight: null }
  // End-anchored `<num>%` matcher (no leading `.*?` — avoids the super-linear
  // backtracking ESLint flags). Split the color off at the last whitespace
  // before the percentage token.
  const pct = COLOR_MIX_SLOT_PCT.exec(trimmed)
  if (!pct) return { color: trimmed, weight: null }
  const color = trimmed.slice(0, pct.index).trim()
  if (color.length === 0) return { color: trimmed, weight: null }
  const weight = Number(pct[1]) / 100
  return { color, weight: Number.isFinite(weight) ? weight : null }
}

/** End-anchored `<num>%` matcher for slicing a color-mix slot's weight off its right edge. No backtracking. */
 
const COLOR_MIX_SLOT_PCT = /\s(-?\d+(?:\.\d+)?)%$/

/**
 * Resolve a two-color CSS `color-mix(in <space>, A [p1%], B [p2%])` to a
 * concrete sRGB color via culori's {@link interpolate}. CSS weight rules:
 * with one percentage the other fills the complement; with none it is 50/50;
 * with both, the interpolation point is `p2 / (p1 + p2)`. RN can't evaluate
 * `color-mix()` at paint time, so this is the only path that lowers it.
 * @param text Trimmed CSS value beginning with `color-mix(`.
 * @returns sRGB hex/rgba string, or null when the shape/colors can't resolve.
 */
function resolveColorMix(text: string): string | null {
  if (!text.endsWith(')')) return null
  const open = text.indexOf('(')
  if (open === -1) return null
  const args = splitColorMixArgs(text.slice(open + 1, -1))
  if (args.length !== 3) return null
  const spaceClause = args[0]!.toLowerCase()
  if (!spaceClause.startsWith('in ')) return null
  const mode = colorMixModeFor(spaceClause.slice(3).trim())
  const first = parseColorMixSlot(args[1]!)
  const second = parseColorMixSlot(args[2]!)
  if (first.color.length === 0 || second.color.length === 0) return null
  const point = colorMixPoint(first.weight, second.weight)
  if (point === null) return null
  try {
    const mixed = interpolate([first.color, second.color], mode as never)(point)
    if (!mixed) return null
    const back = culoriRgb(mixed) as { r?: number; g?: number; b?: number; alpha?: number } | undefined
    if (!back || ![back.r, back.g, back.b].every((v) => typeof v === 'number' && Number.isFinite(v))) return null
    const alpha = typeof back.alpha === 'number' ? back.alpha : 1
    return rgbIntsToString(clampByte(back.r! * 255), clampByte(back.g! * 255), clampByte(back.b! * 255), alpha)
  } catch {
    // culori threw on an unparseable color slot — drop rather than leak the raw string.
    return null
  }
}

/**
 * Compute the 0–1 interpolation point (weight of the SECOND color) from the
 * two optional `color-mix()` weights, applying CSS normalization.
 * @param firstWeight 0–1 weight of color A, or null when unspecified.
 * @param secondWeight 0–1 weight of color B, or null when unspecified.
 * @returns Interpolation point in `[0, 1]`, or null when both weights are 0.
 */
function colorMixPoint(firstWeight: number | null, secondWeight: number | null): number | null {
  if (firstWeight === null && secondWeight === null) return 0.5
  if (firstWeight !== null && secondWeight === null) return 1 - firstWeight
  if (firstWeight === null && secondWeight !== null) return secondWeight
  const sum = firstWeight! + secondWeight!
  if (sum === 0) return null
  return secondWeight! / sum
}

/**
 * CSS-wide cascade keywords that resolve a property against the inherited /
 * initial / previous-layer value at paint time. React Native has NO color
 * cascade — there is no inherited `color` for an arbitrary style prop and no
 * cascade layers — so as a `color` / `backgroundColor` / `borderColor` value
 * every one of these reaches RN as an invalid color string. `currentColor`
 * belongs here too: it resolves to the element's inherited `color`, which RN
 * never threads into other color props. The color path must DROP these (omit
 * the key) rather than leak the keyword. NOTE: `transparent` is NOT here — it
 * is a real color that {@link cssColorToString} / {@link normalizeColorString}
 * lower to `rgba(0, 0, 0, 0)`, which RN paints correctly.
 */
const CSS_WIDE_COLOR_KEYWORDS: ReadonlySet<string> = new Set([
  'currentcolor',
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
])

/**
 * Modern CSS color functions RN's native view manager can't paint —
 * everything else (hex, `rgb()`/`rgba()`, `hsl()`/`hsla()`, named colors,
 * `transparent`) RN reads directly and must pass through untouched. The
 * CSS-wide cascade keywords (`currentColor`, `inherit`, …) are NOT readable —
 * they have no RN equivalent and are dropped via {@link isCssWideColorKeyword}.
 * Custom `@theme` tokens reach the parser as `var(--color-x)` (only the default
 * palette is `theme(inline)`-d), so they flow through the unparsed-string path
 * where the typed {@link cssColorToString} never runs — this is the one place
 * that lowers their wide-gamut values to sRGB. `color-mix(` is in the list too,
 * but it takes the dedicated {@link resolveColorMix} path — culori's `rgb()`
 * parser can't read it.
 */
const RN_UNREADABLE_COLOR_PREFIXES: readonly string[] = ['oklch(', 'oklab(', 'lab(', 'lch(', 'color(', 'hwb(', 'color-mix(']

/**
 * Lower a wide-gamut / modern CSS color STRING (`oklch(…)`, `lab(…)`,
 * `color(display-p3 …)`, `color-mix(…)`) to an sRGB hex/rgba string RN can
 * paint. Returns `null` for anything RN already understands (hex, rgb, hsl,
 * named) so the caller keeps the original text — only the unrepresentable
 * forms convert. `color-mix()` is resolved via culori's interpolator; when it
 * (or any other modern form) can't resolve, returns null so the caller DROPS
 * the value rather than leaking the raw, RN-unreadable string.
 * Mirrors {@link cssColorToString}'s culori lowering for the string path.
 * @param text Resolved CSS color text (post theme-var substitution).
 * @returns sRGB color string, or `null` when no conversion is needed/possible.
 */
export function normalizeColorString(text: string): string | null {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()
  if (!RN_UNREADABLE_COLOR_PREFIXES.some((prefix) => lower.startsWith(prefix))) return null
  if (lower.startsWith('color-mix(')) return resolveColorMix(trimmed)
  const parsed = culoriRgb(text)
  if (!parsed || ![parsed.r, parsed.g, parsed.b].every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  const alpha = typeof parsed.alpha === 'number' ? parsed.alpha : 1
  return rgbIntsToString(clampByte(parsed.r * 255), clampByte(parsed.g * 255), clampByte(parsed.b * 255), alpha)
}

/**
 * Whether a resolved color STRING is a CSS-wide cascade keyword
 * (`currentColor`, `inherit`, `initial`, `unset`, `revert`, `revert-layer`)
 * with no React Native equivalent. RN has no color cascade, so the color path
 * must DROP (omit the key) when this is true rather than emit the keyword —
 * RN would otherwise receive an invalid color string and render nothing.
 * `transparent` is NOT a cascade keyword: it is a concrete color the converters
 * lower to `rgba(0, 0, 0, 0)`, so it returns false here and resolves normally.
 * @param text Resolved color text (post theme-var substitution / typed-color stringification).
 * @returns True when the value is an RN-unrepresentable CSS-wide keyword.
 */
export function isCssWideColorKeyword(text: string): boolean {
  return CSS_WIDE_COLOR_KEYWORDS.has(text.trim().toLowerCase())
}

/**
 * Convert a lightningcss `CssColor` to an RN-safe color string. RGB
 * passes through unchanged. LAB / LCH / OKLAB / OKLCH / `color(xyz-…)`
 * forms go through culori to reach sRGB — RN's native view manager only
 * understands sRGB-family strings. SystemColor keywords (`'background'`,
 * `'canvas'`, …) pass through untouched; they have no RN analog and the
 * runtime ignores unknown color strings gracefully.
 * @param color Typed color value.
 * @returns Color string RN accepts.
 */
export function cssColorToString(color: CssColor): string {
  if (typeof color === 'string') return color
  switch (color.type) {
    case 'rgb': {
      return rgbIntsToString(color.r, color.g, color.b, color.alpha)
    }
    case 'lab':
    case 'lch':
    case 'oklab':
    case 'oklch': {
      return labFamilyToHex(color)
    }
    case 'srgb': {
      return floatRgbToString(color.r, color.g, color.b, color.alpha)
    }
    case 'srgb-linear': {
      return wideGamutToHex('lrgb', color.r, color.g, color.b, color.alpha)
    }
    case 'display-p3': {
      return wideGamutToHex('p3', color.r, color.g, color.b, color.alpha)
    }
    case 'a98-rgb': {
      return wideGamutToHex('a98', color.r, color.g, color.b, color.alpha)
    }
    case 'prophoto-rgb': {
      return wideGamutToHex('prophoto', color.r, color.g, color.b, color.alpha)
    }
    case 'rec2020': {
      return wideGamutToHex('rec2020', color.r, color.g, color.b, color.alpha)
    }
    case 'xyz-d50':
    case 'xyz-d65': {
      return xyzToHex(color)
    }
    case 'currentcolor': {
      return 'currentColor'
    }
    case 'light-dark': {
      // `light-dark(L, D)` is a RUNTIME CSS function — the browser picks the
      // branch from the element's `color-scheme`. rnwind has no runtime CSS
      // evaluation, and the active scheme is NOT threaded into this typed
      // converter (it takes a bare `CssColor`, and every one of its ~15 call
      // sites — border / shorthand / gradient / declaration dispatchers — calls
      // it without a scheme). Scheme resolution instead happens UPSTREAM, at the
      // CSS-block walk (`@custom-variant` + `.dark {}` selectors in
      // theme-vars.ts), which compiles a separate atom + var table per scheme.
      // So the `.light` branch is the correct compile-time default here; the
      // dark value is carried by the scheme-specific atom, not by this function.
      return cssColorToString(color.light)
    }
    default: {
      return 'transparent'
    }
  }
}
