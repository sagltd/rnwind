import { describe, expect, it } from 'bun:test'
import { parse } from '@babel/parser'
import generateModule from '@babel/generator'
import type { File } from '@babel/types'
import { transformAst } from '../../src/metro/transform-ast'
import type { GradientAtomInfo } from '../../src/core/parser'

const generate = (generateModule as unknown as { default?: typeof generateModule }).default ?? generateModule

/**
 * Direct transformer tests for gradient rewriting. Feeds a gradient-
 * atom map (parser output shape) + a JSX source and asserts the
 * transformer strips gradient classes from the lookupCss atom array
 * and splices `colors` / `start` / `end` props onto the opening
 * element.
 */

/** Tag identifiers test sources use as bare stubs — treated as hosts so the transformer rewrites them. */
const TEST_HOST_COMPONENTS: readonly string[] = ['V', 'LG', 'Text', 'Pressable', 'TextInput', 'LinearGradient', 'Animated.View']

/**
 * Parse a source string, run it through `transformAst` with the
 * supplied gradient-atom map, and return the regenerated code.
 * @param source TSX source fragment.
 * @param gradientAtoms Parser-surfaced gradient metadata.
 * @returns Regenerated post-transform source.
 */
function run(source: string, gradientAtoms: Map<string, GradientAtomInfo>): string {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) as unknown as File
  transformAst(ast, { styleSpecifiers: [], gradientAtoms, hostComponents: TEST_HOST_COMPONENTS })
  return generate(ast).code
}

describe('transform-ast — gradient rewriting', () => {
  it('hoists colors/start/end consts and adds them as JSX attrs', () => {
    const gradientAtoms = new Map<string, GradientAtomInfo>([
      ['bg-gradient-to-r', { role: 'direction', dir: 'to-r' }],
      ['from-red-500', { role: 'from', color: '#ef4444' }],
      ['to-blue-500', { role: 'to', color: '#3b82f6' }],
    ])
    const out = run(
      `const LinearGradient: any = () => null
       export default () => (
         <LinearGradient className="bg-gradient-to-r from-red-500 to-blue-500 rounded-lg" />
       )`,
      gradientAtoms,
    )
    // Colours are hoisted to a frozen const.
    expect(out).toMatch(/const _g_[0-9a-f]+ = Object\.freeze\(\["#ef4444", "#3b82f6"\]\)/)
    // Start + end land as frozen `{x,y}` records.
    expect(out).toMatch(/const _gs_[0-9a-f]+ = Object\.freeze\(\{\s*x: 0,\s*y: 0\.5\s*\}\)/)
    expect(out).toMatch(/const _ge_[0-9a-f]+ = Object\.freeze\(\{\s*x: 1,\s*y: 0\.5\s*\}\)/)
    // The `colors`, `start`, `end` JSX attrs land on the opening element.
    expect(out).toMatch(/colors=\{_g_[0-9a-f]+\}/)
    expect(out).toMatch(/start=\{_gs_[0-9a-f]+\}/)
    expect(out).toMatch(/end=\{_ge_[0-9a-f]+\}/)
    // Gradient atoms are removed from the lookupCss atom array.
    expect(out).toMatch(/const _c_[0-9a-f]+ = \["rounded-lg"\]/)
  })

  it('handles three-stop gradients (from + via + to)', () => {
    const gradientAtoms = new Map<string, GradientAtomInfo>([
      ['bg-gradient-to-b', { role: 'direction', dir: 'to-b' }],
      ['from-red-500', { role: 'from', color: '#ef4444' }],
      ['via-yellow-500', { role: 'via', color: '#eab308' }],
      ['to-blue-500', { role: 'to', color: '#3b82f6' }],
    ])
    const out = run(
      `const LinearGradient: any = () => null
       export default () => <LinearGradient className="bg-gradient-to-b from-red-500 via-yellow-500 to-blue-500" />`,
      gradientAtoms,
    )
    expect(out).toMatch(/Object\.freeze\(\["#ef4444", "#eab308", "#3b82f6"\]\)/)
    expect(out).toMatch(/\{\s*x: 0\.5,\s*y: 0\s*\}/) // start for to-b
    expect(out).toMatch(/\{\s*x: 0\.5,\s*y: 1\s*\}/) // end for to-b
  })

  it('maps every direction to the right (start, end) pair', () => {
    const cases: Array<[string, string, string]> = [
      ['to-r', '{ x: 0, y: 0.5 }', '{ x: 1, y: 0.5 }'],
      ['to-l', '{ x: 1, y: 0.5 }', '{ x: 0, y: 0.5 }'],
      ['to-t', '{ x: 0.5, y: 1 }', '{ x: 0.5, y: 0 }'],
      ['to-b', '{ x: 0.5, y: 0 }', '{ x: 0.5, y: 1 }'],
      ['to-tr', '{ x: 0, y: 1 }', '{ x: 1, y: 0 }'],
      ['to-tl', '{ x: 1, y: 1 }', '{ x: 0, y: 0 }'],
      ['to-br', '{ x: 0, y: 0 }', '{ x: 1, y: 1 }'],
      ['to-bl', '{ x: 1, y: 0 }', '{ x: 0, y: 1 }'],
    ]
    for (const [dir, startPretty, endPretty] of cases) {
      const gradientAtoms = new Map<string, GradientAtomInfo>([
        [`bg-gradient-${dir}`, { role: 'direction', dir: dir as GradientAtomInfo['role'] extends 'direction' ? never : never }],
        ['from-red-500', { role: 'from', color: '#ef4444' }],
      ] as never)
      const out = run(
        `const LG: any = () => null; export default () => <LG className="bg-gradient-${dir} from-red-500" />`,
        gradientAtoms,
      )
      expect(out).toMatch(new RegExp(startPretty.replaceAll(/[{}]/g, String.raw`\$&`).replaceAll(' ', String.raw`\s*`)))
      expect(out).toMatch(new RegExp(endPretty.replaceAll(/[{}]/g, String.raw`\$&`).replaceAll(' ', String.raw`\s*`)))
    }
  })

  it('leaves non-gradient classes alone when no gradient atoms are present', () => {
    const out = run(
      `import { View } from 'react-native'; export default () => <View className="p-4 bg-red-500" />`,
      new Map(),
    )
    expect(out).not.toMatch(/colors=/)
    expect(out).not.toMatch(/_g_/)
    // Regular atoms still hoisted via the atom hoister.
    expect(out).toMatch(/_c_[0-9a-f]+/)
  })

  it('skips gradient emission when only direction is present (no colours)', () => {
    const gradientAtoms = new Map<string, GradientAtomInfo>([['bg-gradient-to-r', { role: 'direction', dir: 'to-r' }]])
    const out = run(
      `const LG: any = () => null; export default () => <LG className="bg-gradient-to-r p-4" />`,
      gradientAtoms,
    )
    // No colours → skip gradient emission; the direction atom still appears in the style path.
    expect(out).not.toMatch(/colors=/)
    expect(out).toMatch(/_c_[0-9a-f]+/)
  })
})
