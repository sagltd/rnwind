import { beforeAll, describe, expect, it } from 'bun:test'
import { TailwindParser, type RNStyle } from '../../../src/core/parser'
import { __resetLookupCssState, lookupCss, registerAtoms } from '../../../src/runtime/lookup-css'
import { ctx } from '../../runtime/_ctx'

/**
 * Regression: the idiomatic Tailwind v4 "light defaults live in `@theme`,
 * only `@variant dark` overrides" shape must still switch schemes.
 *
 * meetelios' theme.css declares BOTH `@custom-variant light` and
 * `@custom-variant dark`, but puts the light palette in the base `@theme`
 * block and writes only a `@variant dark { … }` override (no explicit
 * `@variant light { … }` block). Earlier the parser derived its scheme
 * list purely from `@variant` blocks, so `light` was never registered:
 * every themed atom got a single `dark` bucket and flipping the runtime
 * scheme changed nothing — the reported "appearance toggles, colours
 * don't" bug.
 *
 * The fix: a scheme declared via `@custom-variant <name>` counts as a
 * scheme even with no override block; its values come from the base
 * `@theme`.
 */
const MEETELIOS_THEME = `@import 'tailwindcss';
@custom-variant light (&:where(.scheme-light, .scheme-light *));
@custom-variant dark (&:where(.scheme-dark, .scheme-dark *));

@theme {
  --color-bg: #ffffff;
  --color-fg: #0a0a0a;
  --color-primary: #4f46e5;
}

@layer theme {
  :root {
    @variant dark {
      --color-bg: #0a0a0a;
      --color-fg: #fafafa;
      --color-primary: #6366f1;
    }
  }
}`

let parser: TailwindParser

beforeAll(async () => {
  parser = new TailwindParser({ themeCss: MEETELIOS_THEME })
  // Warm the compiler so the first assertion below doesn't pay ~500ms.
  await parser.parseAtoms({ content: '<V className="flex-1" />', extension: 'tsx' })
})

describe('implicit-light scheme — parser registers `light` from `@custom-variant`', () => {
  it('lists `light` as a scheme even though only `dark` has a `@variant` block', () => {
    expect([...parser.declaredSchemes].toSorted((a, b) => a.localeCompare(b))).toEqual(['dark', 'light'])
  })

  it('ignores non-scheme `@custom-variant`s (hover / @media / @supports) — only class selectors are schemes', () => {
    // `@custom-variant` is Tailwind's general variant mechanism; most
    // declarations aren't schemes and must not pollute the scheme list.
    const noisy = new TailwindParser({
      themeCss: `${MEETELIOS_THEME}
@custom-variant hocus (&:hover, &:focus);
@custom-variant supports-grid (@supports (display: grid));
@custom-variant pointer-coarse (@media (pointer: coarse));`,
    })
    expect([...noisy.declaredSchemes].toSorted((a, b) => a.localeCompare(b))).toEqual(['dark', 'light'])
  })

  it('resolves themed atoms into BOTH light and dark buckets so the runtime can switch', async () => {
    const out = await parser.parseAtoms({ content: '<V className="bg-bg bg-primary text-fg" />', extension: 'tsx' })
    expect([...out.schemes].toSorted((a, b) => a.localeCompare(b))).toEqual(['dark', 'light'])

    const bucketOf = (name: string): Record<string, RNStyle> | undefined => out.atoms.get(name)
    // `light` = base `@theme` values; `dark` = the override block.
    expect(bucketOf('bg-bg')).toEqual({
      light: { backgroundColor: '#ffffff' },
      dark: { backgroundColor: '#0a0a0a' },
    })
    expect(bucketOf('bg-primary')).toEqual({
      light: { backgroundColor: '#4f46e5' },
      dark: { backgroundColor: '#6366f1' },
    })
    // Sanity: the two schemes really do differ — this is the switch the
    // user was missing.
    expect(bucketOf('bg-bg')?.light).not.toEqual(bucketOf('bg-bg')?.dark)
  })
})

describe('implicit-light scheme — runtime switches through lookupCss', () => {
  it('flips bg-bg light↔dark end-to-end (parser buckets → registry → lookupCss)', async () => {
    const out = await parser.parseAtoms({ content: '<V className="bg-bg" />', extension: 'tsx' })
    const bucket = out.atoms.get('bg-bg')!
    try {
      // Feed the parser's per-scheme output into the registry exactly the
      // way the generated `<scheme>.style.js` files do.
      for (const scheme of out.schemes) registerAtoms(scheme, { 'bg-bg': bucket[scheme]! })
      expect(lookupCss('bg-bg', ctx('light'))).toEqual([{ backgroundColor: '#ffffff' }])
      expect(lookupCss('bg-bg', ctx('dark'))).toEqual([{ backgroundColor: '#0a0a0a' }])
    } finally {
      __resetLookupCssState()
    }
  })
})
