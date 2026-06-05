import type { CssColor, LABColor } from 'lightningcss'
import { formatHex, rgb as culoriRgb } from 'culori'

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
 * Modern CSS color functions RN's native view manager can't paint —
 * everything else (hex, `rgb()`/`rgba()`, `hsl()`/`hsla()`, named colors,
 * `transparent`, `currentColor`) RN reads directly and must pass through
 * untouched. Custom `@theme` tokens reach the parser as `var(--color-x)`
 * (only the default palette is `theme(inline)`-d), so they flow through the
 * unparsed-string path where the typed {@link cssColorToString} never runs —
 * this is the one place that lowers their wide-gamut values to sRGB.
 */
const RN_UNREADABLE_COLOR_PREFIXES: readonly string[] = ['oklch(', 'oklab(', 'lab(', 'lch(', 'color(', 'hwb(']

/**
 * Lower a wide-gamut / modern CSS color STRING (`oklch(…)`, `lab(…)`,
 * `color(display-p3 …)`, …) to an sRGB hex/rgba string RN can paint. Returns
 * `null` for anything RN already understands (hex, rgb, hsl, named) so the
 * caller keeps the original text — only the unrepresentable forms convert.
 * Mirrors {@link cssColorToString}'s culori lowering for the string path.
 * @param text Resolved CSS color text (post theme-var substitution).
 * @returns sRGB color string, or `null` when no conversion is needed/possible.
 */
export function normalizeColorString(text: string): string | null {
  const lower = text.trim().toLowerCase()
  if (!RN_UNREADABLE_COLOR_PREFIXES.some((prefix) => lower.startsWith(prefix))) return null
  const parsed = culoriRgb(text)
  if (!parsed || ![parsed.r, parsed.g, parsed.b].every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  const alpha = typeof parsed.alpha === 'number' ? parsed.alpha : 1
  return rgbIntsToString(clampByte(parsed.r * 255), clampByte(parsed.g * 255), clampByte(parsed.b * 255), alpha)
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
      return cssColorToString(color.light)
    }
    default: {
      return 'transparent'
    }
  }
}
