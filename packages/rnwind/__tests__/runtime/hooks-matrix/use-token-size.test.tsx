import { afterEach, describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { render } from '@testing-library/react-native'
import { useSize, useTheme, useToken } from '../../../src/runtime/hooks/use-scheme'
import { RnwindProvider } from '../../../src/runtime/components/rnwind-provider'
import { __resetLookupCssState, registerThemeTokens } from '../../../src/runtime/lookup-css'
import type { ThemeTable, ThemeTables } from '../../../src/core/types'

/**
 * Matrix for `useSize` / `useToken` / `useTheme` — the spacing-token
 * dimensions (registered present/absent, light vs dark override, prefix
 * forms, the base→scheme merge fallback) plus the full-table merge
 * semantics `useTheme` exposes.
 */

afterEach(() => {
  __resetLookupCssState()
})

const captures: Array<string | number | undefined> = []

/**
 * Probe reading `useSize(name)` once per render.
 * @param props Probe props.
 * @param props.name Spacing shorthand or fully-qualified `--spacing-*` name.
 * @returns Null — records into the module sink.
 */
function SizeProbe({ name }: { name: string }): null {
  captures.push(useSize(name))
  return null
}

const tableCaptures: ThemeTable[] = []

/**
 * Probe reading the merged `useTheme()` table once per render.
 * @returns Null — records the resolved table into the module sink.
 */
function ThemeProbe(): null {
  tableCaptures.push(useTheme())
  return null
}

/**
 * Render a probe under a provider for the given scheme + optional explicit
 * tables, returning the last captured scalar value.
 * @param scheme Active scheme.
 * @param probe Probe element to render.
 * @param tables Optional explicit `tables` prop layered over the manifest.
 * @returns Last captured size.
 */
function readSize(scheme: string, probe: ReturnType<typeof createElement>, tables?: ThemeTables): string | number | undefined {
  captures.length = 0
  render(createElement(RnwindProvider, { scheme, tables } as never, probe))
  return captures.at(-1)
}

/**
 * Render `ThemeProbe` and return the merged table for the active scheme.
 * @param scheme Active scheme.
 * @param tables Optional explicit `tables` prop layered over the manifest.
 * @returns Resolved theme table.
 */
function readTheme(scheme: string, tables?: ThemeTables): ThemeTable {
  tableCaptures.length = 0
  render(createElement(RnwindProvider, { scheme, tables } as never, createElement(ThemeProbe)))
  return tableCaptures.at(-1) ?? {}
}

describe('useSize — registered present/absent + light/dark', () => {
  it('resolves a base-table spacing token in every scheme', () => {
    registerThemeTokens({ base: { '--spacing-4': 16 }, dark: {} })
    expect(readSize('light', createElement(SizeProbe, { name: '4' }))).toBe(16)
    expect(readSize('dark', createElement(SizeProbe, { name: '4' }))).toBe(16)
  })

  it('a scheme override of a spacing token wins over the base default', () => {
    registerThemeTokens({ base: { '--spacing-gutter': 8 }, dark: { '--spacing-gutter': 24 } })
    expect(readSize('light', createElement(SizeProbe, { name: 'gutter' }))).toBe(8)
    expect(readSize('dark', createElement(SizeProbe, { name: 'gutter' }))).toBe(24)
  })

  it('returns undefined for an unregistered spacing token', () => {
    registerThemeTokens({ base: { '--spacing-4': 16 } })
    expect(readSize('light', createElement(SizeProbe, { name: '999' }))).toBeUndefined()
  })

  it('returns undefined with an empty registry', () => {
    expect(readSize('light', createElement(SizeProbe, { name: '4' }))).toBeUndefined()
  })
})

describe('useSize — prefix forms', () => {
  it('shorthand "4" and full "--spacing-4" both resolve', () => {
    const tables: ThemeTables = { light: { '--spacing-4': 16 } }
    expect(readSize('light', createElement(SizeProbe, { name: '4' }), tables)).toBe(16)
    expect(readSize('light', createElement(SizeProbe, { name: '--spacing-4' }), tables)).toBe(16)
  })

  it('preserves a string spacing value (rem/percentage tokens) unchanged', () => {
    const tables: ThemeTables = { light: { '--spacing-half': '50%' } }
    expect(readSize('light', createElement(SizeProbe, { name: 'half' }), tables)).toBe('50%')
  })
})

describe('useTheme — base/scheme merge semantics', () => {
  it('merges base under the active scheme — scheme tokens win on overlap', () => {
    const tables: ThemeTables = {
      base: { '--color-primary': '#6366f1', '--spacing-4': 16 },
      dark: { '--color-primary': '#818cf8', '--color-bg': '#0b1120' },
    }
    const result = readTheme('dark', tables)
    expect(result['--color-primary']).toBe('#818cf8') // scheme override
    expect(result['--spacing-4']).toBe(16) // inherited from base
    expect(result['--color-bg']).toBe('#0b1120') // scheme-only token
  })

  it('falls back to base when the active scheme declares no own table', () => {
    const tables: ThemeTables = { base: { '--color-primary': '#6366f1', '--spacing-4': 16 } }
    const result = readTheme('brand', tables)
    expect(result['--color-primary']).toBe('#6366f1')
    expect(result['--spacing-4']).toBe(16)
  })

  it('returns the base table on the cheap fast-path when the scheme table is empty', () => {
    const tables: ThemeTables = { base: { '--color-primary': '#6366f1' }, light: {} }
    expect(readTheme('light', tables)['--color-primary']).toBe('#6366f1')
  })

  it('returns an empty record when neither manifest nor prop tables exist', () => {
    expect(readTheme('light')).toEqual({})
  })

  it('layers the explicit `tables` prop over the manifest (prop wins per scheme)', () => {
    registerThemeTokens({ light: { '--color-primary': '#manifest', '--color-bg': '#fff' } })
    const result = readTheme('light', { light: { '--color-primary': '#prop' } })
    expect(result['--color-primary']).toBe('#prop') // prop wins
    expect(result['--color-bg']).toBe('#fff') // manifest-only token survives
  })
})

describe('useToken — numeric token round-trips through useSize', () => {
  it('useToken reads the same numeric value useSize coerces', () => {
    /**
     * Probe reading `useToken('--spacing-4')` directly.
     * @returns Null — records into the sink.
     */
    function TokenSizeProbe(): null {
      captures.push(useToken('--spacing-4'))
      return null
    }
    const tables: ThemeTables = { light: { '--spacing-4': 16 } }
    captures.length = 0
    render(createElement(RnwindProvider, { scheme: 'light', tables } as never, createElement(TokenSizeProbe)))
    expect(captures.at(-1)).toBe(16)
  })
})
