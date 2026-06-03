import { afterEach, describe, expect, it } from 'bun:test'
import { createElement, type ComponentType, type ReactElement } from 'react'
import { act, create } from './_test-renderer'
import { __resetLookupCssState } from '../../src/runtime/lookup-css'
import { RnwindProvider, type RnwindProviderProps } from '../../src/runtime/components/rnwind-provider'
import { useColor, useSize, useTheme, useToken } from '../../src/runtime/hooks/use-scheme'
import type { ThemeTables } from '../../src/core/types'

const TABLES: ThemeTables = {
  base: { '--color-primary': '#6366f1', '--spacing-4': 16 },
  dark: { '--color-primary': '#818cf8', '--color-bg': '#0b1120' },
  light: {},
}

/**
 * Render `Probe` under `<RnwindProvider {...providerProps}>` and return
 * the value `Probe` produced via the shared module-scope sink. Lets each
 * test focus on the hook-under-test instead of repeating the
 * `act` / `create` / `getByTestId` plumbing.
 * @param Probe Component-shaped probe that calls a hook and writes to {@link captured}.
 * @param providerProps Props forwarded to the provider.
 * @returns Whatever the probe wrote into {@link captured.value} for this render.
 */
function renderProbe(Probe: ComponentType, providerProps: RnwindProviderProps): unknown {
  captured.value = undefined
  act(() => {
    create(createElement(RnwindProvider, providerProps, createElement(Probe)))
  })
  return captured.value
}

/** Module-scope sink — probes write here, {@link renderProbe} reads it back. */
const captured: { value: unknown } = { value: undefined }

/**
 * Build a probe component bound to one specific hook call. Saves the
 * one-line repetition of `function Probe() { captured.value = ...; return null }`
 * across every `it()`.
 * @param read Hook caller — runs inside the probe's render and produces the value to capture.
 * @returns Component suitable for `renderProbe`.
 */
function probe(read: () => unknown): ComponentType {
  /**
   * Probe component that runs the supplied hook reader once per render
   * and stashes the result in the module-scope sink.
   * @returns null — host has no DOM, just side-effect captures.
   */
  function Probe(): ReactElement | null {
    captured.value = read()
    return null
  }
  return Probe
}

afterEach(() => {
  __resetLookupCssState()
  captured.value = undefined
})

describe('useTheme', () => {
  it('merges base tokens under the active scheme — scheme tokens win on overlap', () => {
    const result = renderProbe(probe(useTheme), { scheme: 'dark', tables: TABLES }) as Record<string, unknown>
    expect(result['--color-primary']).toBe('#818cf8')
    expect(result['--spacing-4']).toBe(16)
    expect(result['--color-bg']).toBe('#0b1120')
  })

  it('falls back to base when the active scheme has no own table', () => {
    const result = renderProbe(probe(useTheme), { scheme: 'brand', tables: TABLES }) as Record<string, unknown>
    expect(result['--color-primary']).toBe('#6366f1')
    expect(result['--spacing-4']).toBe(16)
  })

  it('returns the base table directly when the scheme table is empty (cheap fast path)', () => {
    const result = renderProbe(probe(useTheme), { scheme: 'light', tables: TABLES }) as Record<string, unknown>
    expect(result['--color-primary']).toBe('#6366f1')
  })

  it('returns an empty record when neither scheme nor base tables exist', () => {
    expect(renderProbe(probe(useTheme), { scheme: 'light' })).toEqual({})
  })
})

describe('useToken', () => {
  it('reads a `--name` token directly', () => {
    expect(renderProbe(probe(() => useToken('--color-primary')), { scheme: 'base', tables: TABLES })).toBe('#6366f1')
  })

  it('accepts the bare-name shorthand without leading `--`', () => {
    expect(renderProbe(probe(() => useToken('color-primary')), { scheme: 'base', tables: TABLES })).toBe('#6366f1')
  })

  it('returns undefined for a token that does not exist', () => {
    expect(renderProbe(probe(() => useToken('color-missing')), { scheme: 'base', tables: TABLES })).toBeUndefined()
  })
})

describe('useColor', () => {
  it('returns the resolved color string for `--color-<name>`', () => {
    expect(renderProbe(probe(() => useColor('primary')), { scheme: 'dark', tables: TABLES })).toBe('#818cf8')
  })

  it('returns undefined for a missing color token', () => {
    expect(renderProbe(probe(() => useColor('nope')), { scheme: 'base', tables: TABLES })).toBeUndefined()
  })

  it('returns undefined when the resolved value is non-string (accidental numeric token)', () => {
    const tables: ThemeTables = { base: { '--color-numeric': 42 } }
    expect(renderProbe(probe(() => useColor('numeric')), { scheme: 'base', tables })).toBeUndefined()
  })
})

describe('useSize', () => {
  it('returns the spacing value for `--spacing-<name>`', () => {
    expect(renderProbe(probe(() => useSize('4')), { scheme: 'base', tables: TABLES })).toBe(16)
  })

  it('returns undefined for a missing spacing token', () => {
    expect(renderProbe(probe(() => useSize('999')), { scheme: 'base', tables: TABLES })).toBeUndefined()
  })
})
