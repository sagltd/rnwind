import type { Declaration as LcDeclaration } from 'lightningcss'
import { lineHeightToEntries } from './typography'
import { firstConcreteFontFamily } from './tokens'
import type { RNEntry } from './types'

/** RN-supported `textDecorationStyle` values (`wavy` has no RN equivalent). */
const RN_DECORATION_STYLES: ReadonlySet<string> = new Set(['solid', 'double', 'dotted', 'dashed'])

/**
 * The only `textDecorationLine` keywords React Native renders. CSS `overline`
 * has no RN analog, so any line string containing it (or any other unknown
 * keyword) is dropped rather than leaked as a value RN warns on + ignores.
 */
const RN_DECORATION_LINES: ReadonlySet<string> = new Set(['none', 'underline', 'line-through', 'underline line-through'])

/**
 * Build the RN `textDecorationLine` entry — string identity for the
 * single-line cases, joined-string for the array shape. Drops any value
 * outside RN's enum (`overline`, `overline underline`, …) so no invalid
 * keyword reaches the StyleSheet.
 * @param value Typed text-decoration-line.
 * @returns Single-entry list with a valid `textDecorationLine`, or empty.
 */
function textDecorationLineToEntries(value: LcDeclaration['value']): readonly RNEntry[] {
  if (typeof value === 'string') return RN_DECORATION_LINES.has(value) ? [['textDecorationLine', value]] : []
  if (!Array.isArray(value)) return []
  const line = value.join(' ')
  return RN_DECORATION_LINES.has(line) ? [['textDecorationLine', line]] : []
}

/**
 * Build the RN `aspectRatio` entry from lightningcss's typed value.
 * Drops `auto` (no RN equivalent).
 * @param value Typed aspect-ratio value.
 * @param value.auto Whether the value resolved to `auto`.
 * @param value.ratio Numeric `[width, height]` ratio (or null/undefined).
 * @returns Single-entry list or empty.
 */
function aspectRatioToEntries(value: { auto?: boolean; ratio?: readonly [number, number] | null }): readonly RNEntry[] {
  if (value.auto) return []
  if (!value.ratio) return []
  const [w, h] = value.ratio
  if (h === 0) return []
  return [['aspectRatio', w / h]]
}

/**
 * Build the RN `letterSpacing` entry. RN expects pixel numbers; rem
 * lengths are scaled to px (16-px base).
 * @param value Typed letter-spacing value.
 * @returns Single-entry list or empty.
 */
function letterSpacingToEntries(value: LcDeclaration['value']): readonly RNEntry[] {
  if (typeof value !== 'object') return []
  const tagged = value as { type?: string; value?: { type?: string; value?: { unit?: string; value?: number } } }
  if (tagged.type === 'normal') return [['letterSpacing', 0]]
  const inner = tagged.value
  if (inner?.type !== 'value' || !inner.value) return []
  const { unit, value: px } = inner.value
  if (typeof px !== 'number') return []
  const resolved = unit === 'px' ? px : px * 16
  // Round off lightningcss f32 noise (`0.1em` → `1.600000023841858`).
  return [['letterSpacing', Math.round(resolved * 10_000) / 10_000]]
}

/**
 * Lower a CSS `text-align` keyword to one RN's `textAlign` accepts. RN
 * has no logical `start`/`end`, so map them to physical sides (LTR
 * default); every other keyword (left/right/center/justify/auto) is
 * already valid and passes through.
 * @param align CSS text-align keyword.
 * @returns RN-valid textAlign keyword.
 */
function physicalTextAlign(align: string): string {
  if (align === 'start') return 'left'
  if (align === 'end') return 'right'
  return align
}

/**
 * Dispatch typography declarations rnwind cares about (text-align,
 * text-transform, text-decoration-line, line-height, letter-spacing,
 * aspect-ratio). Returns null when the property isn't one of these so
 * the caller can fall through to its main switch.
 * @param decl One lightningcss declaration.
 * @returns RN entries when the property matched, else `null`.
 */
export function dispatchTypographyDeclaration(decl: LcDeclaration): readonly RNEntry[] | null {
  switch (decl.property) {
    case 'text-align': {
      return [['textAlign', physicalTextAlign(String(decl.value))]]
    }
    case 'text-transform': {
      return [['textTransform', decl.value.case ?? 'none']]
    }
    case 'text-decoration-line': {
      return textDecorationLineToEntries(decl.value)
    }
    case 'text-decoration-style': {
      // RN <Text> supports textDecorationStyle (solid/double/dotted/dashed).
      const style = String(decl.value)
      return RN_DECORATION_STYLES.has(style) ? [['textDecorationStyle', style]] : []
    }
    case 'font-family': {
      // Typed `font-family` is a fallback LIST (`font-sans`, `font-mono`,
      // `font-[Inter]`). RN takes one concrete typeface; an all-generic
      // stack (default `font-sans`) emits nothing → system font. The themed
      // `var(--font-*)` path goes through `coerceFontFamily` in declaration.ts.
      const family = firstConcreteFontFamily(decl.value as readonly unknown[])
      return family === undefined ? [] : [['fontFamily', family]]
    }
    case 'aspect-ratio': {
      return aspectRatioToEntries(decl.value)
    }
    case 'line-height': {
      return lineHeightToEntries(decl.value)
    }
    case 'letter-spacing': {
      return letterSpacingToEntries(decl.value)
    }
    default: {
      return null
    }
  }
}
