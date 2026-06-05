import { afterEach, describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { render } from '@testing-library/react-native'
import { useColor, useToken } from '../../../src/runtime/hooks/use-scheme'
import { RnwindProvider } from '../../../src/runtime/components/rnwind-provider'
import { __resetLookupCssState, registerThemeTokens } from '../../../src/runtime/lookup-css'
import type { ThemeTables } from '../../../src/core/types'

/**
 * Matrix for `useColor` — the manifest token table (registered via the
 * build's `registerThemeTokens`) crossed with the explicit `tables` prop,
 * across light vs dark schemes, shorthand vs fully-qualified names, custom
 * `@theme` tokens vs the built-in palette, and the unregistered fallback.
 */

afterEach(() => {
  __resetLookupCssState()
})

const captures: Array<string | undefined> = []

/**
 * Probe reading `useColor(name)` once per render.
 * @param props Probe props.
 * @param props.name Color token shorthand or fully-qualified name.
 * @returns Null — only records into the module sink.
 */
function ColorProbe({ name }: { name: string }): null {
  captures.push(useColor(name))
  return null
}

/**
 * Coerce a `useToken` result into the string|undefined capture shape:
 * strings pass through, undefined stays undefined, numbers stringify.
 * @param value Raw token value.
 * @returns Capture-shaped value.
 */
function asCapture(value: string | number | undefined): string | undefined {
  if (typeof value === 'string') return value
  if (value === undefined) return undefined
  return String(value)
}

/**
 * Probe reading `useToken(name)` once per render — exercises the raw
 * custom-property accessor `useColor` builds on.
 * @param props Probe props.
 * @param props.name CSS custom property (with or without leading `--`).
 * @returns Null — only records into the module sink.
 */
function TokenProbe({ name }: { name: string }): null {
  captures.push(asCapture(useToken(name)))
  return null
}

/**
 * Render a probe under a provider for the given scheme and optional
 * explicit token tables, returning the captured value.
 * @param scheme Active scheme.
 * @param probe Probe element to render.
 * @param tables Optional explicit `tables` prop layered over the manifest.
 * @returns Last captured color.
 */
function read(scheme: string, probe: ReturnType<typeof createElement>, tables?: ThemeTables): string | undefined {
  captures.length = 0
  render(createElement(RnwindProvider, { scheme, tables } as never, probe))
  return captures.at(-1)
}

describe('useColor — registered custom @theme token present/absent', () => {
  it('resolves the active-scheme value the build registered (light vs dark)', () => {
    registerThemeTokens({
      base: { '--color-on-background': '#1c1a17' },
      dark: { '--color-on-background': '#fafafa' },
    })
    expect(read('light', createElement(ColorProbe, { name: 'on-background' }))).toBe('#1c1a17')
    expect(read('dark', createElement(ColorProbe, { name: 'on-background' }))).toBe('#fafafa')
  })

  it('falls back to the base default in a scheme that does not override the token', () => {
    // base-only token: every scheme inherits it (CSS `:root` cascade).
    registerThemeTokens({ base: { '--color-primary': '#123456' }, dark: { '--color-bg': '#0b1120' } })
    expect(read('light', createElement(ColorProbe, { name: 'primary' }))).toBe('#123456')
    expect(read('dark', createElement(ColorProbe, { name: 'primary' }))).toBe('#123456')
  })

  it('returns undefined for an unregistered token (no entry in any table)', () => {
    registerThemeTokens({ base: { '--color-primary': '#123456' } })
    expect(read('light', createElement(ColorProbe, { name: 'does-not-exist' }))).toBeUndefined()
  })

  it('returns undefined with an empty registry (nothing registered at all)', () => {
    expect(read('light', createElement(ColorProbe, { name: 'primary' }))).toBeUndefined()
  })
})

describe('useColor — built-in palette (base table merges under every scheme)', () => {
  it('resolves a palette color in light AND dark from the base table', () => {
    registerThemeTokens({ base: { '--color-pink-500': '#f6339a', '--color-sky-200': '#b8e6fe' }, dark: {} })
    expect(read('light', createElement(ColorProbe, { name: 'pink-500' }))).toBe('#f6339a')
    expect(read('dark', createElement(ColorProbe, { name: 'pink-500' }))).toBe('#f6339a')
    expect(read('light', createElement(ColorProbe, { name: 'sky-200' }))).toBe('#b8e6fe')
  })

  it('a dark scheme override of a palette color wins over the base default', () => {
    registerThemeTokens({ base: { '--color-accent': '#ff0000' }, dark: { '--color-accent': '#00ff00' } })
    expect(read('light', createElement(ColorProbe, { name: 'accent' }))).toBe('#ff0000')
    expect(read('dark', createElement(ColorProbe, { name: 'accent' }))).toBe('#00ff00')
  })
})

describe('useColor — prefix forms (shorthand vs fully-qualified)', () => {
  it('shorthand "primary" and full "--color-primary" both resolve (no double-prefix miss)', () => {
    const tables: ThemeTables = { light: { '--color-primary': '#abcdef' } }
    expect(read('light', createElement(ColorProbe, { name: 'primary' }), tables)).toBe('#abcdef')
    expect(read('light', createElement(ColorProbe, { name: '--color-primary' }), tables)).toBe('#abcdef')
  })

  it('the explicit `tables` prop layers over the manifest (prop wins on overlap)', () => {
    registerThemeTokens({ light: { '--color-primary': '#manifest' } })
    const tables: ThemeTables = { light: { '--color-primary': '#override' } }
    // No prop → manifest value; prop present → prop value.
    expect(read('light', createElement(ColorProbe, { name: 'primary' }))).toBe('#manifest')
    expect(read('light', createElement(ColorProbe, { name: 'primary' }), tables)).toBe('#override')
  })
})

describe('useColor — non-string guard clause', () => {
  it('returns undefined when the resolved token value is a number (accidental numeric token)', () => {
    const tables: ThemeTables = { light: { '--color-numeric': 42 } }
    expect(read('light', createElement(ColorProbe, { name: 'numeric' }), tables)).toBeUndefined()
  })
})

describe('useToken — raw accessor underpinning useColor/useSize', () => {
  it('reads a raw custom property by full name and by bare shorthand', () => {
    const tables: ThemeTables = { light: { '--radius-lg': '12px' } }
    expect(read('light', createElement(TokenProbe, { name: '--radius-lg' }), tables)).toBe('12px')
    expect(read('light', createElement(TokenProbe, { name: 'radius-lg' }), tables)).toBe('12px')
  })

  it('returns undefined for an unregistered custom property', () => {
    expect(read('light', createElement(TokenProbe, { name: 'radius-none' }))).toBeUndefined()
  })
})
