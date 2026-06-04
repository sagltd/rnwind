import { afterEach, describe, expect, it } from 'bun:test'
import { createElement, type ReactNode } from 'react'
import { render } from '@testing-library/react-native'
import { useCss } from '../../src/runtime/hooks/use-css'
import { useColor } from '../../src/runtime/hooks/use-scheme'
import { RnwindProvider } from '../../src/runtime/components/rnwind-provider'
import { __resetLookupCssState, registerAtoms } from '../../src/runtime/lookup-css'
import { __resetResolveState, registerMolecules } from '../../src/runtime/resolve'
import type { ThemeTables } from '../../src/core/types'

afterEach(() => {
  __resetResolveState()
  __resetLookupCssState()
})

// Capture sinks — probes push their latest hook output here so assertions
// can read it after each render (mutating an array dodges the
// react-perf/no-reassigning-captured lint).
const cssCaptures: unknown[] = []
const colorCaptures: Array<string | undefined> = []

/**
 * Probe reading `useCss('bg-bg')` — records the resolved style.
 * @returns Null.
 */
function CssProbe(): null {
  cssCaptures.push(useCss('bg-bg'))
  return null
}

/**
 * Probe reading `useColor('bg')` — records the resolved color token.
 * @returns Null.
 */
function ColorProbe(): null {
  colorCaptures.push(useColor('bg'))
  return null
}

/** Theme tables with a per-scheme `--color-bg`. */
const TABLES: ThemeTables = {
  light: { '--color-bg': '#ffffff' },
  dark: { '--color-bg': '#0a0a0a' },
}

describe('reactivity — useCss re-resolves on scheme change', () => {
  it('returns the active scheme molecule and updates when the provider scheme flips', () => {
    registerMolecules('light', { 'bg-bg': { backgroundColor: '#ffffff' } })
    registerMolecules('dark', { 'bg-bg': { backgroundColor: '#0a0a0a' } })
    cssCaptures.length = 0

    const { rerender } = render(
      createElement(RnwindProvider, { scheme: 'light' } as never, createElement(CssProbe)),
    )
    expect((cssCaptures.at(-1) as Record<string, unknown>).backgroundColor).toBe('#ffffff')

    rerender(createElement(RnwindProvider, { scheme: 'dark' } as never, createElement(CssProbe)))
    expect((cssCaptures.at(-1) as Record<string, unknown>).backgroundColor).toBe('#0a0a0a')

    rerender(createElement(RnwindProvider, { scheme: 'light' } as never, createElement(CssProbe)))
    expect((cssCaptures.at(-1) as Record<string, unknown>).backgroundColor).toBe('#ffffff')
  })

  it('atom-fallback path is reactive too (per-scheme atom registries)', () => {
    registerAtoms('light', { 'bg-bg': { backgroundColor: '#ffffff' } })
    registerAtoms('dark', { 'bg-bg': { backgroundColor: '#0a0a0a' } })
    cssCaptures.length = 0

    const { rerender } = render(
      createElement(RnwindProvider, { scheme: 'light' } as never, createElement(CssProbe)),
    )
    expect((cssCaptures.at(-1) as Record<string, unknown>).backgroundColor).toBe('#ffffff')

    rerender(createElement(RnwindProvider, { scheme: 'dark' } as never, createElement(CssProbe)))
    expect((cssCaptures.at(-1) as Record<string, unknown>).backgroundColor).toBe('#0a0a0a')
  })
})

/**
 * `<RnwindProvider scheme tables>` wrapping the color probe.
 * @param scheme Active scheme.
 * @returns Provider element.
 */
function colorTree(scheme: 'light' | 'dark'): ReactNode {
  return createElement(RnwindProvider, { scheme, tables: TABLES } as never, createElement(ColorProbe))
}

describe('reactivity — useColor re-resolves on scheme change', () => {
  it('returns the active scheme color token and updates when the provider scheme flips', () => {
    colorCaptures.length = 0
    const { rerender } = render(colorTree('light') as never)
    expect(colorCaptures.at(-1)).toBe('#ffffff')

    rerender(colorTree('dark') as never)
    expect(colorCaptures.at(-1)).toBe('#0a0a0a')

    rerender(colorTree('light') as never)
    expect(colorCaptures.at(-1)).toBe('#ffffff')
  })
})
