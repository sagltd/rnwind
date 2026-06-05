import { describe, expect, it } from 'bun:test'
import { TailwindParser, type RNStyle } from '../../../src/core/parser'

/**
 * Regression: Tailwind v4's STANDARD dark-mode shape overrides theme vars in a
 * plain `.dark { … }` selector block (often wrapped in `@layer base`), NOT a
 * `@variant dark { … }` block. The theme-var walker only recognised `@variant`
 * blocks as a scheme scope, so `.dark`'s overrides poured into the BASE scheme
 * and overwrote the light defaults — every scheme then rendered the dark
 * palette (light mode broke entirely).
 */

/**
 * Resolve `bg-bg` per scheme for a given theme CSS.
 * @param themeCss Theme stylesheet.
 * @returns The per-scheme bucket for `bg-bg`.
 */
async function bgBucket(themeCss: string): Promise<Record<string, RNStyle> | undefined> {
  const parser = new TailwindParser({ themeCss })
  const out = await parser.parseAtoms({ content: '<V className="bg-bg" />', extension: 'tsx' })
  return out.atoms.get('bg-bg') as Record<string, RNStyle> | undefined
}

describe('.dark { } selector override routes to the dark scheme (not base)', () => {
  it('keeps light at the @theme default and dark at the .dark override', async () => {
    const bucket = await bgBucket(`@import "tailwindcss";
@custom-variant light (&:where(.light, .light *));
@custom-variant dark (&:where(.dark, .dark *));
@theme { --color-bg: #ffffff; }
@layer base { .dark { --color-bg: #0a0a0a; } }`)
    expect(bucket).toEqual({
      light: { backgroundColor: '#ffffff' },
      dark: { backgroundColor: '#0a0a0a' },
    })
  })

  it('matches the @variant block form (parity between the two dark shapes)', async () => {
    const bucket = await bgBucket(`@import "tailwindcss";
@custom-variant light (&:where(.light, .light *));
@custom-variant dark (&:where(.dark, .dark *));
@theme { --color-bg: #ffffff; }
@variant dark { @theme { --color-bg: #0a0a0a; } }`)
    expect(bucket).toEqual({
      light: { backgroundColor: '#ffffff' },
      dark: { backgroundColor: '#0a0a0a' },
    })
  })

  it('aliased selector class (.scheme-dark) also routes to its scheme', async () => {
    const bucket = await bgBucket(`@import "tailwindcss";
@custom-variant light (&:where(.scheme-light, .scheme-light *));
@custom-variant dark (&:where(.scheme-dark, .scheme-dark *));
@theme { --color-bg: #ffffff; }
@layer base { .scheme-dark { --color-bg: #111111; } }`)
    expect(bucket?.light).toEqual({ backgroundColor: '#ffffff' })
    expect(bucket?.dark).toEqual({ backgroundColor: '#111111' })
  })
})
