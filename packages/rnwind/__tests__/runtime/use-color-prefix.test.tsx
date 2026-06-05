import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { render } from '@testing-library/react-native'
import { useColor, useSize } from '../../src/runtime/hooks/use-scheme'
import { RnwindProvider } from '../../src/runtime/components/rnwind-provider'
import type { ThemeTables } from '../../src/core/types'

const TABLES: ThemeTables = {
  light: { '--color-primary': '#123456', '--spacing-4': 16 },
}

const captures: Array<string | number | undefined> = []

/**
 * Probe reading `useColor(name)` unconditionally.
 * @param props Probe props.
 * @param props.name Color token name.
 * @returns Null.
 */
function ColorProbe({ name }: { name: string }): null {
  captures.push(useColor(name))
  return null
}

/**
 * Probe reading `useSize(name)` unconditionally.
 * @param props Probe props.
 * @param props.name Spacing token name.
 * @returns Null.
 */
function SizeProbe({ name }: { name: string }): null {
  captures.push(useSize(name))
  return null
}

/**
 * Render a probe under the light-scheme provider and return the captured value.
 * @param probe The probe element to render.
 * @returns The last captured hook value.
 */
function read(probe: ReturnType<typeof createElement>): string | number | undefined {
  captures.length = 0
  render(createElement(RnwindProvider, { scheme: 'light', tables: TABLES } as never, probe))
  return captures.at(-1)
}

describe('useColor / useSize accept both shorthand and fully-qualified names', () => {
  it('useColor("primary") resolves --color-primary', () => {
    expect(read(createElement(ColorProbe, { name: 'primary' }))).toBe('#123456')
  })
  it('useColor("--color-primary") resolves too (no double-prefix miss)', () => {
    expect(read(createElement(ColorProbe, { name: '--color-primary' }))).toBe('#123456')
  })
  it('useSize("4") resolves --spacing-4', () => {
    expect(read(createElement(SizeProbe, { name: '4' }))).toBe(16)
  })
  it('useSize("--spacing-4") resolves too', () => {
    expect(read(createElement(SizeProbe, { name: '--spacing-4' }))).toBe(16)
  })
})
