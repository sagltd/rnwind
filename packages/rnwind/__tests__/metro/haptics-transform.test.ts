import { describe, expect, it } from 'bun:test'
import { parse } from '@babel/parser'
import generateModule from '@babel/generator'
import type { File } from '@babel/types'
import { transformAst } from '../../src/metro/transform-ast'
import type { HapticRequest } from '../../src/core/parser'

const generate = (generateModule as unknown as { default?: typeof generateModule }).default ?? generateModule

/**
 * Transformer tests for haptic rewriting.
 *
 * Model:
 *  - Bare `haptic-*` → fires once on mount via injected `useMountHaptic`.
 *  - `active:haptic-*` → fires on press-in; transformer chains an
 *    `onPressIn` handler onto the element.
 */

/**
 * Tag identifiers test sources use as bare stubs (no `import` declaration
 * to back them). Treated as hosts so the transformer rewrites them.
 */
const TEST_HOST_COMPONENTS: readonly string[] = ['V', 'View', 'LG', 'Text', 'Pressable', 'TextInput', 'LinearGradient', 'Animated.View']

/**
 * Run `transformAst` against a source string with a haptic-atom map
 * that mimics parser output.
 * @param source TSX source fragment.
 * @param hapticAtoms Parser-surfaced haptic metadata.
 * @returns Regenerated post-transform source.
 */
function run(source: string, hapticAtoms: Map<string, HapticRequest>): string {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) as unknown as File
  transformAst(ast, { styleSpecifiers: [], hapticAtoms, hostComponents: TEST_HOST_COMPONENTS })
  return generate(ast).code
}

const ATOMS = new Map<string, HapticRequest>([
  ['haptic-light', { kind: 'impact', style: 'Light' }],
  ['haptic-medium', { kind: 'impact', style: 'Medium' }],
  ['haptic-success', { kind: 'notification', type: 'Success' }],
  ['haptic-selection', { kind: 'selection' }],
])

describe('transform-ast — haptics', () => {
  it('bare haptic-light injects a mount-fire hook', () => {
    const out = run(
      `export default () => <View className="haptic-light" />`,
      ATOMS,
    )
    // Hook injected at component top.
    expect(out).toMatch(/_hm/)
    // Haptic atom stripped from the lookupCss atom array.
    expect(out).not.toMatch(/"haptic-light"/)
  })

  it('active:haptic-medium injects an onPressIn chain', () => {
    const out = run(
      `export default () => <Pressable className="active:haptic-medium" onPressIn={foo} />`,
      ATOMS,
    )
    // onPressIn attribute rewritten to chain in the haptic.
    expect(out).toMatch(/onPressIn=/)
    // Haptic atom stripped from the className atom list.
    expect(out).not.toMatch(/"active:haptic-medium"/)
  })

  it('active:haptic-medium without any existing onPressIn still emits one', () => {
    const out = run(
      `export default () => <Pressable className="active:haptic-medium" />`,
      ATOMS,
    )
    expect(out).toMatch(/onPressIn=/)
  })

  it('file with no haptic atoms is untouched', () => {
    const out = run(
      `export default () => <View className="bg-red-500" />`,
      ATOMS,
    )
    expect(out).not.toMatch(/_hm/)
    expect(out).not.toMatch(/onPressIn=/)
  })

  it('multiple bare haptics in the same component aggregate', () => {
    const out = run(
      `export default () => (
         <View>
           <View className="haptic-success" />
           <View className="haptic-light" />
         </View>
       )`,
      ATOMS,
    )
    // One `_hm(...)` call (alias of `useMountHaptic`) for the whole component.
    expect(out.match(/_hm\(/g) ?? []).toHaveLength(1)
  })
})
