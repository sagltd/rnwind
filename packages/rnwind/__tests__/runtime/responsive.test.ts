import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { TailwindParser } from '../../src/core/parser'
import { buildSchemeSources } from '../../src/core/style-builder/build-style'
import {
  __resetLookupCssState,
  activeBreakpointFor,
  getBreakpoints,
  lookupCss,
  registerAtoms,
  registerBreakpoints,
} from '../../src/runtime/lookup-css'
import { ctx } from './_ctx'

const DEFAULT_THEME = `@import "tailwindcss";`

const CUSTOM_THEME = `@import "tailwindcss";
@theme {
  --breakpoint-3xl: 120rem;
}`

let defaultParser: TailwindParser
let customParser: TailwindParser

beforeAll(async () => {
  defaultParser = new TailwindParser({ themeCss: DEFAULT_THEME })
  customParser = new TailwindParser({ themeCss: CUSTOM_THEME })
  // Warm both compilers — first compile is ~500ms, every following test pays a few ms.
  await defaultParser.parseAtoms({ content: '<V className="flex-1" />', extension: 'tsx' })
  await customParser.parseAtoms({ content: '<V className="flex-1" />', extension: 'tsx' })
})

afterEach(() => {
  __resetLookupCssState()
})

describe('parser — @media nested rules', () => {
  it('extracts decls from `md:bg-red-500` (Tailwind v4 nested @media wrapper)', async () => {
    const { atoms, schemes } = await defaultParser.parseAtoms({
      content: '<V className="md:bg-red-500" />',
      extension: 'tsx',
    })
    const baseScheme = schemes[0]!
    const style = atoms.get('md:bg-red-500')?.[baseScheme]
    expect(style).toBeDefined()
    expect(typeof style!.backgroundColor).toBe('string')
  })

  it('responsive variant decls land independently from the unprefixed atom', async () => {
    const { atoms, schemes } = await defaultParser.parseAtoms({
      content: '<V className="bg-blue-500 md:bg-red-500" />',
      extension: 'tsx',
    })
    const baseScheme = schemes[0]!
    const blue = atoms.get('bg-blue-500')?.[baseScheme]
    const red = atoms.get('md:bg-red-500')?.[baseScheme]
    expect(blue?.backgroundColor).toBeDefined()
    expect(red?.backgroundColor).toBeDefined()
    expect(blue?.backgroundColor).not.toEqual(red?.backgroundColor)
  })
})

describe('parser — breakpoints map', () => {
  it('exposes the px threshold for each Tailwind default referenced in the source', async () => {
    const { breakpoints } = await defaultParser.parseAtoms({
      content: '<V className="sm:p-1 md:p-2 lg:p-3 xl:p-4 2xl:p-5" />',
      extension: 'tsx',
    })
    expect(breakpoints.get('sm')).toBe(40 * 16)
    expect(breakpoints.get('md')).toBe(48 * 16)
    expect(breakpoints.get('lg')).toBe(64 * 16)
    expect(breakpoints.get('xl')).toBe(80 * 16)
    expect(breakpoints.get('2xl')).toBe(96 * 16)
  })

  it('only captures breakpoints actually referenced — unused ones stay out of the map', async () => {
    const { breakpoints } = await defaultParser.parseAtoms({
      content: '<V className="md:p-4" />',
      extension: 'tsx',
    })
    expect(breakpoints.get('md')).toBe(48 * 16)
    expect(breakpoints.get('lg')).toBeUndefined()
    expect(breakpoints.get('xl')).toBeUndefined()
  })

  it('captures a user-defined breakpoint (`--breakpoint-3xl: 120rem`)', async () => {
    const { breakpoints } = await customParser.parseAtoms({
      content: '<V className="md:p-2 3xl:p-4" />',
      extension: 'tsx',
    })
    expect(breakpoints.get('3xl')).toBe(120 * 16)
    expect(breakpoints.get('md')).toBe(48 * 16)
  })
})

describe('runtime — atomMatchesBreakpoint via lookupCss', () => {
  it('gates `md:*` atoms on windowWidth — below md threshold, atom is filtered out', () => {
    registerAtoms('common', {
      'bg-blue-500': { backgroundColor: '#3b82f6' },
      'md:bg-red-500': { backgroundColor: '#ef4444' },
    })
    registerBreakpoints({ sm: 640, md: 768, lg: 1024 })
    const hoist = ['bg-blue-500', 'md:bg-red-500'] as const

    const narrow = lookupCss(hoist, ctx('common', { windowWidth: 500 }))
    expect(narrow).toEqual([{ backgroundColor: '#3b82f6' }])
  })

  it('emits the `md:*` atom once `windowWidth >= 768`', () => {
    registerAtoms('common', {
      'bg-blue-500': { backgroundColor: '#3b82f6' },
      'md:bg-red-500': { backgroundColor: '#ef4444' },
    })
    registerBreakpoints({ sm: 640, md: 768, lg: 1024 })
    const hoist = ['bg-blue-500', 'md:bg-red-500'] as const

    const wide = lookupCss(hoist, ctx('common', { windowWidth: 800 }))
    expect(wide).toEqual([{ backgroundColor: '#3b82f6' }, { backgroundColor: '#ef4444' }])
  })

  it('atoms whose prefix is NOT a registered breakpoint pass through unchanged', () => {
    registerAtoms('common', {
      'active:bg-red-500': { backgroundColor: '#ef4444' },
    })
    registerBreakpoints({ sm: 640, md: 768 })
    // active: is interactive-state, not a breakpoint — must NOT be filtered by width.
    const hoist = ['active:bg-red-500'] as const
    const result = lookupCss(hoist, ctx('common', { windowWidth: 0 }), undefined, { active: true })
    expect(result).toEqual([{ backgroundColor: '#ef4444' }])
  })

  it('returns different cached references when crossing a breakpoint threshold', () => {
    registerAtoms('common', {
      a: { padding: 4 },
      'md:a': { padding: 16 },
    })
    registerBreakpoints({ md: 768 })
    const hoist = ['a', 'md:a'] as const

    const narrow1 = lookupCss(hoist, ctx('common', { windowWidth: 600 }))
    const narrow2 = lookupCss(hoist, ctx('common', { windowWidth: 700 }))
    // Same tier (0) → same cached array reference.
    expect(narrow2).toBe(narrow1)

    const wide = lookupCss(hoist, ctx('common', { windowWidth: 900 }))
    // Different tier (1) → different cached array.
    expect(wide).not.toBe(narrow1)
    expect(wide).toEqual([{ padding: 4 }, { padding: 16 }])
  })

  it('empty breakpoints registry → all atoms pass through (no-op gate)', () => {
    registerAtoms('common', { 'md:bg-red-500': { backgroundColor: '#ef4444' } })
    // No registerBreakpoints call — registry is empty.
    const hoist = ['md:bg-red-500'] as const
    expect(lookupCss(hoist, ctx('common', { windowWidth: 0 }))).toEqual([{ backgroundColor: '#ef4444' }])
  })
})

describe('runtime — activeBreakpointFor', () => {
  it('falls back to the smallest registered breakpoint when below all thresholds', () => {
    // Phone-width devices (e.g. 402 dp) sit below Tailwind's smallest
    // default (sm = 640). We name that tier after the smallest registered
    // breakpoint so consumers always see a real breakpoint name —
    // `activeBreakpoint === 'sm'` at 402 reads as "you're in the smallest
    // tier" without forcing every caller to special-case `'base'`.
    registerBreakpoints({ sm: 640, md: 768, lg: 1024 })
    expect(activeBreakpointFor(0)).toBe('sm')
    expect(activeBreakpointFor(402)).toBe('sm')
    expect(activeBreakpointFor(639)).toBe('sm')
  })

  it("returns 'base' only when no breakpoints are registered at all", () => {
    // Empty registry is the bundle-without-rnwind / fresh-test scenario;
    // no real breakpoint name exists to fall back to.
    expect(activeBreakpointFor(0)).toBe('base')
    expect(activeBreakpointFor(2000)).toBe('base')
  })

  it('returns the highest-threshold breakpoint whose min-width is reached', () => {
    registerBreakpoints({ sm: 640, md: 768, lg: 1024, xl: 1280 })
    expect(activeBreakpointFor(640)).toBe('sm')
    expect(activeBreakpointFor(800)).toBe('md')
    expect(activeBreakpointFor(1100)).toBe('lg')
    expect(activeBreakpointFor(2000)).toBe('xl')
  })

  it('user-defined breakpoint shows up in the active resolution', () => {
    registerBreakpoints({ md: 768, '3xl': 1920 })
    expect(activeBreakpointFor(2000)).toBe('3xl')
  })

  it('exposes a sorted snapshot through getBreakpoints', () => {
    registerBreakpoints({ md: 768, sm: 640, lg: 1024 })
    expect(getBreakpoints().map((b) => b.name)).toEqual(['sm', 'md', 'lg'])
  })
})

describe('end-to-end — manifest → registerBreakpoints → runtime filter', () => {
  it('manifest source includes the registerBreakpoints call with the parser breakpoints', async () => {
    const result = await defaultParser.parseAtoms({
      content: '<V className="md:p-4 lg:p-6" />',
      extension: 'tsx',
    })
    const { manifestSource } = buildSchemeSources(
      [...result.atoms.keys()],
      result.atoms,
      new Map(),
      undefined,
      result.breakpoints,
    )
    expect(manifestSource).toContain('registerBreakpoints(')
    expect(manifestSource).toContain('"md": 768')
    expect(manifestSource).toContain('"lg": 1024')
  })

  it('user-defined breakpoint flows from theme → manifest source', async () => {
    const result = await customParser.parseAtoms({
      content: '<V className="3xl:p-4" />',
      extension: 'tsx',
    })
    const { manifestSource } = buildSchemeSources(
      [...result.atoms.keys()],
      result.atoms,
      new Map(),
      undefined,
      result.breakpoints,
    )
    expect(manifestSource).toContain('"3xl": 1920')
  })
})
