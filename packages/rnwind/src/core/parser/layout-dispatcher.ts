import type { Declaration as LcDeclaration } from 'lightningcss'
import type { RNEntry } from './types'

/**
 * Lower a CSS `overflow` keyword to one RN's `overflow` prop accepts
 * (`'visible' | 'hidden' | 'scroll'`). `auto` → `scroll` (auto means
 * scroll-when-needed), `clip` → `hidden` (closest no-scroll clip). Anything
 * else (an unexpected keyword) drops so RN never sees an invalid value.
 * @param css CSS overflow keyword.
 * @returns RN overflow keyword, or `null` to drop.
 */
function mapOverflow(css: string): string | null {
  if (css === 'visible' || css === 'hidden' || css === 'scroll') return css
  if (css === 'auto') return 'scroll'
  if (css === 'clip') return 'hidden'
  return null
}

/**
 * Build the RN `overflow` entry for a raw axis value, mapping it to an
 * RN-valid keyword and dropping unrepresentable shapes. Shared by the
 * `overflow` shorthand and the `overflow-x` / `overflow-y` longhands.
 * @param value Raw per-axis overflow value (string keyword or other).
 * @returns Single `[overflow, …]` entry, or empty when unmappable.
 */
function overflowEntry(value: unknown): readonly RNEntry[] {
  const mapped = typeof value === 'string' ? mapOverflow(value) : null
  return mapped === null ? [] : [['overflow', mapped]]
}

/**
 * Lower CSS alignment keywords to the strings RN accepts. CSS uses
 * `start`/`end` while RN sticks with the legacy `flex-start`/`flex-end`.
 * Shared between `align-items`, `align-self`, `align-content`, and
 * `justify-content` — the lowering rule is identical for all four.
 * @param css CSS keyword (`center` / `start` / `end` / `baseline` / `stretch`).
 * @returns RN-compatible keyword.
 */
function cssToRnAlignment(css: string): string {
  if (css === 'start') return 'flex-start'
  if (css === 'end') return 'flex-end'
  return css
}

/** Alias kept for clarity at the call site. Identical lowering rule. */
const cssToRnJustify = cssToRnAlignment

/**
 * Map lightningcss's `align-items` / `align-self` / `align-content`
 * value (typed as `{type: 'self-position' | 'baseline-position', value: …}`)
 * to the RN keyword RN expects.
 * @param value Typed alignment value.
 * @returns RN alignment string, or `null` when unmappable.
 */
function mapAlignKeyword(value: unknown): string | null {
  if (typeof value === 'string') return cssToRnAlignment(value)
  if (typeof value !== 'object' || value === null) return null
  const tagged = value as { type?: string; value?: string }
  if (tagged.type === 'baseline-position') return 'baseline'
  if (typeof tagged.value === 'string') return cssToRnAlignment(tagged.value)
  // Bare-keyword variants like `{type: 'stretch'}` carry the keyword
  // in the `type` field with no separate `value`.
  if (tagged.type === 'stretch' || tagged.type === 'normal') return cssToRnAlignment(tagged.type)
  return null
}

/**
 * Map lightningcss's `justify-content` value to the RN keyword.
 * @param value Typed justify value.
 * @returns RN justify string, or `null` when unmappable.
 */
function mapJustifyKeyword(value: unknown): string | null {
  if (typeof value === 'string') return cssToRnJustify(value)
  if (typeof value !== 'object' || value === null) return null
  const tagged = value as { type?: string; value?: string }
  if (typeof tagged.value === 'string') return cssToRnJustify(tagged.value)
  return null
}

/**
 * Dispatch flexbox-layout declarations (flex-direction, flex-wrap,
 * align-items, align-self, align-content, justify-content). Returns
 * `null` for any property the dispatcher doesn't handle so the caller
 * can fall through to its main switch.
 *
 * RN expects keyword-mapped strings: `flex-start` / `flex-end` instead
 * of CSS's `start` / `end`. We do the lowering here.
 * @param decl One lightningcss declaration.
 * @returns RN entries when the property matched, else `null`.
 */
export function dispatchLayoutDeclaration(decl: LcDeclaration): readonly RNEntry[] | null {
  switch (decl.property) {
    case 'flex-direction': {
      return [['flexDirection', String(decl.value)]]
    }
    case 'flex-wrap': {
      return [['flexWrap', String(decl.value)]]
    }
    case 'align-items': {
      const v = mapAlignKeyword(decl.value)
      return v === null ? [] : [['alignItems', v]]
    }
    case 'align-self': {
      const v = mapAlignKeyword(decl.value)
      return v === null ? [] : [['alignSelf', v]]
    }
    case 'align-content': {
      const v = mapAlignKeyword(decl.value)
      return v === null ? [] : [['alignContent', v]]
    }
    case 'justify-content': {
      const v = mapJustifyKeyword(decl.value)
      return v === null ? [] : [['justifyContent', v]]
    }
    case 'overflow': {
      // Lightningcss splits CSS `overflow` into `{x, y}` axes; RN only
      // supports a single `overflow` keyword. Take the `x` axis when the
      // user wrote shorthand; per-axis Tailwind utilities both emit
      // shorthand here so axis splitting is rare.
      return overflowEntry((decl.value as { x?: unknown }).x)
    }
    case 'overflow-x':
    case 'overflow-y': {
      // Tailwind's `overflow-x-*` / `overflow-y-*` emit these longhands,
      // not the `overflow` shorthand. RN has only a single `overflow`,
      // so collapse both axes onto it (last one declared wins via the
      // normal entry-merge order).
      return overflowEntry(decl.value)
    }
    default: {
      return null
    }
  }
}
