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
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
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
 * Convert a LAB / LCH / OKLAB / OKLCH color to sRGB hex via culori. RN
 * can't evaluate these modern color spaces at paint time; compile-time
 * lowering to sRGB is the only portable path.
 * @param color Typed lab-family color.
 * @returns Hex or rgba string in sRGB.
 */
function labFamilyToHex(color: LABColor): string {
  const hex = culoriHexFor(color)
  if (!hex) return color.alpha < 1 ? 'rgba(0, 0, 0, 0)' : 'transparent'
  if (color.alpha >= 1) return hex
  const back = culoriRgb(hex)
  if (!back) return hex
  return rgbIntsToString(clampByte(back.r * 255), clampByte(back.g * 255), clampByte(back.b * 255), color.alpha)
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
  const hex = formatHex({ mode, x: color.x, y: color.y, z: color.z }) ?? null
  if (!hex) return color.alpha < 1 ? 'rgba(0, 0, 0, 0)' : 'transparent'
  if (color.alpha >= 1) return hex
  const back = culoriRgb(hex)
  if (!back) return hex
  return rgbIntsToString(clampByte(back.r * 255), clampByte(back.g * 255), clampByte(back.b * 255), color.alpha)
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
    case 'srgb':
    case 'srgb-linear':
    case 'display-p3':
    case 'a98-rgb':
    case 'prophoto-rgb':
    case 'rec2020': {
      return floatRgbToString(color.r, color.g, color.b, color.alpha)
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
