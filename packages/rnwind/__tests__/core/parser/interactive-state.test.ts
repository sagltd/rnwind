import { describe, expect, it } from 'bun:test'
import { TailwindParser } from '../../../src/core/parser'

/**
 * Interactive variants (`active:` / `focus:`) land in Tailwind v4's CSS
 * output as *nested* rules — the outer rule has zero direct
 * declarations, and the decls live inside `&:active { … }` or
 * `&:focus { … }`. The parser must:
 *   1. Recognise the prefix on the classname.
 *   2. Recursively flatten `style`/`media`/`nested-declarations` nodes
 *      until it finds the leaf decls.
 *   3. Apply those decls to every declared scheme so the styles carry
 *      whatever theme variables the active scheme supplies.
 *   4. Tag the bucket with `__state: 'active' | 'focus'` so downstream
 *      (style builder, runtime) can gate them on the live interact flag.
 */
describe('parser: active / focus variants tag atoms with __state', () => {
  it('single-scheme theme: active:bg-sky-700 populates the base scheme and sets __state', async () => {
    const parser = new TailwindParser({ themeCss: `@import 'tailwindcss';` })
    const result = await parser.parseAtoms({
      content: '<V className="active:bg-sky-700" />',
      extension: 'tsx',
    })
    const bucket = result.atoms.get('active:bg-sky-700')
    expect(bucket).toBeDefined()
    expect(bucket).toMatchObject({
      base: { backgroundColor: expect.any(String) },
      __state: 'active',
    })
  })

  it('multi-scheme theme: focus:opacity-50 mirrors the decls across every scheme', async () => {
    const parser = new TailwindParser({
      themeCss: `@import 'tailwindcss';
@layer theme {
  :root {
    @variant light { --color-bg: #fff; }
    @variant dark  { --color-bg: #000; }
  }
}`,
    })
    // Warm up the scheme set by parsing one atom first, then the real one.
    await parser.parseAtoms({ content: '<V className="flex-1" />', extension: 'tsx' })
    const result = await parser.parseAtoms({
      content: '<V className="focus:opacity-50" />',
      extension: 'tsx',
    })
    const bucket = result.atoms.get('focus:opacity-50')
    expect(bucket).toBeDefined()
    expect(bucket).toMatchObject({
      light: { opacity: 0.5 },
      dark: { opacity: 0.5 },
      __state: 'focus',
    })
  })

  it('interactive and transition utilities coexist — transition atoms stay un-tagged', async () => {
    // For active effects to animate (instead of snapping) Reanimated's
    // CSS engine needs the `transitionDuration` / `transitionProperty`
    // contract on the element continuously — not gated behind active.
    // Check the transition utilities land as normal (non-interactive)
    // atoms and only the `active:` / `focus:` ones carry `__state`.
    const parser = new TailwindParser({ themeCss: `@import 'tailwindcss';` })
    const result = await parser.parseAtoms({
      content: '<V className="bg-red-500 active:bg-sky-700 transition-colors duration-300" />',
      extension: 'tsx',
    })
    const bg = result.atoms.get('bg-red-500') as Record<string, unknown>
    const active = result.atoms.get('active:bg-sky-700') as Record<string, unknown>
    const transition = result.atoms.get('transition-colors') as Record<string, unknown>
    const duration = result.atoms.get('duration-300') as Record<string, unknown>
    expect(bg.__state).toBeUndefined()
    expect(transition.__state).toBeUndefined()
    expect(duration.__state).toBeUndefined()
    expect(active.__state).toBe('active')
  })
})
