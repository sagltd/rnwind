import type { Declaration as LcDeclaration } from 'lightningcss'
import { lineHeightToEntries } from './typography'
import type { RNEntry } from './types'

/**
 * Build the RN `textDecorationLine` entry — string identity for the
 * single-line cases, joined-string for the array shape.
 * @param value Typed text-decoration-line.
 * @returns Single-entry list with `textDecorationLine`.
 */
function textDecorationLineToEntries(value: LcDeclaration['value']): readonly RNEntry[] {
  if (value === 'none') return [['textDecorationLine', 'none']]
  if (typeof value === 'string') return [['textDecorationLine', value]]
  if (Array.isArray(value)) return [['textDecorationLine', value.join(' ')]]
  return []
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
  return [['letterSpacing', unit === 'px' ? px : px * 16]]
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
