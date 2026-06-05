import { beforeAll, describe, expect, it } from 'bun:test'
import { TailwindParser, type RNStyle } from '../../../src/core/parser'

/**
 * Regression: custom `@theme` color tokens reach the parser as
 * `var(--color-x)` (the default palette is inlined by `theme(inline)`, but
 * user tokens are NOT), so they flow through the UNPARSED path. That path
 * used to (a) emit RN keys RN can't read for logical border-color utilities
 * (`borderInlineColor`, `borderInlineStartColor`, …) and (b) leak raw
 * `oklch(…)` strings RN can't paint. Both silently dropped the border color
 * in a real app — the "border still black" bug. Each row pins the EXACT RN
 * style so the regression can't creep back.
 */
const THEME = `@import "tailwindcss";
@theme {
  --color-brand: #ef4444;
  --color-ok: oklch(0.6 0.2 25);
}`

let parser: TailwindParser

beforeAll(async () => {
  parser = new TailwindParser({ themeCss: THEME })
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

describe('custom-token logical border colors → physical RN keys (hex-normalized)', () => {
  const hexCases: ReadonlyArray<readonly [string, RNStyle]> = [
    // Logical border-color utilities must lower to RN's physical keys.
    ['border-x-brand', { borderLeftColor: '#ef4444', borderRightColor: '#ef4444' }],
    ['border-y-brand', { borderTopColor: '#ef4444', borderBottomColor: '#ef4444' }],
    ['border-s-brand', { borderLeftColor: '#ef4444' }],
    ['border-e-brand', { borderRightColor: '#ef4444' }],
    // Physical sides + all-sides keep working (no regression).
    ['border-t-brand', { borderTopColor: '#ef4444' }],
    ['border-brand', { borderColor: '#ef4444' }],
  ]

  for (const [cls, expected] of hexCases) {
    it(`${cls} → ${JSON.stringify(expected)}`, async () => {
      expect(await styleOf(cls)).toEqual(expected)
    })
  }

  it('oklch custom token is normalized to sRGB hex (RN can read it)', async () => {
    const style = await styleOf('border-ok')
    const value = style?.borderColor
    expect(typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value as string)).toBe(true)
  })

  it('oklch custom token on a logical side is normalized AND physical-keyed', async () => {
    const style = await styleOf('border-s-ok')
    expect(style && 'borderInlineStartColor' in style).toBe(false)
    const value = style?.borderLeftColor
    expect(typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value as string)).toBe(true)
  })
})
