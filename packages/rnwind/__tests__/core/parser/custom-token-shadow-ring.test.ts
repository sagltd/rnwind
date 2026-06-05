import { beforeAll, describe, expect, it } from 'bun:test'
import { TailwindParser, type RNStyle } from '../../../src/core/parser'

/**
 * Regression: `shadow-<token>` / `ring-<token>` for CUSTOM `@theme` colors.
 * Tailwind emits these as composable `--tw-shadow-color` / `--tw-ring-color`
 * custom props holding `var(--color-x)` (often wrapped in a `color-mix(…)`
 * alpha expression). They flow through `resolveCustomColorString`, which used
 * to (a) leave `var(--color-x)` unresolved and (b) choke on the nested
 * color-mix the `/opacity` modifier produces — both dropped the color, so a
 * themed shadow/ring rendered nothing. Pins concrete RN values.
 */
const THEME = `@import "tailwindcss";
@theme {
  --color-c: #ef4444;
  --color-ok: oklch(0.6 0.2 25);
}`

let parser: TailwindParser

beforeAll(async () => {
  parser = new TailwindParser({ themeCss: THEME })
  await parser.parseAtoms({ content: '<V className="flex-1" />', extension: 'tsx' })
})

/**
 * Resolve the base-scheme RN style for one class.
 * @param cls Tailwind utility.
 * @returns Base-scheme style, or undefined.
 */
async function styleOf(cls: string): Promise<RNStyle | undefined> {
  const r = await parser.parseAtoms({ content: `<V className="${cls}" />`, extension: 'tsx' })
  const [scheme] = r.schemes
  return scheme ? r.atoms.get(cls)?.[scheme] : undefined
}

describe('custom-token shadow/ring colors resolve (no silent drop)', () => {
  it('shadow-<token> resolves shadowColor', async () => {
    expect(await styleOf('shadow-c')).toEqual({ shadowColor: 'rgba(239, 68, 68, 1)' })
  })

  it('shadow-<token>/<opacity> applies the modifier alpha (nested color-mix)', async () => {
    expect(await styleOf('shadow-c/50')).toEqual({ shadowColor: 'rgba(239, 68, 68, 0.5)' })
  })

  it('ring-<token> approximates as borderColor', async () => {
    expect(await styleOf('ring-c')).toEqual({ borderColor: '#ef4444' })
  })

  it('oklch custom token shadow is lowered to an RN-safe sRGB string', async () => {
    const style = await styleOf('shadow-ok')
    const value = style?.shadowColor as string | undefined
    expect(typeof value === 'string' && /^(#[0-9a-f]{6}|rgba\()/i.test(value as string)).toBe(true)
  })
})
