import { beforeAll, describe, expect, it } from 'bun:test'
import { TailwindParser, type RNStyle } from '../../../src/core/parser'

/**
 * Regressions in arbitrary-value lowering:
 *  - `border-[2px_solid_#000]` compiles to `border-color: 2px solid #000`
 *    (invalid for a color prop) and used to emit `borderColor: "2px solid …"`
 *    — a string RN rejects. Multi-token color values now drop.
 *  - `shadow-[0_2px_4px_red]` (named color) fell to default black/0.1 alpha.
 *  - `tracking-[0.1em]` leaked f32 noise (`1.600000023841858`).
 */
let parser: TailwindParser

beforeAll(async () => {
  parser = new TailwindParser({ themeCss: `@import "tailwindcss";` })
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

describe('arbitrary color values: shorthand drops, real colors keep', () => {
  it('border-[2px_solid_#000] (multi-token shorthand) drops — no invalid string', async () => {
    expect(await styleOf('border-[2px_solid_#000]')).toEqual({})
  })
  it('outline-[2px_solid_red] drops too', async () => {
    expect(await styleOf('outline-[2px_solid_red]')).toEqual({})
  })
  it('border-[#abc] (a real color) still resolves', async () => {
    expect(await styleOf('border-[#abc]')).toEqual({ borderColor: '#aabbcc' })
  })
  it('border-[2px] (a width) still resolves', async () => {
    expect(await styleOf('border-[2px]')).toEqual({ borderWidth: 2 })
  })
})

describe('arbitrary shadow with a named color resolves to that color', () => {
  it('shadow-[0_2px_4px_red] → red at full opacity', async () => {
    const s = await styleOf('shadow-[0_2px_4px_red]')
    expect(s?.shadowColor).toBe('#ff0000')
    expect(s?.shadowOpacity).toBe(1)
  })
})

describe('arbitrary letter-spacing rounds off f32 noise', () => {
  it('tracking-[0.1em] → 1.6 (not 1.600000023841858)', async () => {
    expect(await styleOf('tracking-[0.1em]')).toEqual({ letterSpacing: 1.6 })
  })
})
