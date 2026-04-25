import { describe, expect, it } from 'bun:test'
import { parse } from '@babel/parser'
import generateModule from '@babel/generator'
import type { File } from '@babel/types'
import { tv } from 'tailwind-variants'
import { transformAst } from '../../src/metro/transform-ast'
import { __registerAtomsFromRecord, __resetLookupCssState, lookupCss } from '../../src/runtime/lookup-css'
import { ctx } from '../runtime/_ctx'

const generate = (generateModule as unknown as { default?: typeof generateModule }).default ?? generateModule

/**
 * tv() (tailwind-variants) is the most common class-composition library
 * users reach for. Its slot factories produce a STRING at runtime, which
 * users feed into a JSX `className=` attribute on either an RN host
 * (where rnwind compile-time-rewrites it) or a custom wrapper that
 * forwards the string down to a host.
 *
 * Two things must hold for tv to work end-to-end with rnwind:
 *  1. **Source-scan**: every Tailwind candidate appearing inside the
 *     `tv({...})` config must register as an atom (oxide scans the source
 *     text — tv literals are plain strings in the file).
 *  2. **Runtime resolve**: `lookupCss(tvResultString, _t)` must split
 *     the multi-class string and resolve every atom against the registry.
 *
 * The transform layer is verified via {@link transformAst} (custom
 * wrapper preserves the dynamic className; inner host rewrites it). The
 * runtime layer is verified by feeding a real `tv({...}).slot()` string
 * into `lookupCss` and checking the resolved style array.
 */

const TEST_HOSTS = ['Animated.View'] as const

/**
 * Run transformAst with default hosts + the test stubs.
 * @param source
 * @param hostSources
 */
function transform(source: string, hostSources?: readonly string[]): string {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) as unknown as File
  transformAst(ast, { styleSpecifiers: [], hostComponents: TEST_HOSTS, hostSources })
  return generate(ast).code
}

describe('tailwind-variants — transform layer', () => {
  it('tv slot result on a CUSTOM component leaves the dynamic className expression intact', () => {
    const source = `
      import { tv } from 'tailwind-variants'
      import { Tag } from './tag'
      const styles = tv({ base: 'px-2 py-1 rounded-md' })
      export default ({ extra }: any) => <Tag className={styles({ class: extra })}>Hi</Tag>
    `
    const out = transform(source)
    // Custom Tag → className survives untouched. The string still gets
    // scanned by oxide via the source text (px-2/py-1/rounded-md are literals).
    expect(out).toContain('className={styles({')
    expect(out).not.toMatch(/style=\{_l/)
  })

  it('tv slot result on an RN host rewrites the dynamic call to lookupCss(_, _t)', () => {
    const source = `
      import { tv } from 'tailwind-variants'
      import { View } from 'react-native'
      const styles = tv({ slots: { view: 'flex flex-row p-4' } })
      export default ({ cls }: any) => <View className={styles().view({ class: cls })} />
    `
    const out = transform(source)
    // Host View → dynamic expression flows through _l unchanged.
    expect(out).toMatch(/_l\(styles\(\)\.view\(/)
  })

  it('tv on Animated.View (member expr from react-native-reanimated) rewrites correctly', () => {
    const source = `
      import { tv } from 'tailwind-variants'
      import Animated from 'react-native-reanimated'
      const styles = tv({ base: 'opacity-100', variants: { dim: { true: 'opacity-50' } } })
      export default ({ dim }: any) => <Animated.View className={styles({ dim })} />
    `
    const out = transform(source)
    // Animated.View source = react-native-reanimated (default host) → rewritten.
    // Dynamic className routes through _ib (interactivity can't be ruled out).
    expect(out).toMatch(/<_ib _rw=\{\{\s*as: Animated\.View,\s*cn: styles\(\{\s*dim\s*\}\)/)
  })

  it('two-layer chain: parent tv → custom wrapper → inner host all wire up correctly', () => {
    // Layer 1: caller assembles classes via tv and passes to a custom wrapper.
    const callerSource = `
      import { tv } from 'tailwind-variants'
      import { Box } from './box'
      const styles = tv({ base: 'rounded-2xl bg-card', variants: { solid: { true: 'border-2' } } })
      export default ({ solid }: any) => <Box className={styles({ solid })}>Hi</Box>
    `
    const callerOut = transform(callerSource)
    expect(callerOut).toContain('className={styles({')
    expect(callerOut).not.toMatch(/style=\{_l/)

    // Layer 2: the custom wrapper forwards className to an RN host. The host
    // file (this is what `box.tsx` would look like) gets the rewrite.
    const wrapperSource = `
      import { View } from 'react-native'
      export function Box({ className, children }: any) {
        return <View className={className}>{children}</View>
      }
    `
    const wrapperOut = transform(wrapperSource)
    expect(wrapperOut).toMatch(/_l\(className,\s*_t\)/)
  })
})

describe('tailwind-variants — runtime layer', () => {
  it('lookupCss resolves a multi-class string produced by tv() into an array of registered styles', () => {
    const FLEX = { flex: 1 }
    const PADDING = { padding: 16 }
    const RADIUS = { borderRadius: 8 }
    __registerAtomsFromRecord({ 'flex-1': FLEX, 'p-4': PADDING, 'rounded-lg': RADIUS })
    try {
      const button = tv({
        base: 'flex-1 p-4',
        variants: { rounded: { true: 'rounded-lg' } },
      })
      const className = button({ rounded: true })
      // tv() returns a multi-token string — `className` is e.g. "flex-1 p-4 rounded-lg".
      expect(className.split(' ').toSorted((a, b) => a.localeCompare(b))).toEqual(['flex-1', 'p-4', 'rounded-lg'])
      const resolved = lookupCss(className, ctx('base'))
      expect(resolved).toEqual([FLEX, PADDING, RADIUS])
    } finally {
      __resetLookupCssState()
    }
  })

  it('lookupCss handles tv slot factories — each slot returns a string of its own atoms', () => {
    const VIEW = { display: 'flex' as const, flexDirection: 'row' as const }
    const TEXT = { fontWeight: '500' as const }
    __registerAtomsFromRecord({ 'flex': { display: 'flex' }, 'flex-row': { flexDirection: 'row' }, 'font-medium': TEXT })
    try {
      const styles = tv({
        slots: {
          view: 'flex flex-row',
          text: 'font-medium',
        },
      })()
      const viewResolved = lookupCss(styles.view(), ctx('base'))
      const textResolved = lookupCss(styles.text(), ctx('base'))
      // Slot order is whatever oxide registered; flatten to assert membership.
      const viewFlat = Object.assign({}, ...viewResolved as Array<Record<string, unknown>>)
      expect(viewFlat).toMatchObject(VIEW)
      expect(textResolved).toEqual([TEXT])
    } finally {
      __resetLookupCssState()
    }
  })

  it('lookupCss resolves tv compoundVariants / overrides — multi-class strings flatten left-to-right', () => {
    __registerAtomsFromRecord({
      'bg-transparent': { backgroundColor: 'transparent' },
      'bg-black': { backgroundColor: '#000000' },
      'border-text/20': { borderColor: 'rgba(0,0,0,0.2)' },
      'border-black': { borderColor: '#000000' },
    })
    try {
      const tag = tv({
        slots: { view: 'border' },
        variants: {
          isSelected: {
            true: { view: 'bg-black border-black' },
            false: { view: 'bg-transparent border-text/20' },
          },
        },
      })
      const selectedString = tag({ isSelected: true }).view()
      const resolved = lookupCss(selectedString, ctx('base'))
      const flat = Object.assign({}, ...resolved as Array<Record<string, unknown>>)
      // Last-class-wins flatten — `bg-black`/`border-black` after the base entry.
      expect(flat.backgroundColor).toBe('#000000')
      expect(flat.borderColor).toBe('#000000')
    } finally {
      __resetLookupCssState()
    }
  })
})
