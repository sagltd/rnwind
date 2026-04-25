import { describe, expect, it } from 'bun:test'
import { TailwindParser, type RNStyle } from '../../../src/core/parser'

/**
 * End-to-end cover for Tailwind v4 `@utility` declarations a consumer
 * adds to their `global.css`. The parser → style-builder → runtime pipeline
 * must accept these the same as built-in atoms:
 *  - Static `@utility foo { … }` compiles to a flat RN style.
 *  - Functional `@utility foo-* { … --value(integer) … }` accepts a
 *    number suffix and substitutes the integer into the CSS before
 *    resolution.
 *  - `@utility foo-*` with `--value([*])` accepts bracketed arbitrary
 *    values (`foo-[12px]`, `foo-[2rem]`).
 *
 * The asserted contract is the resolved base-scheme RN style — what the
 * build-side emits into the style.js registry at build time.
 */

/**
 * Build a parser for the supplied theme CSS, resolve one className
 * against it, and return the base-scheme RN style.
 * @param themeCss Theme CSS containing `@utility` declarations.
 * @param className Tailwind token the user wrote.
 * @returns Resolved RN style (first declared scheme).
 */
async function resolve(themeCss: string, className: string): Promise<RNStyle> {
  const parser = new TailwindParser({ themeCss })
  const result = await parser.parseAtoms({ content: `<V className="${className}" />`, extension: 'tsx' })
  const schemed = result.atoms.get(className)
  if (!schemed) throw new Error(`atom ${className} missing from parser output`)
  const [firstScheme] = Object.keys(schemed)
  return schemed[firstScheme!] as RNStyle
}

describe('user @utility — static body', () => {
  it('resolves a simple @utility to the right RN style', async () => {
    const css = `@import "tailwindcss";
      @utility content-auto {
        opacity: 0.75;
      }`
    const style = await resolve(css, 'content-auto')
    expect(style.opacity).toBe(0.75)
  })

  it('supports multi-property static @utility', async () => {
    const css = `@import "tailwindcss";
      @utility box-soft {
        padding: 12px;
        opacity: 0.8;
      }`
    const style = await resolve(css, 'box-soft')
    expect(style.padding).toBe(12)
    expect(style.opacity).toBe(0.8)
  })
})

describe('user @utility — functional with --value(integer)', () => {
  it('accepts a number suffix and substitutes it into the body', async () => {
    const css = `@import "tailwindcss";
      @utility fancy-* {
        margin: calc(var(--spacing) * --value(integer));
      }`
    // --spacing defaults to 0.25rem = 4px, so fancy-4 → 4 * 4 = 16.
    const style = await resolve(css, 'fancy-4')
    expect(style.margin).toBe(16)
  })

  it('produces different values for different suffixes', async () => {
    const css = `@import "tailwindcss";
      @utility fancy-* {
        padding: calc(var(--spacing) * --value(integer));
      }`
    const styleTwo = await resolve(css, 'fancy-2')
    const styleEight = await resolve(css, 'fancy-8')
    expect(styleTwo.padding).toBe(8)
    expect(styleEight.padding).toBe(32)
  })
})

describe('user @utility — functional with --value([*]) arbitrary', () => {
  it('accepts bracketed px arbitrary values', async () => {
    const css = `@import "tailwindcss";
      @utility custom-* {
        padding: --value([*]);
      }`
    const style = await resolve(css, 'custom-[12px]')
    expect(style.padding).toBe(12)
  })

  it('accepts bracketed rem arbitrary values', async () => {
    const css = `@import "tailwindcss";
      @utility custom-* {
        padding: --value([*]);
      }`
    const style = await resolve(css, 'custom-[1.5rem]')
    expect(style.padding).toBe(24)
  })
})
