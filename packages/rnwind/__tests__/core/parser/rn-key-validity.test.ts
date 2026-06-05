import { beforeAll, describe, expect, it } from 'bun:test'
import { TailwindParser, type RNStyle } from '../../../src/core/parser'

/**
 * Regression: utilities must never emit a React Native style KEY or VALUE
 * that RN can't render. The generic `kebabToCamel` fallback used to pass any
 * CSS property through (`objectPosition`, `textWrap`, `willChange`, …) and
 * leak unresolved `var(--tw-*)` mid-string (`filter`/`transform`/`backdrop`).
 * Display/overflow typed paths also emitted RN-invalid enum values. Each row
 * pins the corrected output.
 */
const DEFAULT_THEME = `@import "tailwindcss";`
let parser: TailwindParser

beforeAll(async () => {
  parser = new TailwindParser({ themeCss: DEFAULT_THEME })
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

describe('display lowers to RN-valid values only', () => {
  const cases: ReadonlyArray<readonly [string, RNStyle]> = [
    ['flex', { display: 'flex' }],
    ['hidden', { display: 'none' }],
    ['block', {}],
    ['inline', {}],
    ['inline-block', {}],
    ['grid', {}],
  ]
  for (const [cls, expected] of cases) {
    it(`${cls} → ${JSON.stringify(expected)}`, async () => {
      expect(await styleOf(cls)).toEqual(expected)
    })
  }
})

describe('overflow maps to RN-valid keywords (visible/hidden/scroll)', () => {
  const cases: ReadonlyArray<readonly [string, RNStyle]> = [
    ['overflow-auto', { overflow: 'scroll' }],
    ['overflow-x-auto', { overflow: 'scroll' }],
    ['overflow-y-auto', { overflow: 'scroll' }],
    ['overflow-clip', { overflow: 'hidden' }],
    ['overflow-x-clip', { overflow: 'hidden' }],
    ['overflow-hidden', { overflow: 'hidden' }],
    ['overflow-scroll', { overflow: 'scroll' }],
    ['overflow-visible', { overflow: 'visible' }],
  ]
  for (const [cls, expected] of cases) {
    it(`${cls} → ${JSON.stringify(expected)}`, async () => {
      expect(await styleOf(cls)).toEqual(expected)
    })
  }
})

describe('utilities that leak var(--tw-*) or have no RN key are dropped', () => {
  // filter/backdrop/3D-transform/scroll-snap carry unresolved composables.
  const leaky = ['blur-sm', 'blur-md', 'backdrop-blur', 'rotate-x-45', 'snap-x', 'touch-pan-x']
  // Web-only properties with no RN style equivalent.
  const webOnly = ['text-nowrap', 'will-change-transform', 'columns-2', 'float-left', 'object-top', 'overscroll-contain']

  for (const cls of [...leaky, ...webOnly]) {
    it(`${cls} → {} (no garbage key/value)`, async () => {
      expect(await styleOf(cls)).toEqual({})
    })
  }
})
