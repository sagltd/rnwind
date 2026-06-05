import { beforeAll, describe, expect, it } from 'bun:test'
import { TailwindParser, type RNStyle } from '../../../src/core/parser'

/**
 * Regressions in the transform-composition + keyframe paths:
 *  1. Arbitrary/decimal scale & translate leaked f32 noise (`scale-[1.7]` →
 *     `1.7000000476837158`).
 *  2. Negative scale utilities dropped (`-scale-x-100` → `{}`) — the resolver
 *     had no `calc(100% * -1)` handling, unlike skew/translate.
 *  3. Multi-selector keyframe steps (`0%, 100% { … }`) dropped every offset
 *     but the first, so looping animations lost their terminal frame.
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

describe('transform composition — clean numbers, negative scale', () => {
  const cases: ReadonlyArray<readonly [string, RNStyle]> = [
    ['scale-[1.7]', { transform: [{ scaleX: 1.7 }, { scaleY: 1.7 }] }],
    ['scale-x-[0.333]', { transform: [{ scaleX: 0.333 }] }],
    ['translate-x-[1.7rem]', { transform: [{ translateX: 27.2 }] }],
    ['translate-x-[3.3px]', { transform: [{ translateX: 3.3 }] }],
    ['-scale-x-100', { transform: [{ scaleX: -1 }] }],
    ['-scale-100', { transform: [{ scaleX: -1 }, { scaleY: -1 }] }],
    ['-scale-y-50', { transform: [{ scaleY: -0.5 }] }],
    // No-regression on positive / integer / percent translate.
    ['scale-x-100', { transform: [{ scaleX: 1 }] }],
    ['translate-x-4', { transform: [{ translateX: 16 }] }],
    ['translate-x-1/2', { transform: [{ translateX: '50%' }] }],
  ]
  for (const [cls, expected] of cases) {
    it(`${cls} → ${JSON.stringify(expected)}`, async () => {
      expect(await styleOf(cls)).toEqual(expected)
    })
  }
})

/**
 * Collect the offsets of a class's first keyframe block.
 * @param cls Animate utility.
 * @returns Offsets in declaration order, or undefined.
 */
async function offsetsOf(cls: string): Promise<readonly string[] | undefined> {
  const r = await parser.parseAtoms({ content: `<V className="${cls}" />`, extension: 'tsx' })
  const [first] = [...r.keyframes.values()]
  return first?.steps.map((s) => s.offset)
}

describe('keyframes — multi-selector frames keep every offset', () => {
  it('animate-ping keeps its terminal 100% frame', async () => {
    const offsets = await offsetsOf('animate-ping')
    expect(offsets).toContain('75%')
    expect(offsets).toContain('100%')
  })

  it('animate-bounce keeps both the shared 0%/100% and the 50% frame', async () => {
    const offsets = await offsetsOf('animate-bounce')
    expect(offsets).toContain('0%')
    expect(offsets).toContain('100%')
    expect(offsets).toContain('50%')
  })
})
