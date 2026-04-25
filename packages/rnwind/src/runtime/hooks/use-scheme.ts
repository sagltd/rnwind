import type { ThemeTable } from '../../core/types'
import { useRnwind } from '../components/rnwind-provider'

/**
 * Synthetic scheme name applied when tokens aren't declared under any
 * `@variant` block — the "no active variant" fallback every theme table
 * inherits from.
 */
const BASE_SCHEME = 'base'

/**
 * Access the resolved theme table for the active scheme.
 *
 * Tokens declared outside any `@variant` block live in the `base` table and
 * should apply everywhere — just like the CSS cascade treats `:root` as a
 * default for every ancestor-scoped override. We merge `base` under the
 * active scheme so a scheme that doesn't declare a token still sees the
 * base default, while the scheme's own entries win on overlap.
 * @returns Token table for the active scheme.
 */
export function useTheme(): ThemeTable {
  const { scheme, tables } = useRnwind()
  const base = tables[BASE_SCHEME] ?? {}
  const schemeTable = tables[scheme]
  if (!schemeTable) return base
  // Fast path: nothing to merge when the scheme table is empty.
  if (Object.keys(schemeTable).length === 0) return base
  return { ...base, ...schemeTable }
}

/**
 * Read a raw CSS custom property's value for the active scheme. Accepts
 * either `--foo` or the bare `foo` form for convenience.
 * @param cssVariable CSS custom property name (with or without the leading `--`).
 * @returns The resolved value, or undefined when the token is missing.
 */
export function useToken(cssVariable: string): string | number | undefined {
  const table = useTheme()
  const name = cssVariable.startsWith('--') ? cssVariable : `--${cssVariable}`
  return table[name]
}

/**
 * Read a color token by shorthand name — `useColor('primary')` resolves
 * `--color-primary` for the active scheme.
 * @param name Token suffix after `--color-`.
 * @returns Resolved color string, or undefined when the token is missing
 *   or its value isn't a string.
 */
export function useColor(name: string): string | undefined {
  const value = useToken(`--color-${name}`)
  return typeof value === 'string' ? value : undefined
}

/**
 * Read a spacing token by shorthand name — `useSize('4')` resolves
 * `--spacing-4` for the active scheme.
 * @param name Token suffix after `--spacing-`.
 * @returns Resolved spacing value, or undefined when the token is missing.
 */
export function useSize(name: string): number | string | undefined {
  return useToken(`--spacing-${name}`)
}
