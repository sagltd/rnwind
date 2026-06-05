import { useMemo } from 'react'
import type { ThemeTable } from '../../core/types'
import { useRnwind } from '../components/rnwind-provider'
import { getThemeTokens } from '../lookup-css'

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
  // The build registers token tables on the manifest so `useColor` works out
  // of the box; an explicit `tables` prop layers on top (the prop wins).
  // `getThemeTokens()` REPLACES its map on registration, so its identity is
  // stable between (HMR) registers — a sound memo dep. Memoizing keeps the
  // merged table a STABLE reference across renders, so every `useColor` /
  // `useToken` / `useSize` call avoids re-allocating 2–3 objects per render.
  const registered = getThemeTokens()
  return useMemo(() => {
    const base = { ...registered[BASE_SCHEME], ...tables[BASE_SCHEME] }
    const schemeTable = { ...registered[scheme], ...tables[scheme] }
    // Base tokens apply everywhere (CSS `:root` cascade); the active scheme's
    // own entries override on overlap.
    if (Object.keys(schemeTable).length === 0) return base
    return { ...base, ...schemeTable }
  }, [scheme, tables, registered])
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
 * `--color-primary` for the active scheme. A fully-qualified name
 * (`--color-primary`) is accepted as-is, so the call doesn't silently miss by
 * double-prefixing into `--color---color-primary`.
 * @param name Token suffix after `--color-`, or the full `--color-*` name.
 * @returns Resolved color string, or undefined when the token is missing
 *   or its value isn't a string.
 */
export function useColor(name: string): string | undefined {
  const value = useToken(name.startsWith('--') ? name : `--color-${name}`)
  return typeof value === 'string' ? value : undefined
}

/**
 * Read a spacing token by shorthand name — `useSize('4')` resolves
 * `--spacing-4` for the active scheme. A fully-qualified `--spacing-*` name is
 * accepted as-is (no double-prefix miss).
 * @param name Token suffix after `--spacing-`, or the full `--spacing-*` name.
 * @returns Resolved spacing value, or undefined when the token is missing.
 */
export function useSize(name: string): number | string | undefined {
  return useToken(name.startsWith('--') ? name : `--spacing-${name}`)
}
