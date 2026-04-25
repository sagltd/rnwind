import { describe, expect, it } from 'bun:test'
import { parse } from '@babel/parser'
import generateModule from '@babel/generator'
import type { File } from '@babel/types'
import { transformAst } from '../../src/metro/transform-ast'

const generate = (generateModule as unknown as { default?: typeof generateModule }).default ?? generateModule

/** Tag identifiers test sources use as bare stubs — treated as hosts so the transformer rewrites them. */
const TEST_HOST_COMPONENTS: readonly string[] = ['V', 'LG', 'Text', 'Pressable', 'TextInput', 'LinearGradient', 'Animated.View']

/**
 * The transformer no longer threads insets as a separate positional
 * arg — `_t = _r()` carries `insets` inside the rnwind context, and
 * `_l(_c, _t)` reads `_t.insets` at runtime. These tests pin the
 * single-binding shape across literal and dynamic className paths.
 * @param source TSX source fragment.
 * @returns Regenerated post-transform source.
 */
function run(source: string): string {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) as unknown as File
  transformAst(ast, { styleSpecifiers: [], hostComponents: TEST_HOST_COMPONENTS })
  return generate(ast).code
}

describe('transform-ast — safe-area plumbing', () => {
  it('non-safe literal emits the two-arg call', () => {
    const out = run(`import { View as V } from 'react-native'; export default () => <V className="flex-1 p-4" />`)
    expect(out).toMatch(/_l\(_c_[0-9a-f]+, _t\)/)
    expect(out).toContain('const _t = useR_()')
  })

  it('literal with a `*-safe` atom uses the same two-arg shape — insets ride inside _t', () => {
    const out = run(`import { View as V } from 'react-native'; export default () => <V className="pt-safe p-4" />`)
    expect(out).toContain(`import { _l, useR_ } from "rnwind"`)
    expect(out).toMatch(/_l\(_c_[0-9a-f]+, _t\)/)
    expect(out).not.toMatch(/useInsets/)
  })

  it('every documented safe-area shape goes through the two-arg path', () => {
    for (const cls of ['mt-safe', 'pt-safe-or-4', 'pt-safe-offset-4', 'h-screen-safe', 'inset-safe', 'start-safe-or-[2px]']) {
      const out = run(`import { View as V } from 'react-native'; export default () => <V className="${cls}" />`)
      expect(out).toMatch(/_l\(_c_[0-9a-f]+, _t\)/)
    }
  })

  it('dynamic className routes through `<_ib>` carrying _t in the spec', () => {
    const out = run(`import { View as V } from 'react-native'; export default ({ on }: any) => <V className={on ? 'a' : 'b'} />`)
    expect(out).toMatch(/<_ib _rw=\{\{\s*as: V,[^}]*t: _t\s*\}\}/)
  })
})
