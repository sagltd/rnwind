import { beforeAll, describe, expect, it } from 'bun:test'
import { TailwindParser, type RNStyle } from '../../../src/core/parser'

/**
 * Concrete value assertions for utility families that previously dropped to
 * `{}` or mis-mapped — fonts, logical-inline spacing, logical border-radius,
 * text-decoration-style, and viewport units. Unlike the shape-only matrix,
 * each row pins the EXACT RN style so a regression is caught precisely.
 */
let parser: TailwindParser

beforeAll(() => {
  parser = new TailwindParser({ themeCss: `@import 'tailwindcss';\n@theme { --color-x: #112233; --font-display: 'Montserrat', sans-serif; }` })
})

/**
 * Resolve the base-scheme RN style for one class.
 * @param cls Tailwind utility.
 * @returns Base-scheme style, or undefined.
 */
async function styleOf(cls: string): Promise<RNStyle | undefined> {
  const r = await parser.parseAtoms({ content: `export default () => <V className="${cls}" />`, extension: 'tsx' })
  const [scheme] = r.schemes
  return scheme ? r.atoms.get(cls)?.[scheme] : undefined
}

describe('utility coverage — concrete RN values', () => {
  const cases: ReadonlyArray<readonly [string, RNStyle]> = [
    // Typed font-family: concrete face, or system (={}) for an all-generic stack.
    ['font-mono', { fontFamily: 'SFMono-Regular' }],
    ['font-serif', { fontFamily: 'Georgia' }],
    ['font-[Inter]', { fontFamily: 'Inter' }],
    ['font-display', { fontFamily: 'Montserrat' }],
    // Logical-inline spacing → RN start/end Yoga keys.
    ['ms-2', { marginStart: 8 }],
    ['me-3', { marginEnd: 12 }],
    ['ps-2', { paddingStart: 8 }],
    ['pe-4', { paddingEnd: 16 }],
    ['start-2', { start: 8 }],
    ['end-3', { end: 12 }],
    // Logical border-radius → RN corner keys.
    ['rounded-ss-lg', { borderStartStartRadius: 8 }],
    ['rounded-ee-sm', { borderEndEndRadius: 4 }],
    ['rounded-s-lg', { borderStartStartRadius: 8, borderEndStartRadius: 8 }],
    // text-decoration-style (RN-supported subset).
    ['decoration-dashed', { textDecorationStyle: 'dashed' }],
    ['decoration-dotted', { textDecorationStyle: 'dotted' }],
    ['decoration-double', { textDecorationStyle: 'double' }],
    // Viewport units → percentage approximation.
    ['w-screen', { width: '100%' }],
    ['h-screen', { height: '100%' }],
    ['min-h-screen', { minHeight: '100%' }],
    ['w-[50vw]', { width: '50%' }],
    // Physical spacing still correct (no regression).
    ['mx-2', { marginHorizontal: 8 }],
    ['px-4', { paddingHorizontal: 16 }],
  ]

  for (const [cls, expected] of cases) {
    it(`${cls} → ${JSON.stringify(expected)}`, async () => {
      expect(await styleOf(cls)).toEqual(expected)
    })
  }

  it('font-sans (all-generic default stack) → system font (no fontFamily)', async () => {
    expect(await styleOf('font-sans')).toEqual({})
  })

  it('decoration-wavy (no RN equivalent) → dropped', async () => {
    expect(await styleOf('decoration-wavy')).toEqual({})
  })
})
