import { describe, expect, it } from 'bun:test'
import { parse } from '@babel/parser'
import generateModule from '@babel/generator'
import type { File } from '@babel/types'
import { transformAst, type TransformAstOptions } from '../../src/metro/transform-ast'

const generate = (generateModule as unknown as { default?: typeof generateModule }).default ?? generateModule

/** Tag identifiers test sources use as bare stubs — treated as hosts so the transformer rewrites them. */
const TEST_HOST_COMPONENTS: readonly string[] = [
  'V',
  'LG',
  'Text',
  'Pressable',
  'TextInput',
  'LinearGradient',
  'Animated.View',
  'ScrollView',
  'FlatList',
]

/**
 * Prefixed-className rewriting — `<prefix>ClassName="..."` on any JSX
 * element turns into `<prefix>Style={_l(...)}`. Same plumbing as the
 * plain `className` path (single `_t = _r()` binding, hoisted atom
 * array), but the target prop is derived from the prefix, and the
 * path always skips the `<_ib>` wrapper — prefixed targets are passive
 * sub-surfaces (ScrollView content container, etc.) that can't fire
 * press/focus.
 *
 * `contentContainer` is the always-on default. User-supplied prefixes
 * via `classNamePrefixes` are merged with the default, not replaced.
 * @param source TSX source fragment.
 * @param options Extra transformer options.
 * @returns Regenerated post-transform source.
 */
function run(source: string, options: Partial<TransformAstOptions> = {}): string {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) as unknown as File
  transformAst(ast, { styleSpecifiers: [], hostComponents: TEST_HOST_COMPONENTS, ...options })
  return generate(ast).code
}

describe('transform-ast — prefixed className rewriting', () => {
  it('rewrites the default contentContainerClassName to contentContainerStyle', () => {
    const out = run(
      `const ScrollView: any = () => null; export default () => <ScrollView contentContainerClassName="p-4 flex-1" />`,
    )
    expect(out).toMatch(/contentContainerStyle=\{_l\(_c_[0-9a-f]+, _t\)\}/)
    expect(out).not.toMatch(/contentContainerClassName/)
  })

  it('injects the context hook only once across className and contentContainerClassName', () => {
    const out = run(
      `const ScrollView: any = () => null
       export default () => <ScrollView className="flex-1" contentContainerClassName="p-4" />`,
    )
    const matches = out.match(/const _t = useR_\(\)/g) ?? []
    expect(matches.length).toBe(1)
  })

  it('merges a sibling contentContainerStyle as the userStyle argument', () => {
    const out = run(
      `const ScrollView: any = () => null
       export default ({ cs }: any) => <ScrollView contentContainerClassName="p-4" contentContainerStyle={cs} />`,
    )
    expect(out).toMatch(/contentContainerStyle=\{_l\(_c_[0-9a-f]+, _t, cs\)\}/)
  })

  it('safe-area atoms ride inside _t — no separate insets arg', () => {
    const out = run(
      `const ScrollView: any = () => null; export default () => <ScrollView contentContainerClassName="pt-safe" />`,
    )
    expect(out).toMatch(/contentContainerStyle=\{_l\(_c_[0-9a-f]+, _t\)\}/)
  })

  it('never wraps a prefixed rewrite in `<_ib>`, even for dynamic expressions', () => {
    const out = run(
      `const LG: any = () => null
       export default ({ on }: any) => <LG contentContainerClassName={on ? 'a' : 'b'} />`,
    )
    expect(out).not.toMatch(/<_ib/)
    expect(out).toMatch(/contentContainerStyle=\{_l\(on \? 'a' : 'b', _t\)/)
  })

  it('supports user-supplied prefixes additively alongside the default', () => {
    const out = run(
      `const V: any = () => null
       export default () => <V myFunnyClassName="p-2" contentContainerClassName="p-4" />`,
      { classNamePrefixes: ['myFunny'] },
    )
    expect(out).toMatch(/myFunnyStyle=\{_l\(_c_[0-9a-f]+, _t\)\}/)
    expect(out).toMatch(/contentContainerStyle=\{_l\(_c_[0-9a-f]+, _t\)\}/)
  })

  it('leaves unrelated <prefix>ClassName attributes alone when the prefix is not registered', () => {
    const out = run(
      `import { View as V } from 'react-native'; export default () => <V somethingElseClassName="p-4" />`,
    )
    expect(out).toMatch(/somethingElseClassName="p-4"/)
    expect(out).not.toMatch(/_l\(/)
  })
})
