import { beforeAll, describe, expect, it } from 'bun:test'
import { TailwindParser, type RNStyle } from '../../../src/core/parser'

/**
 * Regression coverage for correctness bugs surfaced in the full-codebase
 * review — each produced an RN-invalid or silently-dropped style value.
 */
let parser: TailwindParser

beforeAll(async () => {
  parser = new TailwindParser({ themeCss: `@import 'tailwindcss';` })
  await parser.parseAtoms({ content: '<V className="flex-1" />', extension: 'tsx' })
})

/**
 * Resolve one class to its base-scheme RN style.
 * @param cls Single utility class.
 * @returns Base-scheme RN style, or undefined.
 */
async function style(cls: string): Promise<RNStyle | undefined> {
  const out = await parser.parseAtoms({ content: `<V className="${cls}" />`, extension: 'tsx' })
  const [scheme] = out.schemes
  return scheme ? out.atoms.get(cls)?.[scheme] : undefined
}

describe('text-align — logical start/end must lower to physical (RN has no logical textAlign)', () => {
  it('text-start → left, text-end → right', async () => {
    expect(await style('text-start')).toEqual({ textAlign: 'left' })
    expect(await style('text-end')).toEqual({ textAlign: 'right' })
  })

  it('physical / center / justify pass through unchanged', async () => {
    expect(await style('text-center')).toEqual({ textAlign: 'center' })
    expect(await style('text-right')).toEqual({ textAlign: 'right' })
    expect(await style('text-justify')).toEqual({ textAlign: 'justify' })
  })
})

describe('overflow per-axis — overflow-x-* / overflow-y-* must map to RN single `overflow`', () => {
  it('overflow-x-scroll and overflow-y-hidden resolve (not silently dropped)', async () => {
    expect(await style('overflow-x-scroll')).toEqual({ overflow: 'scroll' })
    expect(await style('overflow-y-hidden')).toEqual({ overflow: 'hidden' })
  })

  it('plain overflow-hidden still works', async () => {
    expect(await style('overflow-hidden')).toEqual({ overflow: 'hidden' })
  })
})

describe('wide-gamut color() — must convert to sRGB, not pass channels through as-is', () => {
  it('color(srgb-linear …) applies the gamma transfer', async () => {
    // Naive (channel*255) would give #808080; correct sRGB is #bcbcbc.
    expect(await style('bg-[color(srgb-linear_0.5_0.5_0.5)]')).toEqual({ backgroundColor: '#bcbcbc' })
  })

  it('color(display-p3 …) converts the gamut', async () => {
    expect(await style('text-[color(display-p3_0.5_0.2_0.7)]')).toEqual({ color: '#8a2cb9' })
  })

  it('color(rec2020 …) converts the gamut', async () => {
    expect(await style('bg-[color(rec2020_0.9_0.1_0.1)]')).toEqual({ backgroundColor: '#ff0016' })
  })

  it('plain srgb color() still passes through linearly', async () => {
    expect(await style('bg-[color(srgb_1_0_0)]')).toEqual({ backgroundColor: '#ff0000' })
  })
})

describe('shadow length scan — a <4-length shadow must not steal digits from the color', () => {
  it('3-length shadow with rgba color keeps the alpha as shadowOpacity', async () => {
    const s = await style('shadow-[0_1px_1px_rgb(0_0_0/0.05)]')
    expect(s?.shadowColor).toBe('#000000')
    // ~0.051 — alpha is quantised to 8-bit (13/255); the point is it's the
    // shadow's real alpha, not 1 (the pre-fix digit-theft result).
    expect(s?.shadowOpacity).toBeCloseTo(0.05, 2)
    expect(s?.shadowOffset).toEqual({ width: 0, height: 1 })
    expect(s?.shadowRadius).toBe(1)
  })

  it('3-length shadow with a hex color does not corrupt the color string', async () => {
    const s = await style('shadow-[0_1px_1px_#0a0a0a]')
    expect(s?.shadowColor).toBe('#0a0a0a')
  })

  it('4-length shadow (the common shape) still parses correctly', async () => {
    const s = await style('shadow-[0_1px_3px_0_rgb(0_0_0/0.1)]')
    expect(s?.shadowOpacity).toBeCloseTo(0.1, 2)
    expect(s?.shadowRadius).toBe(3)
  })
})
