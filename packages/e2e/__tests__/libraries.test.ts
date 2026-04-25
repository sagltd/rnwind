import { afterEach, describe, expect, it } from 'bun:test'
import clsx from 'clsx'
import classnames from 'classnames'
import { cva } from 'class-variance-authority'
import { tv } from 'tailwind-variants'
import { classed } from '@tw-classed/core'
import { transformAndRegister, type HarnessHandle } from './helpers/harness'

/**
 * Pull a single flat record out of the style array `lookupCss` returns.
 * RN flattens arrays left-to-right (later entries win) so a bare merge
 * is a faithful model for assertions.
 * @param styles Style array from `lookupCss`.
 * @returns Flattened style object.
 */
function flatten(styles: readonly unknown[]): Record<string, unknown> {
  return Object.assign({}, ...(styles as Record<string, unknown>[]))
}

let harness: HarnessHandle | null = null
afterEach(() => {
  harness?.teardown()
  harness = null
})

/**
 * All five libraries share the same integration shape: each one produces
 * a runtime class string consumed by `<View className={...}>`. rnwind's
 * job is to (a) scan the classes from the source text at build time and
 * (b) resolve the runtime string through `lookupCss` at render time. The
 * tests below verify both halves for every library against the real
 * published package.
 */

describe('library interop: clsx', () => {
  it('resolves a dynamic clsx() string composed with conditionals', async () => {
    // Classes must appear verbatim in the source so oxide picks them up.
    harness = await transformAndRegister(
      `import clsx from 'clsx'
       const V: any = () => null
       export default function Button({ primary }: { primary: boolean }) {
         return <V className={clsx('p-4 rounded-md', primary && 'bg-red-500', !primary && 'bg-gray-200')} />
       }`,
    )
    expect(harness.transformedSource).toMatch(/cn:\s*clsx\(/)

    const isPrimary = true
    const primary = flatten(harness.resolve(clsx('p-4 rounded-md', isPrimary && 'bg-red-500', !isPrimary && 'bg-gray-200')))
    expect(primary.padding).toBe(16)
    expect(primary.borderRadius).toBe(6)
    expect(primary.backgroundColor).toBeDefined()

    const isNotPrimary = false
    const secondary = flatten(
      harness.resolve(clsx('p-4 rounded-md', isNotPrimary && 'bg-red-500', !isNotPrimary && 'bg-gray-200')),
    )
    expect(secondary.backgroundColor).not.toBe(primary.backgroundColor)
  })

  it('handles object and array inputs (clsx built-in shapes)', async () => {
    harness = await transformAndRegister(
      `import clsx from 'clsx'
       const V: any = () => null
       export default () => <V className={clsx(['flex-1', 'items-center'], { 'justify-center': true })} />`,
    )
    const styles = flatten(harness.resolve(clsx(['flex-1', 'items-center'], { 'justify-center': true })))
    expect(styles.flex).toBe(1)
    expect(styles.alignItems).toBe('center')
    expect(styles.justifyContent).toBe('center')
  })
})

describe('library interop: classnames', () => {
  it('resolves a dynamic classnames() string', async () => {
    harness = await transformAndRegister(
      `import classNames from 'classnames'
       const V: any = () => null
       export default ({ on }: { on: boolean }) => (
         <V className={classNames('w-full h-12', { 'opacity-50': !on, 'opacity-100': on })} />
       )`,
    )
    expect(harness.transformedSource).toMatch(/cn:\s*classNames\(/)
    const off = flatten(harness.resolve(classnames('w-full h-12', { 'opacity-50': true, 'opacity-100': false })))
    expect(off.width).toBe('100%')
    expect(off.height).toBe(48)
    expect(off.opacity).toBeCloseTo(0.5, 4)
    const on = flatten(harness.resolve(classnames('w-full h-12', { 'opacity-50': false, 'opacity-100': true })))
    expect(on.opacity).toBe(1)
  })
})

describe('library interop: cva (class-variance-authority)', () => {
  it('resolves a cva() variant factory output', async () => {
    const source = `
      import { cva } from 'class-variance-authority'
      const V: any = () => null
      const button = cva('px-4 py-2 rounded-md', {
        variants: {
          intent: {
            primary: 'bg-blue-500',
            danger: 'bg-red-500',
          },
          size: {
            sm: 'text-sm',
            lg: 'text-lg',
          },
        },
        defaultVariants: { intent: 'primary', size: 'sm' },
      })
      export default ({ intent }: { intent: 'primary' | 'danger' }) =>
        <V className={button({ intent })} />
    `
    harness = await transformAndRegister(source)
    expect(harness.transformedSource).toMatch(/cn:\s*button\(/)

    const button = cva('px-4 py-2 rounded-md', {
      variants: {
        intent: { primary: 'bg-blue-500', danger: 'bg-red-500' },
        size: { sm: 'text-sm', lg: 'text-lg' },
      },
      defaultVariants: { intent: 'primary', size: 'sm' },
    })

    const primary = flatten(harness.resolve(button({ intent: 'primary', size: 'sm' })))
    expect(primary.paddingLeft).toBe(16)
    expect(primary.paddingRight).toBe(16)
    expect(primary.paddingTop).toBe(8)
    expect(primary.paddingBottom).toBe(8)
    expect(primary.borderRadius).toBe(6)
    expect(primary.fontSize).toBe(14)
    expect(primary.backgroundColor).toBeDefined()

    const danger = flatten(harness.resolve(button({ intent: 'danger', size: 'lg' })))
    expect(danger.fontSize).toBe(18)
    expect(danger.backgroundColor).not.toBe(primary.backgroundColor)
  })
})

describe('library interop: tailwind-variants', () => {
  it('resolves a tv() variant factory output including slots-free default output', async () => {
    const source = `
      import { tv } from 'tailwind-variants'
      const V: any = () => null
      const card = tv({
        base: 'p-4 rounded-lg',
        variants: {
          tone: { neutral: 'bg-gray-200', accent: 'bg-red-500' },
        },
        defaultVariants: { tone: 'neutral' },
      })
      export default ({ tone }: { tone?: 'neutral' | 'accent' }) => <V className={card({ tone })} />
    `
    harness = await transformAndRegister(source)
    expect(harness.transformedSource).toMatch(/cn:\s*card\(/)

    const card = tv({
      base: 'p-4 rounded-lg',
      variants: {
        tone: { neutral: 'bg-gray-200', accent: 'bg-red-500' },
      },
      defaultVariants: { tone: 'neutral' },
    })
    const neutral = flatten(harness.resolve(card({ tone: 'neutral' })))
    expect(neutral.padding).toBe(16)
    expect(neutral.borderRadius).toBe(8)
    expect(neutral.backgroundColor).toBeDefined()

    const accent = flatten(harness.resolve(card({ tone: 'accent' })))
    expect(accent.backgroundColor).not.toBe(neutral.backgroundColor)
  })
})

describe('library interop: composition', () => {
  it('resolves a clsx() wrapping cva() — common real-world shape', async () => {
    const source = `
      import clsx from 'clsx'
      import { cva } from 'class-variance-authority'
      const V: any = () => null
      const base = cva('p-4 rounded-md', {
        variants: { intent: { primary: 'bg-blue-500', danger: 'bg-red-500' } },
        defaultVariants: { intent: 'primary' },
      })
      export default ({ flush, intent }: { flush: boolean; intent: 'primary' | 'danger' }) =>
        <V className={clsx(base({ intent }), flush && '-mx-2')} />
    `
    harness = await transformAndRegister(source)
    const base = cva('p-4 rounded-md', {
      variants: { intent: { primary: 'bg-blue-500', danger: 'bg-red-500' } },
      defaultVariants: { intent: 'primary' },
    })
    const flush = true
    const styles = flatten(harness.resolve(clsx(base({ intent: 'danger' }), flush && '-mx-2')))
    expect(styles.padding).toBe(16)
    expect(styles.borderRadius).toBe(6)
    expect(styles.marginLeft).toBe(-8)
    expect(styles.marginRight).toBe(-8)
  })
})

describe('library interop: scheme variants through a utility', () => {
  it('picks the dark-scheme atom when a tv() result includes dark: prefixes', async () => {
    const source = `
      import { tv } from 'tailwind-variants'
      const V: any = () => null
      const panel = tv({ base: 'bg-white dark:bg-black text-gray-900 dark:text-gray-100 p-6' })
      export default () => <V className={panel()} />
    `
    harness = await transformAndRegister(source)
    const panel = tv({ base: 'bg-white dark:bg-black text-gray-900 dark:text-gray-100 p-6' })
    const cls = panel()
    const light = flatten(harness.resolve(cls, 'light'))
    const dark = flatten(harness.resolve(cls, 'dark'))
    expect(light.padding).toBe(24)
    expect(dark.padding).toBe(24)
    expect(light.backgroundColor).toBeDefined()
    expect(dark.backgroundColor).toBeDefined()
    // `dark:bg-black` on the dark scheme overrides `bg-white` — the resolved
    // colors should differ between schemes.
    expect(light.backgroundColor).not.toBe(dark.backgroundColor)
  })
})

describe('library interop: @tw-classed/core', () => {
  it('resolves a classed() composite string', async () => {
    const source = `
      import { classed } from '@tw-classed/core'
      const V: any = () => null
      const chip = classed('px-3 py-1 rounded-full', {
        variants: {
          tone: { info: 'bg-blue-500', warn: 'bg-red-500' },
        },
        defaultVariants: { tone: 'info' },
      })
      export default ({ tone }: { tone?: 'info' | 'warn' }) => <V className={chip({ tone })} />
    `
    harness = await transformAndRegister(source)
    expect(harness.transformedSource).toMatch(/cn:\s*chip\(/)

    const chip = classed('px-3 py-1 rounded-full', {
      variants: {
        tone: { info: 'bg-blue-500', warn: 'bg-red-500' },
      },
      defaultVariants: { tone: 'info' },
    })
    const info = flatten(harness.resolve(chip({ tone: 'info' })))
    expect(info.paddingLeft).toBe(12)
    expect(info.paddingRight).toBe(12)
    expect(info.paddingTop).toBe(4)
    expect(info.paddingBottom).toBe(4)
    expect(info.borderRadius).toBeDefined()
    expect(info.backgroundColor).toBeDefined()

    const warn = flatten(harness.resolve(chip({ tone: 'warn' })))
    expect(warn.backgroundColor).not.toBe(info.backgroundColor)
  })
})
