import { beforeAll, describe, expect, it } from 'bun:test'
import { TailwindParser, type RNStyle } from '../../../src/core/parser'

/**
 * BUG 1 (crash): `shadow-[0_2px_4px_rgb(0_0_0/none)]` parsed the CSS `none`
 * alpha keyword as `Number('none') === NaN`, which landed on
 * `style.shadowOpacity`. React Native throws on a NaN numeric style prop.
 * The fix maps a non-finite parsed alpha to CSS `none`'s used value (0) so
 * NO NaN can ever reach a numeric style value.
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

describe('arbitrary shadow with rgb(... / none) alpha never yields NaN', () => {
  it('shadow-[0_2px_4px_rgb(0_0_0/none)] resolves a finite shadowOpacity', async () => {
    const s = await styleOf('shadow-[0_2px_4px_rgb(0_0_0/none)]')
    expect(s).toBeDefined()
    expect(Number.isFinite(s?.shadowOpacity)).toBe(true)
    // CSS `none` alpha used value is 0 (fully transparent shadow).
    expect(s?.shadowOpacity).toBe(0)
  })

  it('shadow-[0_2px_4px_rgba(0,0,0,none)] (comma form) is also finite', async () => {
    const s = await styleOf('shadow-[0_2px_4px_rgba(0,0,0,none)]')
    expect(Number.isFinite(s?.shadowOpacity)).toBe(true)
  })

  it('a normal numeric alpha still produces a finite opacity', async () => {
    const s = await styleOf('shadow-[0_2px_4px_rgb(0_0_0/0.25)]')
    expect(Number.isFinite(s?.shadowOpacity)).toBe(true)
    expect(s?.shadowOpacity).toBeGreaterThan(0)
  })
})
