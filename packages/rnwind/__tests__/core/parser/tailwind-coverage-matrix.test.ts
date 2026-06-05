import { beforeAll, describe, expect, it } from 'bun:test'
import { TailwindParser, type RNStyle } from '../../../src/core/parser'

/**
 * Systematic safety net for every major Tailwind v4 utility family.
 *
 * The bug pattern we're fencing off: a utility silently resolves to a
 * value RN can't render — `null`, `Infinity`, `NaN`, a literal `var(…)`
 * leftover, an unsubstituted `calc(…)`, or a CSS-keyword placeholder
 * like `'color'` / `'color/width'` that wasn't a real value at all. Each
 * of those leaks individually broke a real production layout (see
 * `length.ts` `lengthToPx` notes for the rounded-full / Infinity case
 * and `tokens.ts` `unquoteCssString` for the font-family quote case).
 *
 * Every assertion below runs the same cheap shape-check on the resolved
 * style: every property's value must be one of:
 *   - a finite number (no Infinity / NaN / null),
 *   - a string that does NOT contain `var(`, `calc(`, `infinity`, or a
 *     leftover CSS placeholder like `color`, `color/width`, `angle`,
 *   - a recognised RN composite (transform array, fontVariant array,
 *     animationName keyframe object, safe-area envelope, …).
 *
 * Add new utility families here whenever Tailwind ships them so the
 * `null`/`Infinity`/`var()` regressions can't sneak past CI again.
 */

const DEFAULT_THEME = `@import 'tailwindcss';`

let parser: TailwindParser

beforeAll(async () => {
  parser = new TailwindParser({ themeCss: DEFAULT_THEME })
  await parser.parseAtoms({ content: '<V className="flex-1" />', extension: 'tsx' })
})

/**
 * Resolve the base-scheme style for a given Tailwind class via the
 * shared parser. Single source of truth for the matrix below — keeps
 * each `it()` body to a one-line `expectClean(...)`.
 * @param className Tailwind utility to probe.
 * @returns Resolved RN style for the base scheme, or undefined when missing.
 */
async function atomFor(className: string): Promise<RNStyle | undefined> {
  const result = await parser.parseAtoms({ content: `<V className="${className}" />`, extension: 'tsx' })
  const [scheme] = result.schemes
  if (!scheme) return undefined
  return result.atoms.get(className)?.[scheme]
}

/** Substrings that should NEVER appear in a serialized RN style value — each indicates a parser leak. */
const FORBIDDEN_FRAGMENTS: readonly string[] = ['var(', 'calc(', 'infinity', 'undefined']

/** Bare CSS keywords that leak when Tailwind emits a syntax-doc placeholder like `bg-[color]`. */
const PLACEHOLDER_KEYWORDS: ReadonlySet<string> = new Set(['color', 'color/width', 'color/position/size', 'angle', 'length'])

/**
 * Walk every key/value pair in an RN style object and assert nothing
 * looks unrenderable. Recurses into RN composite shapes (transform
 * arrays, fontVariant arrays, animationName keyframe records).
 * @param style Resolved RN style.
 * @param className Class under test — included in failure messages.
 */
function expectClean(style: RNStyle | undefined, className: string): void {
  expect(style, `atom ${className} should resolve`).toBeDefined()
  const entries = Object.entries(style as RNStyle)
  expect(entries.length, `atom ${className} should produce at least one style entry`).toBeGreaterThan(0)
  for (const [key, value] of entries) {
    expectValueClean(value, `${className}.${key}`)
  }
}

/**
 * Per-value shape check — number / string / array / object recursion.
 * @param value RN style value at any depth.
 * @param trail Property trail used in failure messages.
 */
function expectValueClean(value: unknown, trail: string): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value), `${trail} must be finite (got ${value})`).toBe(true)
    return
  }
  if (typeof value === 'string') {
    expect(value.length, `${trail} must be non-empty`).toBeGreaterThan(0)
    expect(PLACEHOLDER_KEYWORDS.has(value), `${trail} must not equal a CSS placeholder keyword (got "${value}")`).toBe(false)
    for (const fragment of FORBIDDEN_FRAGMENTS) {
      expect(value.toLowerCase().includes(fragment), `${trail} must not contain "${fragment}" (got "${value}")`).toBe(false)
    }
    return
  }
  if (value === null || value === undefined) {
    // Direct assertion — bun's `expect` doesn't expose `.fail()`.
    expect(value, `${trail} resolved to ${value === null ? 'null' : 'undefined'}`).toBeDefined()
    return
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) expectValueClean(item, `${trail}[${index}]`)
    return
  }
  if (typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) expectValueClean(inner, `${trail}.${key}`)
    return
  }
  // Boolean values are fine (StyleSheet `includeFontPadding`, etc.).
}

/**
 * Run `expectClean` over a list of class names — one assertion per
 * class but reported as a single test. Keeps the matrix readable.
 * @param classNames Classes to probe.
 */
async function expectAllClean(classNames: readonly string[]): Promise<void> {
  for (const cn of classNames) {
    expectClean(await atomFor(cn), cn)
  }
}

describe('Tailwind coverage matrix — every common utility resolves to a clean RN style', () => {
  describe('Layout', () => {
    it('display / position', async () => {
      // `block`/`inline`/`grid` have no RN analog (RN lays out as flex) — they
      // correctly drop to `{}`, so they're excluded from the clean-style matrix.
      // `sticky`/`fixed` are RN-invalid `position` values (only absolute/
      // relative/static are valid) — they now drop, so they're excluded too.
      await expectAllClean(['flex', 'hidden', 'absolute', 'relative', 'static'])
    })
    it('inset / top / right / bottom / left', async () => {
      await expectAllClean(['inset-0', 'inset-1', 'inset-x-2', 'inset-y-3', 'top-4', 'right-2', 'bottom-1', 'left-0', '-inset-1', 'top-1/2'])
    })
    it('z-index / overflow / isolation', async () => {
      // `isolate` / `isolation-auto` map to `isolation`, which is not an RN
      // style prop — they correctly drop, so they're excluded from the matrix.
      await expectAllClean(['z-0', 'z-10', 'z-50', 'z-9999', 'overflow-hidden', 'overflow-visible', 'overflow-scroll'])
    })
  })

  describe('Flexbox & Grid', () => {
    it('flex direction / wrap / grow / shrink / basis', async () => {
      await expectAllClean(['flex-1', 'flex-row', 'flex-col', 'flex-row-reverse', 'flex-wrap', 'flex-nowrap', 'flex-grow', 'flex-shrink', 'basis-1/2'])
    })
    it('items / justify / content / self', async () => {
      await expectAllClean(['items-start', 'items-center', 'items-end', 'items-baseline', 'justify-start', 'justify-center', 'justify-between', 'self-center'])
    })
    it('gap', async () => {
      await expectAllClean(['gap-0', 'gap-1', 'gap-2', 'gap-4', 'gap-8', 'gap-x-2', 'gap-y-4'])
    })
  })

  describe('Spacing', () => {
    it('padding all sides', async () => {
      await expectAllClean(['p-0', 'p-1', 'p-2', 'p-4', 'p-8', 'p-px', 'px-2', 'py-3', 'pt-4', 'pr-2', 'pb-1', 'pl-3', 'p-[23px]', 'p-1.5'])
    })
    it('margin all sides incl. negative', async () => {
      await expectAllClean(['m-0', 'm-2', 'm-4', '-m-2', 'mx-2', 'my-1', 'mt-2', '-ml-3', 'mr-1', 'mb-1'])
    })
  })

  describe('Sizing', () => {
    it('width / height incl. screen / arbitrary / fractional', async () => {
      await expectAllClean(['w-0', 'w-1', 'w-4', 'w-1/2', 'w-full', 'w-screen', 'w-[120px]', 'h-0', 'h-12', 'h-full', 'h-[500px]', 'min-w-0', 'min-h-screen', 'max-w-md', 'max-h-32'])
    })
    it('size shorthand', async () => {
      await expectAllClean(['size-4', 'size-12', 'size-full'])
    })
  })

  describe('Typography', () => {
    it('font-size / weight / style / decoration / transform', async () => {
      await expectAllClean(['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl', 'text-3xl', 'font-thin', 'font-medium', 'font-bold', 'italic', 'underline', 'uppercase', 'lowercase', 'capitalize'])
    })
    it('line-height / letter-spacing / text-align', async () => {
      await expectAllClean(['leading-none', 'leading-tight', 'leading-6', 'tracking-tight', 'tracking-wide', 'text-left', 'text-center', 'text-right'])
    })
    it('color: text-* with default theme', async () => {
      await expectAllClean(['text-red-500', 'text-sky-700', 'text-slate-900', 'text-white', 'text-black'])
    })
    it('font-family with custom theme tokens (the regression that bit production)', async () => {
      const themed = new TailwindParser({
        themeCss: `@import 'tailwindcss'; @theme { --font-sans: 'Inter-Medium'; --font-mono: 'ui-monospace'; --font-mono-num: 'SFMono-Regular'; }`,
      })
      for (const cn of ['font-sans', 'font-mono', 'font-mono-num']) {
        const result = await themed.parseAtoms({ content: `<V className="${cn}" />`, extension: 'tsx' })
        const style = result.atoms.get(cn)?.[result.schemes[0]!]
        expect(typeof style?.fontFamily).toBe('string')
        expect(style?.fontFamily as string).not.toContain("'")
        expect(style?.fontFamily as string).not.toContain('"')
      }
    })
  })

  describe('Backgrounds & Colors', () => {
    it('bg-* (named / arbitrary / opacity-suffixed)', async () => {
      await expectAllClean(['bg-red-500', 'bg-sky-500', 'bg-white', 'bg-black', 'bg-transparent', 'bg-[#00ff00]', 'bg-[rgb(20,20,20)]', 'bg-black/50', 'bg-white/20'])
    })
  })

  describe('Borders', () => {
    it('border-width / arbitrary / per-side', async () => {
      await expectAllClean(['border', 'border-0', 'border-2', 'border-4', 'border-x', 'border-y', 'border-t', 'border-r', 'border-b', 'border-l'])
    })
    it('border-color', async () => {
      await expectAllClean(['border-red-500', 'border-black', 'border-white', 'border-transparent'])
    })
    it('border-radius — incl. rounded-full (the calc(infinity * 1px) regression)', async () => {
      await expectAllClean(['rounded', 'rounded-none', 'rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-xl', 'rounded-2xl', 'rounded-full'])
      // Strict guard for the specific Infinity-leak that broke production.
      const full = await atomFor('rounded-full')
      expect(typeof full?.borderRadius).toBe('number')
      expect(Number.isFinite(full?.borderRadius as number)).toBe(true)
    })
    it('rounded-{corner}-{size}', async () => {
      await expectAllClean(['rounded-t-lg', 'rounded-b-md', 'rounded-l-sm', 'rounded-r-xl', 'rounded-tl-2xl', 'rounded-br-full'])
    })
    it('border-style', async () => {
      await expectAllClean(['border-solid', 'border-dashed', 'border-dotted'])
    })
  })

  describe('Effects', () => {
    it('opacity (bare integer + arbitrary)', async () => {
      await expectAllClean(['opacity-0', 'opacity-25', 'opacity-50', 'opacity-75', 'opacity-100', 'opacity-[0.42]'])
    })
    it('shadow', async () => {
      await expectAllClean(['shadow', 'shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl'])
    })
  })

  describe('Transforms', () => {
    it('rotate / scale / skew / translate', async () => {
      await expectAllClean(['rotate-45', 'rotate-90', '-rotate-45', 'scale-50', 'scale-100', 'scale-150', 'skew-x-6', '-skew-x-6', 'translate-x-4', 'translate-y-2', '-translate-x-1/3', '-translate-x-full', '-translate-y-full'])
    })
  })

  describe('Animation', () => {
    it('animate-* keyword presets', async () => {
      await expectAllClean(['animate-spin', 'animate-pulse', 'animate-bounce', 'animate-ping'])
    })
  })

  describe('Aspect ratio', () => {
    it('aspect-square / arbitrary', async () => {
      await expectAllClean(['aspect-square', 'aspect-[4/3]'])
    })
  })

  describe('Interactivity / pointer-events', () => {
    it('pointer-events / cursor (RN-supported subset)', async () => {
      await expectAllClean(['pointer-events-none', 'pointer-events-auto'])
    })
  })

  describe('Negative + arbitrary regression suite', () => {
    it('arbitrary px / rem / percent values stay finite', async () => {
      await expectAllClean(['p-[12px]', 'm-[1.5rem]', 'w-[33.33%]', 'top-[-4px]', 'mt-[-8px]'])
    })
    it('negative spacing utilities', async () => {
      await expectAllClean(['-m-2', '-mt-1', '-ml-3', '-mx-2', '-my-2'])
    })
  })
})
