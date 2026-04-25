import { beforeAll, describe, expect, it } from 'bun:test'
import { TailwindParser, type RNStyle } from '../../../src/core/parser'

/**
 * Regression bundle for percentage/fraction values across the transform
 * family. Tailwind v4 emits `--tw-*` custom props with `%` values for
 * scale / translate / fractional utilities, plus `calc(...)` wrappers
 * for negative / fractional forms. Each family has its own resolver in
 * `composeTransformFromVars`; verify they all land the right RN ops.
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

describe('scale — percentages flow through the composed-transform pass', () => {
  it('scale-50 → transform: [{scaleX: 0.5}, {scaleY: 0.5}]', async () => {
    const style = await styleFor('scale-50')
    expect(style?.transform).toEqual([{ scaleX: 0.5 }, { scaleY: 0.5 }])
  })

  it('scale-100 → transform: [{scaleX: 1}, {scaleY: 1}]', async () => {
    const style = await styleFor('scale-100')
    expect(style?.transform).toEqual([{ scaleX: 1 }, { scaleY: 1 }])
  })

  it('scale-150 → transform: [{scaleX: 1.5}, {scaleY: 1.5}]', async () => {
    const style = await styleFor('scale-150')
    expect(style?.transform).toEqual([{ scaleX: 1.5 }, { scaleY: 1.5 }])
  })

  it('scale-0 → transform: [{scaleX: 0}, {scaleY: 0}]', async () => {
    const style = await styleFor('scale-0')
    expect(style?.transform).toEqual([{ scaleX: 0 }, { scaleY: 0 }])
  })

  it('scale-x-75 → transform: [{scaleX: 0.75}]', async () => {
    const style = await styleFor('scale-x-75')
    expect(style?.transform).toEqual([{ scaleX: 0.75 }])
  })

  it('scale-y-125 → transform: [{scaleY: 1.25}]', async () => {
    const style = await styleFor('scale-y-125')
    expect(style?.transform).toEqual([{ scaleY: 1.25 }])
  })
})

describe('skew — negative forms via calc() unwrap correctly', () => {
  it('skew-x-12 → transform: [{skewX: "12deg"}]', async () => {
    const style = await styleFor('skew-x-12')
    const transform = style?.transform as readonly Record<string, string>[] | undefined
    expect(transform?.some((op) => op.skewX === '12deg')).toBe(true)
  })

  it('-skew-x-6 → transform includes a negative skewX angle', async () => {
    const style = await styleFor('-skew-x-6')
    const transform = style?.transform as readonly Record<string, string>[] | undefined
    expect(transform?.some((op) => op.skewX === '-6deg')).toBe(true)
  })

  it('-skew-y-3 → transform includes a negative skewY angle', async () => {
    const style = await styleFor('-skew-y-3')
    const transform = style?.transform as readonly Record<string, string>[] | undefined
    expect(transform?.some((op) => op.skewY === '-3deg')).toBe(true)
  })
})

describe('rotate — direct `rotate` shorthand resolves to transform', () => {
  it('rotate-45 → transform contains rotate: "45deg"', async () => {
    const style = await styleFor('rotate-45')
    const transform = style?.transform as readonly Record<string, string>[] | undefined
    expect(transform?.some((op) => op.rotate === '45deg')).toBe(true)
  })

  it('-rotate-45 → transform contains rotate: "-45deg"', async () => {
    const style = await styleFor('-rotate-45')
    const transform = style?.transform as readonly Record<string, string>[] | undefined
    expect(transform?.some((op) => op.rotate === '-45deg')).toBe(true)
  })
})

describe('opacity — percent utilities land on `opacity` as a 0..1 number', () => {
  it('opacity-50 → opacity: 0.5', async () => {
    const style = await styleFor('opacity-50')
    expect(style?.opacity).toBeCloseTo(0.5, 4)
  })

  it('opacity-0 → opacity: 0', async () => {
    const style = await styleFor('opacity-0')
    expect(style?.opacity).toBe(0)
  })

  it('opacity-100 → opacity: 1', async () => {
    const style = await styleFor('opacity-100')
    expect(style?.opacity).toBe(1)
  })

  it('opacity-25 → opacity: 0.25', async () => {
    const style = await styleFor('opacity-25')
    expect(style?.opacity).toBeCloseTo(0.25, 4)
  })
})
