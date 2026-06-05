import type { Declaration as LcDeclaration } from 'lightningcss'
import { cssColorToString, isCssWideColorKeyword } from './color'
import type { RNEntry } from './types'

/**
 * Build a `[key, hex]` entry from a typed CssColor. Drops CSS-wide cascade
 * keywords (`currentColor`, `inherit`, `initial`, `unset`, `revert`,
 * `revert-layer`) — RN has no color cascade, so those reach the native view
 * manager as invalid color strings.
 * @param key RN style key (camelCase).
 * @param value Typed `CssColor`-shaped value.
 * @returns Single-entry list or empty.
 */
function colorEntry(key: string, value: unknown): readonly RNEntry[] {
  if (value === null || value === undefined) return []
  if (typeof value === 'string') return isCssWideColorKeyword(value) ? [] : [[key, value]]
  const hex = cssColorToString(value as never)
  if (isCssWideColorKeyword(hex)) return []
  return [[key, hex]]
}

/**
 * Several typed color properties wrap their `CssColor` payload inside a
 * `{type: 'color', value: CssColor}` envelope. Unwrap so the inner color
 * reaches {@link cssColorToString}.
 * @param value Either a `CssColor` directly or a `{type: 'color', value}` wrapper.
 * @returns Unwrapped `CssColor` (or the input untouched).
 */
function unwrapTaggedColor(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  const tagged = value as { type?: string; value?: unknown }
  if (tagged.type === 'color') return tagged.value
  return value
}

/**
 * Dispatch color-typed CSS properties (text-decoration-color, fill,
 * stroke, caret-color, outline-color, …) to RN-compatible style entries.
 *
 * lightningcss emits two shapes for color properties:
 *  - bare `CssColor` value (e.g. `text-decoration-color`, `outline-color`)
 *  - wrapped `{type: 'color', value: CssColor}` (e.g. `fill`, `stroke`,
 *    `caret-color`, `accent-color`)
 * We unwrap both and run them through {@link cssColorToString} to land
 * at hex/rgba.
 *
 * Returns `null` for any property the dispatcher doesn't handle so the
 * caller can fall through to the next dispatcher.
 * @param decl One lightningcss declaration.
 * @returns RN entries when the property matched, else `null`.
 */
export function dispatchColorPropertyDeclaration(decl: LcDeclaration): readonly RNEntry[] | null {
  switch (decl.property) {
    case 'text-decoration-color': {
      return colorEntry('textDecorationColor', decl.value)
    }
    case 'caret-color': {
      return colorEntry('caretColor', unwrapTaggedColor(decl.value))
    }
    case 'fill': {
      return colorEntry('fill', unwrapTaggedColor(decl.value))
    }
    case 'stroke': {
      return colorEntry('stroke', unwrapTaggedColor(decl.value))
    }
    case 'outline-color': {
      // RN doesn't render outlines, but tooling like react-native-web /
      // a11y overlays read it — keep so cross-platform code carries the
      // value through.
      return colorEntry('outlineColor', decl.value)
    }
    case 'accent-color': {
      // RN has no native accent color; skip silently.
      return []
    }
    default: {
      return null
    }
  }
}
