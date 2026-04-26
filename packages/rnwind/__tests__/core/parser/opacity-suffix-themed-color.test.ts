import { describe, expect, it } from 'bun:test'
import { TailwindParser } from '../../../src/core/parser'

/**
 * Regression: any utility of shape `<prefix>-<themed-color>/<N>` (e.g.
 * `border-text/20`, `bg-on-background/30`, `text-text/50`) must
 * resolve a DIFFERENT `rgba(...)` per scheme when the underlying
 * `--color-<name>` differs across schemes. Earlier the parser was
 * locking the opacity-suffixed variant to the LIGHT scheme value for
 * every variant — so `border-text/20` on a button rendered as
 * `rgba(10,10,10,0.2)` (a black-tinted border) under BOTH light and
 * dark, even though `--color-text` was `#FFFFFF` in dark.
 *
 * Symptom in the user's app: dark-mode tag pills had no visible
 * border because the resolved `rgba(10,10,10,0.2)` was nearly
 * invisible against the `#000000` background.
 *
 * The exact theme below mirrors `mobile-expanse/app/global.css`.
 */
const THEMED_CSS = `
  @import 'tailwindcss';
  @custom-variant light (&:where(.scheme-light, .scheme-light *));
  @custom-variant dark  (&:where(.scheme-dark, .scheme-dark *));
  @layer theme {
    :root {
      @variant light {
        --color-text: #0A0A0A;
        --color-background: #FAFAF7;
        --color-on-background: #0A0A0A;
        --color-border: rgba(0, 0, 0, 0.06);
      }
      @variant dark {
        --color-text: #FFFFFF;
        --color-background: #000000;
        --color-on-background: #FFFFFF;
        --color-border: rgba(255, 255, 255, 0.08);
      }
    }
  }
`

describe('parser — opacity-suffixed themed colors must vary across schemes', () => {
  it('border-text/20 resolves to per-scheme rgba: black-tinted under light, white-tinted under dark', async () => {
    const parser = new TailwindParser({ themeCss: THEMED_CSS })
    const result = await parser.parseAtoms({
      content: `<V className="border-text/20" />`,
      extension: 'tsx',
    })
    const atom = result.atoms.get('border-text/20') as Record<string, Record<string, string>> | undefined
    expect(atom?.light?.borderColor).toContain('10, 10, 10') // black-tinted
    expect(atom?.dark?.borderColor).toContain('255, 255, 255') // white-tinted
  })

  it('bg-on-background/30 differs across schemes (mirrors the user\'s tag/category-stripe usage)', async () => {
    const parser = new TailwindParser({ themeCss: THEMED_CSS })
    const result = await parser.parseAtoms({
      content: `<V className="bg-on-background/30" />`,
      extension: 'tsx',
    })
    const atom = result.atoms.get('bg-on-background/30') as Record<string, Record<string, string>> | undefined
    expect(atom?.light?.backgroundColor).toContain('10, 10, 10')
    expect(atom?.dark?.backgroundColor).toContain('255, 255, 255')
  })

  it('text-text/50 (text color with opacity) differs across schemes', async () => {
    const parser = new TailwindParser({ themeCss: THEMED_CSS })
    const result = await parser.parseAtoms({
      content: `<V className="text-text/50" />`,
      extension: 'tsx',
    })
    const atom = result.atoms.get('text-text/50') as Record<string, Record<string, string>> | undefined
    expect(atom?.light?.color).toContain('10, 10, 10')
    expect(atom?.dark?.color).toContain('255, 255, 255')
  })

  it('control: opacity-less variant ALREADY resolves per-scheme (sanity check the regression isolated to the /N path)', async () => {
    const parser = new TailwindParser({ themeCss: THEMED_CSS })
    const result = await parser.parseAtoms({
      content: `<V className="text-text border-text bg-background" />`,
      extension: 'tsx',
    })
    const text = result.atoms.get('text-text') as Record<string, Record<string, string>> | undefined
    expect(text?.light?.color).toBe('#0A0A0A')
    expect(text?.dark?.color).toBe('#FFFFFF')
    const border = result.atoms.get('border-text') as Record<string, Record<string, string>> | undefined
    expect(border?.light?.borderColor).toBe('#0A0A0A')
    expect(border?.dark?.borderColor).toBe('#FFFFFF')
  })
})

/**
 * Built-in Tailwind colors (`red-500`, `sky-700`, …) DON'T vary across
 * schemes — `red-500` is the same hex everywhere — so the per-scheme
 * regression doesn't apply to them. What we DO need to assert: their
 * `/N` opacity-suffixed form actually applies the opacity (rgba with
 * the right alpha), not the raw hex with no transparency.
 *
 * If this test ever fails, opacity is leaking through entirely (rnwind
 * dropping the `/N` suffix) — a separate class of bug from the themed-
 * color one above but caught by the same general "opacity suffix" fence.
 */
describe('parser — built-in Tailwind colors with /N opacity suffix', () => {
  const PLAIN_CSS = `@import 'tailwindcss';`

  it('bg-red-500/50 → rgba with the matching alpha (≈0.5)', async () => {
    const parser = new TailwindParser({ themeCss: PLAIN_CSS })
    const result = await parser.parseAtoms({ content: `<V className="bg-red-500/50" />`, extension: 'tsx' })
    const atom = result.atoms.get('bg-red-500/50') as Record<string, Record<string, string>> | undefined
    const color = atom?.[result.schemes[0]!]?.backgroundColor as string | undefined
    expect(color, 'bg-red-500/50 should resolve to a backgroundColor').toBeDefined()
    expect(color).toMatch(/^rgba\(/)
    // Extract the alpha — must be ~0.5, not 1.
    const alpha = Number((/,\s*([01](?:\.\d+)?)\)$/.exec(color!) ?? [])[1])
    expect(alpha).toBeGreaterThanOrEqual(0.45)
    expect(alpha).toBeLessThanOrEqual(0.55)
  })

  it('text-sky-700/30 → color with alpha ≈ 0.3', async () => {
    const parser = new TailwindParser({ themeCss: PLAIN_CSS })
    const result = await parser.parseAtoms({ content: `<V className="text-sky-700/30" />`, extension: 'tsx' })
    const atom = result.atoms.get('text-sky-700/30') as Record<string, Record<string, string>> | undefined
    const color = atom?.[result.schemes[0]!]?.color as string | undefined
    expect(color).toMatch(/^rgba\(/)
    const alpha = Number((/,\s*([01](?:\.\d+)?)\)$/.exec(color!) ?? [])[1])
    expect(alpha).toBeGreaterThanOrEqual(0.25)
    expect(alpha).toBeLessThanOrEqual(0.35)
  })

  it('border-black/10 → borderColor with alpha ≈ 0.1', async () => {
    const parser = new TailwindParser({ themeCss: PLAIN_CSS })
    const result = await parser.parseAtoms({ content: `<V className="border-black/10" />`, extension: 'tsx' })
    const atom = result.atoms.get('border-black/10') as Record<string, Record<string, string>> | undefined
    const color = atom?.[result.schemes[0]!]?.borderColor as string | undefined
    expect(color).toMatch(/^rgba\(0,\s*0,\s*0,/)
    const alpha = Number((/,\s*([01](?:\.\d+)?)\)$/.exec(color!) ?? [])[1])
    expect(alpha).toBeGreaterThanOrEqual(0.05)
    expect(alpha).toBeLessThanOrEqual(0.15)
  })

  it('bg-white/80 → rgba(255, 255, 255, ≈0.8)', async () => {
    const parser = new TailwindParser({ themeCss: PLAIN_CSS })
    const result = await parser.parseAtoms({ content: `<V className="bg-white/80" />`, extension: 'tsx' })
    const atom = result.atoms.get('bg-white/80') as Record<string, Record<string, string>> | undefined
    const color = atom?.[result.schemes[0]!]?.backgroundColor as string | undefined
    expect(color).toMatch(/^rgba\(255,\s*255,\s*255,/)
    const alpha = Number((/,\s*([01](?:\.\d+)?)\)$/.exec(color!) ?? [])[1])
    expect(alpha).toBeGreaterThanOrEqual(0.75)
    expect(alpha).toBeLessThanOrEqual(0.85)
  })

  it('arbitrary opacity bg-red-500/[0.42] honours the explicit alpha', async () => {
    const parser = new TailwindParser({ themeCss: PLAIN_CSS })
    const result = await parser.parseAtoms({ content: `<V className="bg-red-500/[0.42]" />`, extension: 'tsx' })
    const atom = result.atoms.get('bg-red-500/[0.42]') as Record<string, Record<string, string>> | undefined
    const color = atom?.[result.schemes[0]!]?.backgroundColor as string | undefined
    expect(color).toMatch(/^rgba\(/)
    const alpha = Number((/,\s*([01](?:\.\d+)?)\)$/.exec(color!) ?? [])[1])
    expect(alpha).toBeGreaterThanOrEqual(0.4)
    expect(alpha).toBeLessThanOrEqual(0.44)
  })
})
