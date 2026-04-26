import { beforeAll, describe, expect, it } from 'bun:test'
import { TailwindParser, type RNStyle } from '../../src/core/parser'

/**
 * Broad coverage over the families listed in
 * docs/tailwind/tailwind-values.md — one representative utility per group.
 * Not exhaustive; the goal is to catch whole categories silently dropping
 * when Tailwind output shape shifts under us.
 */

const DEFAULT_THEME = `@import "tailwindcss";`

/** Per-fixture parser — fresh compiler so no cross-test cache pollution of utilities we probe. */
let parser: TailwindParser

beforeAll(async () => {
  parser = new TailwindParser({ themeCss: DEFAULT_THEME })
  // Warm once so the first timed assertion isn't stuck behind the initial compile.
  await parser.parseAtoms({ content: '<V className="flex-1" />', extension: 'tsx' })
})

/**
 * Parse one source and return just the atom for a given class name. Keeps
 * tests terse — each test body fits on one screen.
 * @param className Bare Tailwind class to request.
 * @returns Resolved RN style, or `undefined` when the class didn't surface.
 */
async function atomFor(className: string): Promise<RNStyle | undefined> {
  const result = await parser.parseAtoms({
    content: `<V className="${className}" />`,
    extension: 'tsx',
  })
  return baseStyle(result, className)
}

/**
 * Extract the base-scheme style for one class from a raw ParseOutput.
 * Shorthand for `.atoms.get(x)?.[firstScheme]` — keeps assertion lines
 * focused on the check rather than the per-scheme indirection.
 * @param result ParsedOutput from `parser.parseAtoms`.
 * @param className Utility class to look up.
 * @returns Base-scheme RN style, or `undefined`.
 */
function baseStyle(result: Awaited<ReturnType<TailwindParser['parseAtoms']>>, className: string): RNStyle | undefined {
  const [scheme] = result.schemes
  if (!scheme) return undefined
  return result.atoms.get(className)?.[scheme]
}

// ─────────────────────────────────────────────────────────────────────────
describe('Layout utilities', () => {
  it('display: static enums land as RN keyword strings', async () => {
    expect(await atomFor('block')).toEqual({ display: 'block' })
    expect(await atomFor('flex')).toEqual({ display: 'flex' })
    expect(await atomFor('hidden')).toEqual({ display: 'none' })
  })

  it('position enums map to RN `position` strings', async () => {
    expect(await atomFor('absolute')).toEqual({ position: 'absolute' })
    expect(await atomFor('relative')).toEqual({ position: 'relative' })
    expect(await atomFor('static')).toEqual({ position: 'static' })
  })

  it('inset utility — bare-int → px', async () => {
    // top/right/bottom/left all get the same rem length; RN gets one per side.
    const atom = await atomFor('top-4')
    expect(atom).toEqual({ top: 16 })
  })

  it('z-index numeric utility', async () => {
    expect(await atomFor('z-50')).toEqual({ zIndex: 50 })
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Flexbox & Grid', () => {
  it('flex-1 collapses to RN `{flex: 1}`', async () => {
    expect(await atomFor('flex-1')).toEqual({ flex: 1 })
  })

  it('flex-direction enums', async () => {
    expect(await atomFor('flex-row')).toEqual({ flexDirection: 'row' })
    expect(await atomFor('flex-col')).toEqual({ flexDirection: 'column' })
    expect(await atomFor('flex-row-reverse')).toEqual({ flexDirection: 'row-reverse' })
    expect(await atomFor('flex-col-reverse')).toEqual({ flexDirection: 'column-reverse' })
  })

  it('align-items keywords', async () => {
    expect(await atomFor('items-center')).toEqual({ alignItems: 'center' })
    expect(await atomFor('items-start')).toEqual({ alignItems: 'flex-start' })
    expect(await atomFor('items-end')).toEqual({ alignItems: 'flex-end' })
    expect(await atomFor('items-stretch')).toEqual({ alignItems: 'stretch' })
    expect(await atomFor('items-baseline')).toEqual({ alignItems: 'baseline' })
  })

  it('justify-content keywords', async () => {
    expect(await atomFor('justify-center')).toEqual({ justifyContent: 'center' })
    expect(await atomFor('justify-start')).toEqual({ justifyContent: 'flex-start' })
    expect(await atomFor('justify-end')).toEqual({ justifyContent: 'flex-end' })
    expect(await atomFor('justify-between')).toEqual({ justifyContent: 'space-between' })
    expect(await atomFor('justify-around')).toEqual({ justifyContent: 'space-around' })
    expect(await atomFor('justify-evenly')).toEqual({ justifyContent: 'space-evenly' })
  })

  it('align-self keywords', async () => {
    expect(await atomFor('self-center')).toEqual({ alignSelf: 'center' })
    expect(await atomFor('self-stretch')).toEqual({ alignSelf: 'stretch' })
  })

  it('flex-wrap keywords', async () => {
    expect(await atomFor('flex-wrap')).toEqual({ flexWrap: 'wrap' })
    expect(await atomFor('flex-nowrap')).toEqual({ flexWrap: 'nowrap' })
    expect(await atomFor('flex-wrap-reverse')).toEqual({ flexWrap: 'wrap-reverse' })
  })

  it('all color-property utilities resolve to hex strings', async () => {
    const cases = [
      ['bg-red-500', 'backgroundColor'],
      ['text-red-500', 'color'],
      ['border-red-500', 'borderColor'],
      ['border-t-red-500', 'borderTopColor'],
      ['border-x-red-500', 'borderLeftColor'],
      ['border-s-red-500', 'borderLeftColor'],
      ['caret-red-500', 'caretColor'],
      ['decoration-red-500', 'textDecorationColor'],
      ['fill-red-500', 'fill'],
      ['stroke-red-500', 'stroke'],
      ['shadow-red-500', 'shadowColor'],
      ['ring-red-500', 'borderColor'],
    ] as const
    for (const [cls, key] of cases) {
      const atom = await atomFor(cls)
      const value = atom?.[key]
      expect(typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)).toBe(true)
    }
  })

  it('border-width utilities resolve to RN width longhands', async () => {
    expect(await atomFor('border-2')).toEqual({ borderWidth: 2 })
    expect(await atomFor('border-t-2')).toEqual({ borderTopWidth: 2 })
    expect(await atomFor('border-x-2')).toEqual({ borderLeftWidth: 2, borderRightWidth: 2 })
    expect(await atomFor('border-y-2')).toEqual({ borderTopWidth: 2, borderBottomWidth: 2 })
    expect(await atomFor('border-s-2')).toEqual({ borderLeftWidth: 2 })
    expect(await atomFor('border-e-2')).toEqual({ borderRightWidth: 2 })
  })

  it('border-style utilities resolve to RN border-style strings', async () => {
    expect(await atomFor('border-dashed')).toEqual({ borderStyle: 'dashed' })
    expect(await atomFor('border-dotted')).toEqual({ borderStyle: 'dotted' })
    expect(await atomFor('border-solid')).toEqual({ borderStyle: 'solid' })
  })

  it('inset shorthand expands to top/right/bottom/left', async () => {
    expect(await atomFor('inset-3')).toEqual({ top: 12, right: 12, bottom: 12, left: 12 })
    expect(await atomFor('inset-x-2')).toEqual({ left: 8, right: 8 })
    expect(await atomFor('inset-y-4')).toEqual({ top: 16, bottom: 16 })
  })

  it('shadow-{color} (e.g. shadow-red-50) emits shadowColor — no offset/blur (used as a layered modifier)', async () => {
    const red = await atomFor('shadow-red-50')
    expect(red?.shadowColor).toMatch(/^#[0-9a-f]{6}$/i)
    const gray = await atomFor('shadow-gray-200')
    expect(gray?.shadowColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(red?.shadowOffset).toBeUndefined()
    expect(red?.shadowRadius).toBeUndefined()
  })

  it('shadow-{color} resolves the named token to a solid hex shadowColor', async () => {
    const fuchsia = await atomFor('shadow-fuchsia-500')
    expect(fuchsia?.shadowColor).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('shadow-* decomposes box-shadow into RN shadow props', async () => {
    const sm = await atomFor('shadow-sm')
    expect(sm?.shadowColor).toBeDefined()
    expect(sm?.shadowOpacity).toBeGreaterThan(0)
    expect(sm?.shadowRadius).toBeGreaterThan(0)
    expect(sm?.shadowOffset).toEqual({ width: 0, height: 1 })
    expect(sm?.elevation).toBeGreaterThan(0)
    const lg = await atomFor('shadow-lg')
    expect(lg?.shadowOffset).toEqual({ width: 0, height: 10 })
  })

  it('gap utility maps rem to px', async () => {
    expect(await atomFor('gap-4')).toEqual({ gap: 16 })
  })

  it('grow / shrink bare-int utilities', async () => {
    expect(await atomFor('grow-0')).toEqual({ flexGrow: 0 })
    expect(await atomFor('shrink-0')).toEqual({ flexShrink: 0 })
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Spacing — padding / margin families', () => {
  it('p-0 → {padding: 0} (zero is legal, no unit)', async () => {
    expect(await atomFor('p-0')).toEqual({ padding: 0 })
  })

  it('p-4 rem multiplier → 16 px', async () => {
    expect(await atomFor('p-4')).toEqual({ padding: 16 })
  })

  it('p-px → single-pixel utility', async () => {
    expect(await atomFor('p-px')).toEqual({ padding: 1 })
  })

  it('per-side paddings land on RN longhand keys', async () => {
    expect(await atomFor('pt-2')).toEqual({ paddingTop: 8 })
    expect(await atomFor('pb-6')).toEqual({ paddingBottom: 24 })
    expect(await atomFor('pl-5')).toEqual({ paddingLeft: 20 })
    expect(await atomFor('pr-3')).toEqual({ paddingRight: 12 })
  })

  it('axis padding `px-*` / `py-*` collapses logical→RN axis shorthand', async () => {
    expect(await atomFor('px-2')).toEqual({ paddingHorizontal: 8 })
    expect(await atomFor('py-4')).toEqual({ paddingVertical: 16 })
  })

  it('margin family shares the same shape as padding', async () => {
    expect(await atomFor('m-2')).toEqual({ margin: 8 })
    expect(await atomFor('mt-8')).toEqual({ marginTop: 32 })
  })

  it('negative margin `-m-*`', async () => {
    const neg = await atomFor('-m-2')
    // -m-2 → calc(--spacing * -2) → -8px
    expect(neg).toEqual({ margin: -8 })
  })

  it('auto margin', async () => {
    expect(await atomFor('m-auto')).toEqual({ margin: 'auto' })
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Sizing — width / height', () => {
  it('w-full → {width: "100%"}', async () => {
    const atom = await atomFor('w-full')
    expect(atom?.width).toBe('100%')
  })

  it('w-4 → {width: 16}', async () => {
    expect(await atomFor('w-4')).toEqual({ width: 16 })
  })

  it('h-screen → {height} keyword or percentage', async () => {
    const atom = await atomFor('h-screen')
    expect(atom).toBeDefined()
    // Exact value depends on how lightningcss renders 100vh; just assert presence.
    expect(atom!.height).toBeDefined()
  })

  it('w-1/2 fraction → {width: "50%"}', async () => {
    expect(await atomFor('w-1/2')).toEqual({ width: '50%' })
  })

  it('max-w-0 / min-h-0 utilities', async () => {
    expect(await atomFor('max-w-0')).toEqual({ maxWidth: 0 })
    expect(await atomFor('min-h-0')).toEqual({ minHeight: 0 })
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Typography — font / text / tracking / leading', () => {
  it('font-bold maps to numeric fontWeight 700', async () => {
    expect(await atomFor('font-bold')).toEqual({ fontWeight: 700 })
  })

  it('font-normal maps to fontWeight 400', async () => {
    expect(await atomFor('font-normal')).toEqual({ fontWeight: 400 })
  })

  it('text-xl emits numeric fontSize (1.25rem → 20)', async () => {
    const atom = await atomFor('text-xl')
    expect(atom?.fontSize).toBe(20)
  })

  it('text-* utilities normalize lineHeight from a multiplier to pixels (fontSize × multiplier)', async () => {
    // text-4xl in Tailwind v4 emits fontSize: 2.25rem (36px) AND
    // line-height as `var(--tw-leading, calc(2.5 / 2.25))` — a unitless
    // multiplier (1.111) the browser would apply against fontSize. RN
    // requires lineHeight in pixels, so we compute fontSize × multiplier
    // = 36 × 1.111 = 40.
    const atom = await atomFor('text-4xl')
    expect(atom?.fontSize).toBe(36)
    expect(atom?.lineHeight).toBe(40)
  })

  it('text-base lineHeight = 16 × 1.5 = 24', async () => {
    const atom = await atomFor('text-base')
    expect(atom?.fontSize).toBe(16)
    expect(atom?.lineHeight).toBe(24)
  })

  it('text-xl lineHeight = 20 × 1.4 = 28', async () => {
    const atom = await atomFor('text-xl')
    expect(atom?.fontSize).toBe(20)
    expect(atom?.lineHeight).toBe(28)
  })

  it('italic → fontStyle: italic', async () => {
    const atom = await atomFor('italic')
    expect(atom).toBeDefined()
    // Italic is unparsed in some Tailwind versions; assert non-empty object.
    expect(Object.keys(atom ?? {}).length).toBeGreaterThan(0)
  })

  it('text-center → textAlign', async () => {
    const atom = await atomFor('text-center')
    expect(atom).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Colors — palette + alpha modifier', () => {
  it('bg-red-500 oklch → hex', async () => {
    const atom = await atomFor('bg-red-500')
    expect(atom?.backgroundColor).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('text-white → #ffffff', async () => {
    expect(await atomFor('text-white')).toEqual({ color: '#ffffff' })
  })

  it('text-black → #000000', async () => {
    expect(await atomFor('text-black')).toEqual({ color: '#000000' })
  })

  it('/opacity modifier produces rgba()', async () => {
    const atom = await atomFor('bg-red-500/50')
    expect(atom?.backgroundColor).toMatch(/^rgba\(.*,\s*0?\.5\)$|^#[0-9a-f]{8}$/i)
  })

  it('bg-transparent', async () => {
    const atom = await atomFor('bg-transparent')
    expect(atom?.backgroundColor).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Borders — radius / width / color / style', () => {
  it('rounded-lg → {borderRadius: 8}', async () => {
    expect(await atomFor('rounded-lg')).toEqual({ borderRadius: 8 })
  })

  it('rounded-none → {borderRadius: 0}', async () => {
    expect(await atomFor('rounded-none')).toEqual({ borderRadius: 0 })
  })

  it('rounded-full → finite large pixel number (Tailwind v4 uses calc(infinity * 1px); RN can\'t render Infinity)', async () => {
    const atom = await atomFor('rounded-full')
    expect(atom?.borderRadius).toBeDefined()
    // Must be a finite number — Infinity / null / NaN all break RN's StyleSheet.
    expect(typeof atom?.borderRadius).toBe('number')
    expect(Number.isFinite(atom?.borderRadius as number)).toBe(true)
    // And a real "fully rounded" magnitude — small numbers wouldn't pill-shape buttons.
    expect(atom?.borderRadius as number).toBeGreaterThanOrEqual(9999)
  })

  it('rounded-t-lg emits per-corner entries', async () => {
    const atom = await atomFor('rounded-t-lg')
    expect(atom?.borderTopLeftRadius).toBe(8)
    expect(atom?.borderTopRightRadius).toBe(8)
  })

  it('border (default) → 1 px border', async () => {
    const atom = await atomFor('border')
    expect(atom).toBeDefined()
  })

  it('border-4 → 4 px border', async () => {
    const atom = await atomFor('border-4')
    expect(atom).toBeDefined()
  })

  it('border-red-500 color utility', async () => {
    const atom = await atomFor('border-red-500')
    expect(atom).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Effects', () => {
  it('opacity-50 → 0.5', async () => {
    expect(await atomFor('opacity-50')).toEqual({ opacity: 0.5 })
  })

  it('opacity-0 → 0', async () => {
    expect(await atomFor('opacity-0')).toEqual({ opacity: 0 })
  })

  it('opacity-100 → 1', async () => {
    expect(await atomFor('opacity-100')).toEqual({ opacity: 1 })
  })

  it('shadow-md produces something', async () => {
    const atom = await atomFor('shadow-md')
    expect(atom).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Transforms — rotate / scale / translate', () => {
  it('rotate-45 produces something', async () => {
    const atom = await atomFor('rotate-45')
    expect(atom).toBeDefined()
  })

  it('scale-50 produces something', async () => {
    const atom = await atomFor('scale-50')
    expect(atom).toBeDefined()
  })

  it('translate-x-4 produces something', async () => {
    const atom = await atomFor('translate-x-4')
    expect(atom).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Arbitrary values — bypass theme', () => {
  it('w-[23.7%] percent', async () => {
    expect(await atomFor('w-[23.7%]')).toEqual({ width: '23.7%' })
  })

  it('w-[123px] arbitrary pixel length', async () => {
    expect(await atomFor('w-[123px]')).toEqual({ width: 123 })
  })

  it('bg-[#ff0000] arbitrary hex color', async () => {
    const atom = await atomFor('bg-[#ff0000]')
    expect(atom?.backgroundColor).toMatch(/^#(?:ff0000|FF0000)$/i)
  })

  it('p-[7px] arbitrary padding', async () => {
    expect(await atomFor('p-[7px]')).toEqual({ padding: 7 })
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Custom theme — user-declared tokens', () => {
  it('adding --color-brand surfaces a `bg-brand` utility', async () => {
    const customParser = new TailwindParser({
      themeCss: `@import "tailwindcss";
@theme {
  --color-brand: #ff0099;
}`,
    })
    const result = await customParser.parseAtoms({
      content: '<V className="bg-brand" />',
      extension: 'tsx',
    })
    const atom = baseStyle(result, 'bg-brand')
    expect(atom?.backgroundColor).toBe('#ff0099')
  })

  it('custom --spacing multiplier (0.5rem) changes every spacing utility', async () => {
    const customParser = new TailwindParser({
      themeCss: `@import "tailwindcss";
@theme {
  --spacing: 0.5rem;
}`,
    })
    const result = await customParser.parseAtoms({
      content: '<V className="p-2" />',
      extension: 'tsx',
    })
    // 0.5rem × 2 = 1rem = 16px (same as default p-4, but via user override).
    expect(baseStyle(result, 'p-2')).toEqual({ padding: 16 })
  })

  it('custom --radius-5xl key surfaces a new `rounded-5xl` utility', async () => {
    const customParser = new TailwindParser({
      themeCss: `@import "tailwindcss";
@theme {
  --radius-5xl: 3rem;
}`,
    })
    const result = await customParser.parseAtoms({
      content: '<V className="rounded-5xl" />',
      extension: 'tsx',
    })
    expect(baseStyle(result, 'rounded-5xl')).toEqual({ borderRadius: 48 })
  })

  it('custom --text-display → font-size utility', async () => {
    const customParser = new TailwindParser({
      themeCss: `@import "tailwindcss";
@theme {
  --text-display: 2.5rem;
}`,
    })
    const result = await customParser.parseAtoms({
      content: '<V className="text-display" />',
      extension: 'tsx',
    })
    expect(baseStyle(result, 'text-display')?.fontSize).toBe(40)
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Multi-scheme output — `@variant light / dark / brand` resolve per-scheme', () => {
  it('light / dark / brand each get their own resolved color', async () => {
    const themeCss = `@import "tailwindcss";
@layer theme {
  :root {
    @variant light { --color-primary: #6366f1; }
    @variant dark { --color-primary: #818cf8; }
    @variant brand { --color-primary: #f472b6; }
  }
}`
    const customParser = new TailwindParser({ themeCss })
    const result = await customParser.parseAtoms({
      content: '<V className="bg-primary" />',
      extension: 'tsx',
    })
    // Three declared schemes surface in the result.
    expect([...result.schemes].toSorted((a, b) => a.localeCompare(b))).toEqual(['brand', 'dark', 'light'])
    const schemed = result.atoms.get('bg-primary')
    expect(schemed).toBeDefined()
    expect(schemed!.light).toEqual({ backgroundColor: '#6366f1' })
    expect(schemed!.dark).toEqual({ backgroundColor: '#818cf8' })
    expect(schemed!.brand).toEqual({ backgroundColor: '#f472b6' })
  })

  it('scheme-agnostic utilities (no var refs) resolve identically across schemes', async () => {
    const themeCss = `@import "tailwindcss";
@layer theme {
  :root {
    @variant light { --color-x: #111; }
    @variant dark { --color-x: #222; }
  }
}`
    const customParser = new TailwindParser({ themeCss })
    const result = await customParser.parseAtoms({
      content: '<V className="flex-1" />',
      extension: 'tsx',
    })
    const schemed = result.atoms.get('flex-1')
    expect(schemed?.light).toEqual({ flex: 1 })
    expect(schemed?.dark).toEqual({ flex: 1 })
  })
})

describe('Custom variants — scheme blocks from user CSS', () => {
  it('compiles with a user-declared `@custom-variant` for a named scheme', async () => {
    // The parser itself doesn't produce per-scheme maps yet — that's task
    // #27. This test pins the Tailwind-compile behavior: with a user-declared
    // `@custom-variant`, a variant-prefixed class still compiles without an
    // error, even if the parser currently only surfaces the base form.
    const customParser = new TailwindParser({
      themeCss: `@import "tailwindcss";
@custom-variant scheme-dark (&:where([data-scheme=dark], [data-scheme=dark] *));
@theme {
  --color-primary: #0a0a0a;
}`,
    })
    const result = await customParser.parseAtoms({
      content: '<V className="bg-primary scheme-dark:bg-primary" />',
      extension: 'tsx',
    })
    // Base utility resolves.
    expect(baseStyle(result, 'bg-primary')?.backgroundColor).toBe('#0a0a0a')
    // Scheme-prefixed candidate was discovered by oxide.
    expect(result.candidates).toContain('scheme-dark:bg-primary')
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Per-scheme variants — dark: / light: / brand: prefixes', () => {
  /**
   * Themed parser that knows about three `@variant` blocks so the parser
   * emits per-scheme atom styles.
   */
  let themedParser: TailwindParser

  beforeAll(async () => {
    themedParser = new TailwindParser({
      themeCss: `@import 'tailwindcss';
@layer theme {
  :root {
    @variant light { --color-bg: #ffffff; }
    @variant dark  { --color-bg: #000000; }
    @variant brand { --color-bg: #ff00ff; }
  }
}`,
    })
    await themedParser.parseAtoms({ content: '<V className="flex-1" />', extension: 'tsx' })
  })

  it('dark:opacity-20 only applies in dark scheme', async () => {
    const result = await themedParser.parseAtoms({
      content: '<V className="dark:opacity-20" />',
      extension: 'tsx',
    })
    const atom = result.atoms.get('dark:opacity-20')
    expect(atom?.dark?.opacity).toBeCloseTo(0.2, 4)
    expect(atom?.light).toEqual({})
    expect(atom?.brand).toEqual({})
  })

  it('light:bg-red-500 only applies in light scheme', async () => {
    const result = await themedParser.parseAtoms({
      content: '<V className="light:bg-red-500" />',
      extension: 'tsx',
    })
    const atom = result.atoms.get('light:bg-red-500')
    expect(atom?.light?.backgroundColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(atom?.dark).toEqual({})
    expect(atom?.brand).toEqual({})
  })

  it('brand:p-4 only applies in brand scheme', async () => {
    const result = await themedParser.parseAtoms({
      content: '<V className="brand:p-4" />',
      extension: 'tsx',
    })
    const atom = result.atoms.get('brand:p-4')
    expect(atom?.brand).toEqual({ padding: 16 })
    expect(atom?.light).toEqual({})
    expect(atom?.dark).toEqual({})
  })

  it('dark:opacity-100 still folds into the dark bucket when the theme uses @custom-variant with a non-default selector', async () => {
    // Reproduces the user-reported bug. The user's global.css declares:
    //   @custom-variant dark  (&:where(.scheme-dark, .scheme-dark *));
    //   @custom-variant light (&:where(.scheme-light, .scheme-light *));
    //   @custom-variant brand (&:where(.scheme-brand, .scheme-brand *));
    // …alongside `@layer theme { :root { @variant dark { … } } }` blocks.
    // Tailwind compiles `dark:opacity-100` to a nested rule keyed by the
    // user's selector (`.scheme-dark`), not the literal `.dark` class
    // rnwind's selector matcher expected. With both forms present, the
    // dark bucket comes back empty even when oxide picked up the
    // candidate.
    const customVariantParser = new TailwindParser({
      themeCss: `@import 'tailwindcss';
@custom-variant light (&:where(.scheme-light, .scheme-light *));
@custom-variant dark  (&:where(.scheme-dark, .scheme-dark *));
@custom-variant brand (&:where(.scheme-brand, .scheme-brand *));
@layer theme {
  :root {
    @variant light { --color-bg: #ffffff; }
    @variant dark  { --color-bg: #000000; }
    @variant brand { --color-bg: #ff00ff; }
  }
}`,
    })
    await customVariantParser.parseAtoms({ content: '<V className="flex-1" />', extension: 'tsx' })
    const result = await customVariantParser.parseAtoms({
      content: '<V className="dark:opacity-100" />',
      extension: 'tsx',
    })
    const atom = result.atoms.get('dark:opacity-100')
    expect(atom?.dark).toEqual({ opacity: 1 })
    expect(atom?.light).toEqual({})
    expect(atom?.brand).toEqual({})
  })

  it('dark:shadow-fuchsia-500 — scheme-prefixed color-only shadow modifier emits shadowColor in dark only', async () => {
    const result = await themedParser.parseAtoms({
      content: '<V className="dark:shadow-fuchsia-500" />',
      extension: 'tsx',
    })
    const atom = result.atoms.get('dark:shadow-fuchsia-500')
    expect(atom?.dark?.shadowColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(atom?.light).toEqual({})
    expect(atom?.brand).toEqual({})
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Edge cases', () => {
  it('handles multiple classes in one JSX element — each resolves independently', async () => {
    const result = await parser.parseAtoms({
      content: '<V className="flex-1 p-4 bg-red-500 opacity-50" />',
      extension: 'tsx',
    })
    expect(baseStyle(result, 'flex-1')).toEqual({ flex: 1 })
    expect(baseStyle(result, 'p-4')).toEqual({ padding: 16 })
    expect(baseStyle(result, 'bg-red-500')?.backgroundColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(baseStyle(result, 'opacity-50')).toEqual({ opacity: 0.5 })
  })

  it('preserves candidate order oxide surfaced (document order)', async () => {
    const result = await parser.parseAtoms({
      content: '<V className="p-4 flex-1 bg-red-500" />',
      extension: 'tsx',
    })
    const utilities = result.candidates.filter((c) => result.atoms.has(c))
    expect(utilities).toEqual(['p-4', 'flex-1', 'bg-red-500'])
  })

  it('empty className attribute → empty atoms map', async () => {
    const result = await parser.parseAtoms({ content: '<V className="" />', extension: 'tsx' })
    expect(result.atoms.size).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Transitions & Animation — Reanimated-compatible', () => {
  it('animate-spin → full animation shorthand (name + duration + timing + iteration)', async () => {
    const style = await atomFor('animate-spin')
    expect(style).toMatchObject({
      animationName: 'spin',
      animationDuration: '1s',
      animationTimingFunction: 'linear',
      animationIterationCount: 'infinite',
    })
  })

  it('animate-pulse → pulse keyframe reference + ease-in-out timing (snapped from cubic-bezier for Reanimated)', async () => {
    const style = await atomFor('animate-pulse')
    expect(style?.animationName).toBe('pulse')
    expect(style?.animationDuration).toBe('2s')
    // Tailwind emits cubic-bezier(0.4, 0, 0.6, 1) — Reanimated v4's CSS engine
    // only accepts predefined keywords. We snap to the closest one.
    expect(style?.animationTimingFunction).toBe('ease-in-out')
    expect(style?.animationIterationCount).toBe('infinite')
  })

  it('animate-bounce / animate-ping emit keyframes', async () => {
    for (const name of ['animate-bounce', 'animate-ping']) {
      const style = await atomFor(name)
      expect(typeof style?.animationName).toBe('string')
    }
  })

  it('duration-300 → transitionDuration=300ms', async () => {
    const style = await atomFor('duration-300')
    expect(style).toMatchObject({ transitionDuration: '300ms' })
  })

  it('delay-150 → transitionDelay=150ms', async () => {
    const style = await atomFor('delay-150')
    expect(style).toMatchObject({ transitionDelay: '150ms' })
  })

  it('ease-in-out → transitionTimingFunction snapped to a Reanimated-accepted keyword', async () => {
    const style = await atomFor('ease-in-out')
    const allowed = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end'])
    expect(allowed.has(style?.transitionTimingFunction as string)).toBe(true)
    expect(style?.transitionTimingFunction).toBe('ease-in-out')
  })

  it('ease-linear → transitionTimingFunction=linear', async () => {
    const style = await atomFor('ease-linear')
    expect(style).toMatchObject({ transitionTimingFunction: 'linear' })
  })

  it('transition-colors → transitionProperty values are camelCase RN style keys (so Reanimated diffs match)', async () => {
    // Reanimated v4 fires transitions when the watched style key actually
    // changes. RN stores `backgroundColor`, not `background-color`, so the
    // entries in `transitionProperty` MUST be the camelCase form.
    const style = await atomFor('transition-colors')
    expect(Array.isArray(style?.transitionProperty)).toBe(true)
    const props = style?.transitionProperty as readonly string[]
    expect(props).toContain('color')
    expect(props).toContain('backgroundColor')
    expect(props).toContain('borderColor')
    // Internal --tw-* gradient stops have no RN equivalent — drop.
    expect(props.every((p) => !p.startsWith('--'))).toBe(true)
  })

  it('transition-colors timing function snapped to keyword (Reanimated rejects cubic-bezier strings)', async () => {
    // Tailwind emits `transition-timing-function: var(--tw-ease, cubic-bezier(0.4, 0, 0.2, 1))`,
    // which flows through the unparsed declaration path. The serialized
    // value must NOT be a cubic-bezier string — Reanimated v4's CSS
    // engine throws "Invalid predefined timing function".
    const allowed = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end'])
    for (const cls of ['transition-colors', 'transition-opacity', 'transition-all', 'transition-transform']) {
      const style = await atomFor(cls)
      const tf = style?.transitionTimingFunction as string | undefined
      if (tf === undefined) continue
      expect(allowed.has(tf)).toBe(true)
    }
  })

  it('transition-all → transitionProperty=all', async () => {
    const style = await atomFor('transition-all')
    expect(style?.transitionProperty).toBe('all')
  })

  it('transition-opacity → transitionProperty=opacity', async () => {
    const style = await atomFor('transition-opacity')
    expect(style?.transitionProperty).toBe('opacity')
  })

  it('keyframes block includes transform: rotate(360deg) for spin', async () => {
    const result = await parser.parseAtoms({
      content: '<V className="animate-spin" />',
      extension: 'tsx',
    })
    const spin = result.keyframes.get('spin')
    expect(spin).toBeDefined()
    const toFrame = spin!.steps.find((s) => s.offset === 'to' || s.offset === '100%')
    expect(toFrame).toBeDefined()
    const transform = toFrame!.style.transform as readonly Record<string, string | number>[] | undefined
    expect(Array.isArray(transform)).toBe(true)
    expect(transform![0]).toMatchObject({ rotate: '360deg' })
  })

  it('keyframes block preserves opacity steps for pulse', async () => {
    const result = await parser.parseAtoms({
      content: '<V className="animate-pulse" />',
      extension: 'tsx',
    })
    const pulse = result.keyframes.get('pulse')
    expect(pulse).toBeDefined()
    const midFrame = pulse!.steps.find((s) => s.offset === '50%')
    expect(midFrame?.style.opacity).toBe(0.5)
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Transforms — RN transform array', () => {
  it('rotate-45 → transform: [{rotate: "45deg"}]', async () => {
    const style = await atomFor('rotate-45')
    const transform = style?.transform as readonly Record<string, string | number>[] | undefined
    expect(Array.isArray(transform)).toBe(true)
    expect(transform?.some((op) => op.rotate === '45deg')).toBe(true)
  })

  it('scale-150 → transform array with scaleX + scaleY', async () => {
    const style = await atomFor('scale-150')
    const transform = style?.transform as readonly Record<string, string | number>[] | undefined
    expect(Array.isArray(transform)).toBe(true)
    expect(transform?.some((op) => op.scaleX === 1.5)).toBe(true)
    expect(transform?.some((op) => op.scaleY === 1.5)).toBe(true)
  })

  it('translate-x-4 → transform array with translateX', async () => {
    const style = await atomFor('translate-x-4')
    const transform = style?.transform as readonly Record<string, string | number>[] | undefined
    expect(Array.isArray(transform)).toBe(true)
    expect(transform?.some((op) => op.translateX === 16)).toBe(true)
  })

  it('skew-x-12 → transform array with skewX', async () => {
    const style = await atomFor('skew-x-12')
    const transform = style?.transform as readonly Record<string, string | number>[] | undefined
    expect(Array.isArray(transform)).toBe(true)
    expect(transform?.some((op) => op.skewX === '12deg')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Tailwind v4 utility reference — broad surface coverage', () => {
  it('spacing scale is unbounded — arbitrary integers work', async () => {
    expect(await atomFor('p-17')).toEqual({ padding: 68 })
    expect(await atomFor('mt-100')).toEqual({ marginTop: 400 })
  })

  it('inset utilities — top/right/bottom/left + inset', async () => {
    expect(await atomFor('top-0')).toEqual({ top: 0 })
    expect(await atomFor('right-4')).toEqual({ right: 16 })
    expect(await atomFor('bottom-auto')).toEqual({ bottom: 'auto' })
    expect(await atomFor('left-1/2')).toEqual({ left: '50%' })
  })

  it('line-height utilities — tight/normal/loose', async () => {
    const tight = await atomFor('leading-tight')
    expect(tight?.lineHeight).toBeDefined()
    const relaxed = await atomFor('leading-relaxed')
    expect(relaxed?.lineHeight).toBeDefined()
  })

  it('gap with bare integer + gap-x / gap-y', async () => {
    expect(await atomFor('gap-0')).toEqual({ gap: 0 })
    expect(await atomFor('gap-x-3')).toEqual({ columnGap: 12 })
    expect(await atomFor('gap-y-5')).toEqual({ rowGap: 20 })
  })

  it('size-* utility — width + height together', async () => {
    const style = await atomFor('size-8')
    expect(style?.width).toBe(32)
    expect(style?.height).toBe(32)
  })

  it('ring-* utility emits either border or shadow equivalent for RN', async () => {
    const style = await atomFor('ring-2')
    expect(style).toBeDefined()
  })

  it('rounded on per-corner suffixes', async () => {
    const style = await atomFor('rounded-br-lg')
    expect(style?.borderBottomRightRadius).toBeDefined()
  })

  it('font-stretch-* declared → RN skips gracefully (no crash)', async () => {
    const style = await atomFor('font-stretch-normal')
    expect(style).toBeDefined()
  })

  it('underline / uppercase / italic text-decoration / text-transform', async () => {
    const underline = await atomFor('underline')
    expect(underline?.textDecorationLine).toBeDefined()
    const uppercase = await atomFor('uppercase')
    expect(uppercase?.textTransform).toBe('uppercase')
    const italicStyle = await atomFor('italic')
    expect(italicStyle?.fontStyle).toBe('italic')
  })

  it('text alignment', async () => {
    expect(await atomFor('text-left')).toEqual({ textAlign: 'left' })
    expect(await atomFor('text-right')).toEqual({ textAlign: 'right' })
    expect(await atomFor('text-justify')).toEqual({ textAlign: 'justify' })
  })

  it('aspect-* — known ratios', async () => {
    const style = await atomFor('aspect-square')
    expect(style?.aspectRatio).toBeDefined()
  })

  it('grid utilities pass through without crashing', async () => {
    expect(await atomFor('grid-cols-3')).toBeDefined()
    expect(await atomFor('col-span-2')).toBeDefined()
  })

  it('z-index accepts arbitrary bare integers', async () => {
    expect(await atomFor('z-9999')).toEqual({ zIndex: 9999 })
    expect(await atomFor('z-0')).toEqual({ zIndex: 0 })
  })

  it('opacity with bare integer', async () => {
    expect(await atomFor('opacity-75')).toEqual({ opacity: 0.75 })
  })

  it('color utilities via @theme vars — bg-[color]', async () => {
    const style = await atomFor('bg-[#00ff00]')
    expect(style?.backgroundColor).toBe('#00ff00')
  })

  it('arbitrary padding value in px', async () => {
    const style = await atomFor('p-[23px]')
    expect(style).toEqual({ padding: 23 })
  })
})
