import { afterEach, describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { render } from '@testing-library/react-native'
import { useColor } from '../../src/runtime/hooks/use-scheme'
import { RnwindProvider } from '../../src/runtime/components/rnwind-provider'
import { __resetLookupCssState, registerThemeTokens } from '../../src/runtime/lookup-css'

afterEach(() => {
  __resetLookupCssState()
})

const captures: Array<string | undefined> = []

/**
 * Probe reading `useColor(name)`.
 * @param props Probe props.
 * @param props.name Color token name.
 * @returns Null.
 */
function ColorProbe({ name }: { name: string }): null {
  captures.push(useColor(name))
  return null
}

/**
 * Render the probe under a provider with NO `tables` prop (the meetelios setup)
 * and return the captured value.
 * @param scheme Active scheme.
 * @param name Color token shorthand.
 * @returns Captured color.
 */
function read(scheme: string, name: string): string | undefined {
  captures.length = 0
  render(createElement(RnwindProvider, { scheme } as never, createElement(ColorProbe, { name })))
  return captures.at(-1)
}

describe('useColor resolves from MANIFEST-registered theme tokens (no tables prop)', () => {
  it('returns the active-scheme value the build registered', () => {
    // The build emits this from the user's @theme + .dark override.
    registerThemeTokens({
      base: { '--color-on-background': '#1c1a17' },
      dark: { '--color-on-background': '#fafafa' },
    })
    expect(read('light', 'on-background')).toBe('#1c1a17') // base/light default
    expect(read('dark', 'on-background')).toBe('#fafafa') // dark override
  })

  it('still returns undefined for an unknown token', () => {
    registerThemeTokens({ base: { '--color-primary': '#123456' } })
    expect(read('light', 'does-not-exist')).toBeUndefined()
  })
})
