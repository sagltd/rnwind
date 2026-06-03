import { beforeAll, describe, expect, it } from 'bun:test'
import { parse } from '@babel/parser'
import generateModule from '@babel/generator'
import type { File } from '@babel/types'
import { TailwindParser } from '../../src/core/parser'
import { transformAst } from '../../src/metro/transform-ast'
import { __registerAtomsFromRecord, __resetLookupCssState, lookupCss } from '../../src/runtime/lookup-css'
import { ctx } from '../runtime/_ctx'

const generate = (generateModule as unknown as { default?: typeof generateModule }).default ?? generateModule

/**
 * Regression coverage for the shadcn-style button pattern reported as
 * "renders with no styling":
 *
 * ```tsx
 * // button.variants.ts — a cva() config, NO `className=`, NO JSX
 * export const buttonVariants = cva('items-center justify-center rounded-lg px-4 py-2', {
 *   variants: { variant: { primary: 'bg-primary', secondary: 'border border-border bg-surface' } },
 * })
 *
 * // button.tsx
 * <Pressable className={clsx(buttonVariants({ variant }), className)}>…</Pressable>
 * ```
 *
 * Three independent guarantees have to hold for it to render styled, and
 * each is one `describe` below:
 *  1. **Source-scan** — every Tailwind class buried inside the `cva({...})`
 *     config registers as an atom even though its file carries neither a
 *     `className=` attribute nor any JSX (it's a plain `.ts` helper). This
 *     is the half that silently dropped the button's background / padding /
 *     radius when the variants file wasn't scanned.
 *  2. **Transform** — the dynamic `clsx(buttonVariants({ variant }), className)`
 *     expression is forwarded correctly: left intact on a custom primitive
 *     (which forwards it down to its inner host) and rewritten to a runtime
 *     `lookupCss` call on a react-native host.
 *  3. **Runtime** — `lookupCss` splits the multi-class string `clsx` builds
 *     and resolves every atom against the registry.
 */

/**
 * Theme exposing the colour tokens the meetelios button leans on, so
 * `bg-primary` / `bg-surface` / `border-border` resolve to concrete sRGB
 * values instead of being dropped as unknown utilities.
 */
const THEME = `@import 'tailwindcss';
@theme {
  --color-primary: #6366f1;
  --color-border: #e5e5e5;
  --color-surface: #fafafa;
}`

/**
 * The exact shape of meetelios' `button.variants.ts`: a `cva()` call with
 * every Tailwind class living inside string literals — no JSX, no
 * `className=` attribute. oxide must still surface these as candidates.
 */
const VARIANTS_SOURCE = `
  import { cva, type VariantProps } from 'class-variance-authority'
  export const buttonVariants = cva('items-center justify-center rounded-lg px-4 py-2', {
    variants: {
      variant: {
        primary: 'bg-primary',
        secondary: 'border border-border bg-surface',
      },
    },
    defaultVariants: { variant: 'primary' },
  })
  export type ButtonVariantProps = VariantProps<typeof buttonVariants>
`

/**
 * Run transformAst over a source string with the default host set (every
 * react-native export is a host; everything else is a custom component).
 * @param source Source text to rewrite.
 * @returns Regenerated code after the className → style rewrite.
 */
function transform(source: string): string {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) as unknown as File
  transformAst(ast, { styleSpecifiers: [] })
  return generate(ast).code
}

describe('cva + clsx variants — source scan (the `*.variants.ts` file)', () => {
  let parser: TailwindParser

  beforeAll(async () => {
    parser = new TailwindParser({ themeCss: THEME })
    // Warm the compiler so the first assertion below doesn't pay ~500ms.
    await parser.parseAtoms({ content: '<V className="flex-1" />', extension: 'tsx' })
  })

  it('registers every cva class even though the file has no `className=` attribute', async () => {
    // Guard the premise: this really is a className-free helper file.
    expect(VARIANTS_SOURCE).not.toContain('className=')

    const out = await parser.parseAtoms({ content: VARIANTS_SOURCE, extension: 'ts' })
    const [scheme] = out.schemes
    const styleOf = (name: string): unknown => out.atoms.get(name)?.[scheme!]

    // Base config classes resolve to RN style …
    expect(styleOf('items-center')).toEqual({ alignItems: 'center' })
    expect(styleOf('justify-center')).toEqual({ justifyContent: 'center' })
    expect(styleOf('rounded-lg')).toEqual({ borderRadius: 8 })
    expect(styleOf('px-4')).toEqual({ paddingHorizontal: 16 })
    expect(styleOf('py-2')).toEqual({ paddingVertical: 8 })
    // … and the themed variant colour resolves through the theme tokens —
    // the exact atom that was missing when the button rendered unstyled.
    expect(styleOf('bg-primary')).toEqual({ backgroundColor: '#6366f1' })
  })
})

describe('cva + clsx variants — transform layer', () => {
  it('leaves the dynamic clsx(buttonVariants()) expression intact on a CUSTOM primitive', () => {
    // meetelios button.tsx imports Pressable/Text from its own primitives,
    // so rnwind must NOT steal the className — the primitive forwards the
    // composed string down to the react-native host it wraps.
    const source = `
      import { Pressable, Text } from '../../primitives'
      export function Button({ variant, className }: any) {
        return (
          <Pressable className={clsx(buttonVariants({ variant }), className)}>
            <Text className="text-fg">x</Text>
          </Pressable>
        )
      }
    `
    const out = transform(source)
    expect(out).toContain('className={clsx(buttonVariants({')
    expect(out).not.toMatch(/style=\{_l/)
    expect(out).not.toContain('_ib')
  })

  it('rewrites the clsx expression to lookupCss on a react-native host (View)', () => {
    const source = `
      import { View } from 'react-native'
      export default ({ variant, className }: any) =>
        <View className={clsx(buttonVariants({ variant }), className)} />
    `
    const out = transform(source)
    expect(out).toMatch(/style=\{_l\(clsx\(buttonVariants\(\{\s*variant\s*\}\), className\), _t\)\}/)
  })

  it('wraps an interactive react-native host (Pressable) in InteractiveBox, carrying the clsx expression', () => {
    const source = `
      import { Pressable } from 'react-native'
      export default ({ variant, className }: any) =>
        <Pressable className={clsx(buttonVariants({ variant }), className)} />
    `
    const out = transform(source)
    expect(out).toMatch(/<_ib _rw=\{\{\s*as: Pressable,\s*cn: clsx\(buttonVariants\(\{\s*variant\s*\}\), className\)/)
  })

  it('two-layer chain: a custom primitive forwards className → its inner RN host rewrites it', () => {
    // The primitives/pressable.tsx half — the wrapper hands `className`
    // straight to a react-native Pressable, which rnwind then rewrites.
    const source = `
      import { Pressable as RNPressable } from 'react-native'
      export function Pressable({ className, ...props }: any) {
        return <RNPressable className={className} {...props} />
      }
    `
    const out = transform(source)
    expect(out).toMatch(/<_ib _rw=\{\{\s*as: RNPressable,\s*cn: className/)
  })
})

describe('cva + clsx variants — runtime layer', () => {
  it('resolves the multi-class string clsx(buttonVariants()) produces into the registered styles', () => {
    const ITEMS = { alignItems: 'center' as const }
    const JUSTIFY = { justifyContent: 'center' as const }
    const ROUNDED = { borderRadius: 8 }
    const PX = { paddingHorizontal: 16 }
    const PY = { paddingVertical: 8 }
    const BG = { backgroundColor: '#6366f1' }
    __registerAtomsFromRecord({
      'items-center': ITEMS,
      'justify-center': JUSTIFY,
      'rounded-lg': ROUNDED,
      'px-4': PX,
      'py-2': PY,
      'bg-primary': BG,
    })
    try {
      // The exact string `clsx(buttonVariants({ variant: 'primary' }), className)`
      // produces once the variant resolves — order preserved left-to-right.
      const className = 'items-center justify-center rounded-lg px-4 py-2 bg-primary'
      const resolved = lookupCss(className, ctx('base'))
      expect(resolved).toEqual([ITEMS, JUSTIFY, ROUNDED, PX, PY, BG])
    } finally {
      __resetLookupCssState()
    }
  })
})
