import { beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { TailwindParser, type RNStyle, type SafeAreaMarker } from '../../../src/core/parser'

/**
 * End-to-end detector tests: build a real Tailwind v4 compile of every
 * safe-area utility and assert the parser emits the compact
 * {@link SafeAreaMarker} shape downstream code expects.
 *
 * These tests are the contract for build-side emission (SA 3) and runtime
 * resolution (SA 4) — any change to marker shape must break here first.
 */

const preset = readFileSync(path.resolve(__dirname, '..', '..', '..', 'preset.css'), 'utf8')
const themeCss = `@import "tailwindcss";\n${preset}`

let parser: TailwindParser

beforeAll(() => {
  parser = new TailwindParser({ themeCss })
})

/**
 * Transform one className through the shared parser and return its
 * base-scheme RN style. Keeps the await expression out of later
 * `.propertyAccess` lookups so ESLint's `no-await-expression-member`
 * rule stays happy.
 * @param className Single Tailwind class name.
 * @returns RN style resolved under the first (base) scheme.
 */
async function resolve(className: string): Promise<RNStyle> {
  const result = await parser.parseAtoms({ content: `<V className="${className}" />`, extension: 'tsx' })
  const schemed = result.atoms.get(className)
  if (!schemed) throw new Error(`atom ${className} missing`)
  const [firstScheme] = Object.keys(schemed)
  return schemed[firstScheme!] as RNStyle
}

/**
 * Which key in a screen-height-safe atom holds the marker.
 * @param className Screen-height atom name.
 * @returns The RN style key the marker lives under.
 */
function heightKeyFor(className: string): 'minHeight' | 'maxHeight' | 'height' {
  if (className.startsWith('min-')) return 'minHeight'
  if (className.startsWith('max-')) return 'maxHeight'
  return 'height'
}

describe('safe-area marker — single-side utilities', () => {
  it.each([
    ['pt-safe', 'paddingTop', 't'],
    ['pr-safe', 'paddingRight', 'r'],
    ['pb-safe', 'paddingBottom', 'b'],
    ['pl-safe', 'paddingLeft', 'l'],
    ['mt-safe', 'marginTop', 't'],
    ['mr-safe', 'marginRight', 'r'],
    ['mb-safe', 'marginBottom', 'b'],
    ['ml-safe', 'marginLeft', 'l'],
    ['top-safe', 'top', 't'],
    ['right-safe', 'right', 'r'],
    ['bottom-safe', 'bottom', 'b'],
    ['left-safe', 'left', 'l'],
  ])('%s emits { __safe: "%s" } on %s', async (className, key, side) => {
    const style = await resolve(className)
    expect(style[key]).toEqual({ __safe: side } as SafeAreaMarker)
  })

  it('logical ms-safe uses the left inset', async () => {
    const style = await resolve('ms-safe')
    expect(style.marginInlineStart).toEqual({ __safe: 'l' } as SafeAreaMarker)
  })
  it('logical me-safe uses the right inset', async () => {
    const style = await resolve('me-safe')
    expect(style.marginInlineEnd).toEqual({ __safe: 'r' } as SafeAreaMarker)
  })
  it('start-safe → inset-inline-start from left', async () => {
    const style = await resolve('start-safe')
    expect(style.insetInlineStart).toEqual({ __safe: 'l' } as SafeAreaMarker)
  })
  it('end-safe → inset-inline-end from right', async () => {
    const style = await resolve('end-safe')
    expect(style.insetInlineEnd).toEqual({ __safe: 'r' } as SafeAreaMarker)
  })
})

describe('safe-area marker — shorthands', () => {
  it('p-safe expands into four paddings, one per side', async () => {
    const style = await resolve('p-safe')
    expect(style.paddingTop).toEqual({ __safe: 't' } as SafeAreaMarker)
    expect(style.paddingRight).toEqual({ __safe: 'r' } as SafeAreaMarker)
    expect(style.paddingBottom).toEqual({ __safe: 'b' } as SafeAreaMarker)
    expect(style.paddingLeft).toEqual({ __safe: 'l' } as SafeAreaMarker)
  })

  it('px-safe covers left + right only', async () => {
    const style = await resolve('px-safe')
    expect(style.paddingLeft).toEqual({ __safe: 'l' } as SafeAreaMarker)
    expect(style.paddingRight).toEqual({ __safe: 'r' } as SafeAreaMarker)
    expect(style.paddingTop).toBeUndefined()
  })

  it('inset-safe covers all four edges', async () => {
    const style = await resolve('inset-safe')
    expect(style.top).toEqual({ __safe: 't' } as SafeAreaMarker)
    expect(style.bottom).toEqual({ __safe: 'b' } as SafeAreaMarker)
  })
})

describe('safe-area marker — fallback variant (*-safe-or-n / -or-[n])', () => {
  it('pt-safe-or-4 → or: 16 (spacing × 4 = 1rem = 16px)', async () => {
    const style = await resolve('pt-safe-or-4')
    expect(style.paddingTop).toEqual({ __safe: 't', or: 16 } as SafeAreaMarker)
  })

  it('mt-safe-or-2 → or: 8', async () => {
    const style = await resolve('mt-safe-or-2')
    expect(style.marginTop).toEqual({ __safe: 't', or: 8 } as SafeAreaMarker)
  })

  it('top-safe-or-[2px] → arbitrary px pass-through', async () => {
    const style = await resolve('top-safe-or-[2px]')
    expect(style.top).toEqual({ __safe: 't', or: 2 } as SafeAreaMarker)
  })

  it('pl-safe-or-[1rem] → rem converted to 16 px', async () => {
    const style = await resolve('pl-safe-or-[1rem]')
    expect(style.paddingLeft).toEqual({ __safe: 'l', or: 16 } as SafeAreaMarker)
  })
})

describe('safe-area marker — offset variant (*-safe-offset-n / -offset-[n])', () => {
  it('pt-safe-offset-4 → offset: 16', async () => {
    const style = await resolve('pt-safe-offset-4')
    expect(style.paddingTop).toEqual({ __safe: 't', offset: 16 } as SafeAreaMarker)
  })

  it('top-safe-offset-[2px] → offset: 2', async () => {
    const style = await resolve('top-safe-offset-[2px]')
    expect(style.top).toEqual({ __safe: 't', offset: 2 } as SafeAreaMarker)
  })
})

describe('safe-area marker — screen height variant', () => {
  it.each(['h-screen-safe', 'min-h-screen-safe', 'max-h-screen-safe'])('%s emits screen-minus-y marker', async (className) => {
    const style = await resolve(className)
    expect(style[heightKeyFor(className)]).toEqual({ __safe: 'screen-minus-y' } as SafeAreaMarker)
  })
})
