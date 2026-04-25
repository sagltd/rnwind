import { beforeAll, describe, expect, it } from 'bun:test'
import { TailwindParser, type RNStyle } from '../../../src/core/parser'

/**
 * Regression coverage for percentage-valued `translate-*` utilities. The
 * composed-transform post-pass used to drop `--tw-translate-x/y: 100%`
 * on the floor (its length resolver only understood px / rem / calc),
 * so `translate-x-full` never produced a `transform` array and
 * `translate-y-full` returned an empty style. Real-world RN accepts
 * percentage strings in `transform: [{ translateX: '100%' }]` so the
 * parser has to preserve the `%` token all the way through.
 */

let parser: TailwindParser

beforeAll(async () => {
  parser = new TailwindParser({ themeCss: `@import "tailwindcss";` })
  await parser.parseAtoms({ content: '<V className="flex-1" />', extension: 'tsx' })
})

/**
 * Parse one utility against the default Tailwind theme and return its
 * base-scheme RN style.
 * @param className Bare Tailwind class.
 * @returns Base-scheme RN style, or `undefined` when the class didn't surface.
 */
async function styleFor(className: string): Promise<RNStyle | undefined> {
  const result = await parser.parseAtoms({ content: `<V className="${className}" />`, extension: 'tsx' })
  const [scheme] = result.schemes
  if (!scheme) return undefined
  return result.atoms.get(className)?.[scheme]
}

describe('percentage translate utilities', () => {
  it('translate-x-full → transform: [{translateX: "100%"}]', async () => {
    const style = await styleFor('translate-x-full')
    expect(style?.transform).toEqual([{ translateX: '100%' }])
  })

  it('translate-y-full → transform: [{translateY: "100%"}]', async () => {
    const style = await styleFor('translate-y-full')
    expect(style?.transform).toEqual([{ translateY: '100%' }])
  })

  it('-translate-x-full → transform: [{translateX: "-100%"}]', async () => {
    const style = await styleFor('-translate-x-full')
    expect(style?.transform).toEqual([{ translateX: '-100%' }])
  })

  it('-translate-y-full → transform: [{translateY: "-100%"}]', async () => {
    const style = await styleFor('-translate-y-full')
    expect(style?.transform).toEqual([{ translateY: '-100%' }])
  })

  it('translate-x-1/2 → transform: [{translateX: "50%"}]', async () => {
    const style = await styleFor('translate-x-1/2')
    expect(style?.transform).toEqual([{ translateX: '50%' }])
  })

  it('translate-y-1/4 → transform: [{translateY: "25%"}]', async () => {
    const style = await styleFor('translate-y-1/4')
    const transform = style?.transform as readonly Record<string, string>[] | undefined
    expect(transform?.[0]?.translateY).toMatch(/^25%$/)
  })

  it('pixel translate still resolves to a number — regression', async () => {
    const style = await styleFor('translate-x-52')
    expect(style?.transform).toEqual([{ translateX: 208 }])
  })
})
