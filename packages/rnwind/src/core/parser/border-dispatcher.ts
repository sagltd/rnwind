import type { Declaration as LcDeclaration } from 'lightningcss'
import { kebabToCamel } from './case-convert'
import { cssColorToString } from './color'
import type { RNEntry } from './types'

/**
 * Build an inline-color pair from a `{start, end}`-shaped value.
 * @param leftKey RN key for the start side.
 * @param rightKey RN key for the end side.
 * @param value Typed `{start, end}` color value.
 * @returns Two RN entries.
 */
function colorPair(leftKey: string, rightKey: string, value: unknown): readonly RNEntry[] {
  const tagged = value as { start?: unknown; end?: unknown }
  return [
    [leftKey, cssColorToString(tagged.start as never)],
    [rightKey, cssColorToString(tagged.end as never)],
  ]
}

/**
 * Coerce a border-width-shaped length to a pixel number. Drops
 * percentages — RN borders don't accept them.
 * @param value Typed length value (`{type: 'length', value: {unit, value}}`).
 * @returns Pixel number, or null when unrepresentable.
 */
function lengthToPxValue(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null
  const tagged = value as {
    type?: string
    value?: { type?: string; value?: { unit?: string; value?: number } } | { unit?: string; value?: number }
  }
  const inner =
    tagged.type === 'length'
      ? (tagged.value as { type?: string; value?: { unit?: string; value?: number } })?.value
      : tagged.value
  if (!inner || typeof (inner as { value?: number }).value !== 'number') return null
  const dim = inner as { unit?: string; value: number }
  if (dim.unit === 'px') return dim.value
  if (dim.unit === 'rem' || dim.unit === 'em') return dim.value * 16
  return dim.value
}

/**
 * Build an inline-width pair from a `{start, end}`-shaped value.
 * @param leftKey RN key for the start side.
 * @param rightKey RN key for the end side.
 * @param value Typed `{start, end}` length value.
 * @returns Two RN entries, or empty when either side is unrepresentable.
 */
function widthPair(leftKey: string, rightKey: string, value: unknown): readonly RNEntry[] {
  const tagged = value as { start?: unknown; end?: unknown }
  const start = lengthToPxValue(tagged.start)
  const end = lengthToPxValue(tagged.end)
  if (start === null || end === null) return []
  return [
    [leftKey, start],
    [rightKey, end],
  ]
}

/**
 * Expand a `border-width` shorthand to RN longhands. Collapses to the
 * `borderWidth` shorthand when all four sides match.
 * @param value Typed border-width value with `{top, right, bottom, left}`.
 * @returns RN entries.
 */
function borderWidthShorthand(value: unknown): readonly RNEntry[] {
  const tagged = value as { top?: unknown; right?: unknown; bottom?: unknown; left?: unknown }
  const top = lengthToPxValue(tagged.top)
  const right = lengthToPxValue(tagged.right)
  const bottom = lengthToPxValue(tagged.bottom)
  const left = lengthToPxValue(tagged.left)
  if (top === null || right === null || bottom === null || left === null) return []
  if (top === right && right === bottom && bottom === left) return [['borderWidth', top]]
  return [
    ['borderTopWidth', top],
    ['borderRightWidth', right],
    ['borderBottomWidth', bottom],
    ['borderLeftWidth', left],
  ]
}

/**
 * Map CSS `border-style` keywords to the strings RN accepts. RN
 * supports only `solid` / `dashed` / `dotted` / `none` — fall back to
 * `solid` for everything else.
 * @param css CSS border-style keyword.
 * @returns RN border-style.
 */
function mapBorderStyle(css: string): string {
  if (css === 'dashed' || css === 'dotted' || css === 'none') return css
  return 'solid'
}

/**
 * Dispatch border-* longhands and their logical-direction variants to
 * RN style entries. Returns `null` for any property the dispatcher
 * doesn't handle so the caller can fall through.
 *
 * Logical-direction inputs (`border-inline-*`, `border-block-*`,
 * `border-inline-start-*`, …) lower to RN's physical pairs
 * (`borderLeft*` / `borderRight*` / `borderTop*` / `borderBottom*`)
 * since RN doesn't honor logical directions at the style level.
 * @param decl One lightningcss declaration.
 * @returns RN entries when the property matched, else `null`.
 */
export function dispatchBorderDeclaration(decl: LcDeclaration): readonly RNEntry[] | null {
  switch (decl.property) {
    case 'border-inline-color': {
      return colorPair('borderLeftColor', 'borderRightColor', decl.value)
    }
    case 'border-block-color': {
      return colorPair('borderTopColor', 'borderBottomColor', decl.value)
    }
    case 'border-inline-start-color': {
      return [['borderLeftColor', cssColorToString(decl.value)]]
    }
    case 'border-inline-end-color': {
      return [['borderRightColor', cssColorToString(decl.value)]]
    }
    case 'border-block-start-color': {
      return [['borderTopColor', cssColorToString(decl.value)]]
    }
    case 'border-block-end-color': {
      return [['borderBottomColor', cssColorToString(decl.value)]]
    }
    case 'border-width': {
      return borderWidthShorthand(decl.value)
    }
    case 'border-top-width':
    case 'border-right-width':
    case 'border-bottom-width':
    case 'border-left-width': {
      const v = lengthToPxValue(decl.value)
      return v === null ? [] : [[kebabToCamel(decl.property), v]]
    }
    case 'border-inline-width': {
      return widthPair('borderLeftWidth', 'borderRightWidth', decl.value)
    }
    case 'border-block-width': {
      return widthPair('borderTopWidth', 'borderBottomWidth', decl.value)
    }
    case 'border-inline-start-width': {
      const v = lengthToPxValue(decl.value)
      return v === null ? [] : [['borderLeftWidth', v]]
    }
    case 'border-inline-end-width': {
      const v = lengthToPxValue(decl.value)
      return v === null ? [] : [['borderRightWidth', v]]
    }
    case 'border-block-start-width': {
      const v = lengthToPxValue(decl.value)
      return v === null ? [] : [['borderTopWidth', v]]
    }
    case 'border-block-end-width': {
      const v = lengthToPxValue(decl.value)
      return v === null ? [] : [['borderBottomWidth', v]]
    }
    case 'border-style': {
      const styleValue = (decl.value as { top?: string }).top
      if (typeof styleValue !== 'string') return []
      return [['borderStyle', mapBorderStyle(styleValue)]]
    }
    case 'border-top-style':
    case 'border-right-style':
    case 'border-bottom-style':
    case 'border-left-style': {
      if (typeof decl.value !== 'string') return []
      return [['borderStyle', mapBorderStyle(decl.value)]]
    }
    default: {
      return null
    }
  }
}
