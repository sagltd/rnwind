import { beforeAll, describe, expect, it } from 'bun:test'
import { TailwindParser, type RNStyle } from '../../src/core/parser'

const DEFAULT_THEME = `@import "tailwindcss";`

/**
 * Shared parser instance — one Tailwind compile is expensive enough (~500ms
 * first call) that every test paying it individually would make the suite
 * ~30s. Theme CSS is fixed; tests that need a custom theme build their own.
 */
let parser: TailwindParser

beforeAll(async () => {
  parser = new TailwindParser({ themeCss: DEFAULT_THEME })
  // Warm the compiler cache so the first real assertion doesn't pay the cost.
  await parser.parseAtoms({ content: '<V className="flex-1" />', extension: 'tsx' })
})

/**
 * Parse one JSX-ish source and return atoms as base-scheme RN styles —
 * the shape every existing test was written against. The parser now
 * returns per-scheme maps; this helper flattens to the base scheme so
 * test bodies stay concise.
 * @param content Source content for oxide to scan.
 * @returns Map of className to its base-scheme RN style.
 */
async function parse(content: string): Promise<Map<string, RNStyle>> {
  const result = await parser.parseAtoms({ content, extension: 'tsx' })
  const flat = new Map<string, RNStyle>()
  const [firstScheme] = result.schemes
  if (!firstScheme) return flat
  for (const [className, schemed] of result.atoms) {
    const style = schemed[firstScheme]
    if (style) flat.set(className, style)
  }
  return flat
}

describe('TailwindParser — atom → RN style', () => {
  describe('flex shorthand', () => {
    it('collapses `flex-1` to the single `{flex: 1}` entry RN accepts', async () => {
      const atoms = await parse('<V className="flex-1" />')
      expect(atoms.get('flex-1')).toEqual({ flex: 1 })
    })

    it('emits numeric flex-grow / flex-shrink for non-unit flex utilities', async () => {
      const atoms = await parse('<V className="grow-0 shrink-0" />')
      expect(atoms.get('grow-0')).toEqual({ flexGrow: 0 })
      expect(atoms.get('shrink-0')).toEqual({ flexShrink: 0 })
    })
  })

  describe('spacing utilities — padding / margin', () => {
    it('converts `p-4` rem value to pixels and collapses the four-sided shorthand', async () => {
      const atoms = await parse('<V className="p-4" />')
      expect(atoms.get('p-4')).toEqual({ padding: 16 })
    })

    it('`m-2` collapses to a single `{margin: 8}`', async () => {
      const atoms = await parse('<V className="m-2" />')
      expect(atoms.get('m-2')).toEqual({ margin: 8 })
    })

    it('per-side utilities `pt-4` / `mb-8` map to RN longhand keys', async () => {
      const atoms = await parse('<V className="pt-4 mb-8" />')
      expect(atoms.get('pt-4')).toEqual({ paddingTop: 16 })
      expect(atoms.get('mb-8')).toEqual({ marginBottom: 32 })
    })

    it('axis utilities `px-2 py-4` expand to both sides on that axis', async () => {
      const atoms = await parse('<V className="px-2 py-4" />')
      expect(atoms.get('px-2')).toEqual({ paddingLeft: 8, paddingRight: 8 })
      expect(atoms.get('py-4')).toEqual({ paddingBottom: 16, paddingTop: 16 })
    })
  })

  describe('border-radius', () => {
    it('`rounded-lg` collapses four equal corners to `{borderRadius: 8}`', async () => {
      const atoms = await parse('<V className="rounded-lg" />')
      expect(atoms.get('rounded-lg')).toEqual({ borderRadius: 8 })
    })

    it('`rounded-t-lg` emits per-corner longhands', async () => {
      const atoms = await parse('<V className="rounded-t-lg" />')
      const style = atoms.get('rounded-t-lg')
      expect(style?.borderTopLeftRadius).toBe(8)
      expect(style?.borderTopRightRadius).toBe(8)
    })
  })

  describe('colors', () => {
    it('lowers Tailwind oklch palette colors to sRGB hex via culori', async () => {
      const atoms = await parse('<V className="bg-red-500 text-white" />')
      expect(atoms.get('bg-red-500')).toEqual({ backgroundColor: '#fb2c36' })
      expect(atoms.get('text-white')).toEqual({ color: '#ffffff' })
    })

    it('handles `bg-transparent` as the CSS `transparent` keyword', async () => {
      const atoms = await parse('<V className="bg-transparent" />')
      // `transparent` is serialized as rgba(0,0,0,0) by Tailwind → our converter
      // emits a zero-alpha rgba color (web-safe + RN-safe).
      const style = atoms.get('bg-transparent')
      expect(style).toBeDefined()
      expect(typeof style!.backgroundColor).toBe('string')
    })

    it('opacity numeric utility maps to `opacity` float in [0, 1]', async () => {
      const atoms = await parse('<V className="opacity-50" />')
      expect(atoms.get('opacity-50')).toEqual({ opacity: 0.5 })
    })
  })

  describe('display + position enums', () => {
    it('`flex` / `hidden` emit the RN display keyword', async () => {
      const atoms = await parse('<V className="flex hidden" />')
      expect(atoms.get('flex')).toEqual({ display: 'flex' })
      expect(atoms.get('hidden')).toEqual({ display: 'none' })
    })

    it('`absolute` / `relative` map to the position enum string', async () => {
      const atoms = await parse('<V className="absolute relative" />')
      expect(atoms.get('absolute')).toEqual({ position: 'absolute' })
      expect(atoms.get('relative')).toEqual({ position: 'relative' })
    })
  })

  describe('typography', () => {
    it('`text-lg` emits a numeric fontSize (1.125rem → 18)', async () => {
      const atoms = await parse('<V className="text-lg" />')
      const style = atoms.get('text-lg')
      expect(style?.fontSize).toBe(18)
    })

    it('`font-bold` maps to numeric fontWeight 700', async () => {
      const atoms = await parse('<V className="font-bold" />')
      expect(atoms.get('font-bold')).toEqual({ fontWeight: 700 })
    })

    it('`font-normal` maps to numeric fontWeight 400', async () => {
      const atoms = await parse('<V className="font-normal" />')
      expect(atoms.get('font-normal')).toEqual({ fontWeight: 400 })
    })
  })

  describe('unknown / unsupported utilities', () => {
    it("returns an empty map entry for a class Tailwind can't resolve (not in candidates)", async () => {
      const atoms = await parse('<V className="definitely-not-tailwind" />')
      expect(atoms.has('definitely-not-tailwind')).toBe(false)
    })

    it('skips at-rule-only selectors (no class selector attached)', async () => {
      // @keyframes and @property rules shouldn't leak into the atoms map.
      const result = await parser.parseAtoms({ content: '<V className="animate-spin" />', extension: 'tsx' })
      expect(result.atoms.has('animate-spin')).toBe(true)
      expect(result.keyframes.size).toBeGreaterThan(0)
    })
  })

  describe('@keyframes extraction', () => {
    it('surfaces `@keyframes spin` when `animate-spin` is requested', async () => {
      const result = await parser.parseAtoms({ content: '<V className="animate-spin" />', extension: 'tsx' })
      const spin = result.keyframes.get('spin')
      expect(spin).toBeDefined()
      expect(spin!.steps.length).toBeGreaterThan(0)
    })
  })

  describe('empty input', () => {
    it('returns empty atoms when the file contains no Tailwind-resolvable tokens', async () => {
      // oxide treats every ident as a candidate — `const` and `x` surface in
      // `result.candidates` even though Tailwind resolves neither. The atoms
      // map stays empty because none match a real utility.
      const result = await parser.parseAtoms({ content: 'const x = 1', extension: 'ts' })
      expect(result.atoms.size).toBe(0)
      expect(result.keyframes.size).toBe(0)
    })

    it('returns the empty sentinel for a truly empty source (no oxide candidates at all)', async () => {
      const result = await parser.parseAtoms({ content: '', extension: 'tsx' })
      expect(result.candidates).toEqual([])
      expect(result.atoms.size).toBe(0)
    })
  })

  describe('candidate order + preservation', () => {
    it('preserves oxide candidate order in the `candidates` output', async () => {
      const result = await parser.parseAtoms({
        content: '<V className="p-4 flex-1 bg-red-500" />',
        extension: 'tsx',
      })
      // oxide surfaces every token, including non-utility words. We filter the
      // candidate list to just the real utility classes and check their order.
      const utilities = result.candidates.filter((c) => result.atoms.has(c))
      expect(utilities).toEqual(['p-4', 'flex-1', 'bg-red-500'])
    })
  })
})
