import { beforeAll, describe, expect, it } from 'bun:test'
import { TailwindParser, type RNStyle } from '../../../src/core/parser'

/**
 * Regression: custom `@theme` color tokens on SVG paint props (`fill-`,
 * `stroke-`) and gradient stops (`from-`/`via-`/`to-`). Both reach the parser
 * as unresolved `var(--color-x)` and used to leak raw `oklch(…)` (paint) or
 * drop the stop entirely (gradient). Pins concrete resolved values.
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
 * Parse one class and return its base-scheme RN style.
 * @param cls Tailwind utility.
 * @returns Base-scheme style, or undefined.
 */
async function styleOf(cls: string): Promise<RNStyle | undefined> {
  const r = await parser.parseAtoms({ content: `<V className="${cls}" />`, extension: 'tsx' })
  const [scheme] = r.schemes
  return scheme ? r.atoms.get(cls)?.[scheme] : undefined
}

/**
 * Parse one class and return its gradient-atom record.
 * @param cls Gradient stop utility.
 * @returns Gradient info, or undefined.
 */
async function gradientOf(cls: string): Promise<unknown> {
  const r = await parser.parseAtoms({ content: `<V className="${cls}" />`, extension: 'tsx' })
  return r.gradientAtoms.get(cls)
}

describe('custom-token SVG paint props', () => {
  it('fill-<hex token> resolves', async () => {
    expect(await styleOf('fill-brand')).toEqual({ fill: '#ef4444' })
  })
  it('fill-<oklch token> lowers to sRGB hex', async () => {
    const style = await styleOf('fill-ok')
    const v = style?.fill as string | undefined
    expect(typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v as string)).toBe(true)
  })
  it('stroke-<oklch token> lowers to sRGB hex', async () => {
    const style = await styleOf('stroke-ok')
    const v = style?.stroke as string | undefined
    expect(typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v as string)).toBe(true)
  })
})

describe('custom-token gradient stops', () => {
  it('from-<token> resolves the stop color', async () => {
    expect(await gradientOf('from-brand')).toEqual({ role: 'from', color: '#ef4444' })
  })
  it('via-<token> resolves the stop color', async () => {
    expect(await gradientOf('via-brand')).toEqual({ role: 'via', color: '#ef4444' })
  })
  it('to-<token> resolves the stop color', async () => {
    expect(await gradientOf('to-brand')).toEqual({ role: 'to', color: '#ef4444' })
  })
  it('from-<oklch token> lowers to sRGB hex', async () => {
    const g = (await gradientOf('from-ok')) as { color?: string } | undefined
    const color = g?.color
    expect(typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color as string)).toBe(true)
  })
})
