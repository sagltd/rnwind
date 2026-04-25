import { describe, expect, it } from 'bun:test'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import { transformAst } from '../../src/metro/transform-ast'

const gen = (generate as unknown as { default?: typeof generate }).default ?? generate

/** Tag identifiers test sources use as bare stubs — treated as hosts so the transformer rewrites them. */
const TEST_HOST_COMPONENTS: readonly string[] = ['V', 'LG', 'Text', 'Pressable', 'TextInput', 'LinearGradient', 'Animated.View']

/**
 * Parse + transform + regenerate a source fragment for transformer assertions.
 * @param source TSX-flavoured source text.
 * @returns Regenerated code after transformAst mutates the AST in place.
 */
function run(source: string): string {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  transformAst(ast, { styleSpecifiers: [], hostComponents: TEST_HOST_COMPONENTS })
  return gen(ast).code
}

/**
 * The transformer routes every JSX site that could use `active:` /
 * `focus:` variants through `<_ib _rw={{as, cn, t}}>`. The original
 * tag moves into `_rw.as`, the className expression into `_rw.cn`,
 * and the rnwind context binding (`const _t = _r()`) into `_rw.t`.
 */
describe('transformAst: interactive variant wiring', () => {
  it('literal with active: token replaces the tag with _ib and packs the spec into _rw', () => {
    const out = run(`import { View as V } from 'react-native'; export default () => <V className="bg-sky-500 active:bg-sky-700" />`)
    expect(out).toContain(`import { useR_, _ib } from "rnwind"`)
    expect(out).not.toContain('useInteract')
    expect(out).toMatch(/<_ib _rw=\{\{\s*as: V,\s*cn: _c_[0-9a-f]+,\s*t: _t\s*\}\}/)
  })

  it('forwards user-supplied onPressIn untouched — _ib chains handlers internally', () => {
    const out = run(
      `import { View as V } from 'react-native'; export default ({ onPressIn }: any) => <V className="active:bg-sky-700" onPressIn={onPressIn} />`,
    )
    expect(out).toMatch(/<_ib [^>]*onPressIn=\{onPressIn\}/)
    expect(out).not.toContain('chainPress(')
  })

  it('forwards user-supplied onFocus untouched', () => {
    const out = run(
      `import { View as V } from 'react-native'; export default ({ handleFocus }: any) => <V className="focus:opacity-50" onFocus={handleFocus} />`,
    )
    expect(out).toMatch(/<_ib [^>]*onFocus=\{handleFocus\}/)
    expect(out).not.toContain('chainFocus(')
  })

  it('non-interactive literal keeps the inline `style={_l(...)}` shape — no _ib swap', () => {
    const out = run(`import { View as V } from 'react-native'; export default () => <V className="flex-1 bg-white" />`)
    expect(out).not.toContain('<_ib')
    expect(out).not.toContain('_rw')
    expect(out).toMatch(/style=\{_l\(_c_[0-9a-f]+, _t\)\}/)
  })

  it('dynamic className always opts in — runtime may still see active: tokens in the resolved string', () => {
    const out = run(`import { View as V } from 'react-native'; export default ({ on }: any) => <V className={on ? 'a' : 'b'} />`)
    expect(out).toMatch(/<_ib _rw=\{\{\s*as: V,\s*cn: on \? 'a' : 'b',\s*t: _t\s*\}\}/)
  })

  it('multiple interactive siblings each get their own _ib — zero shared hook state', () => {
    const out = run(`
      const V: any = () => null
      export default () => (
        <>
          <V className="active:bg-sky-700" />
          <V className="focus:opacity-50" />
        </>
      )
    `)
    const matches = [...out.matchAll(/<_ib /g)]
    expect(matches).toHaveLength(2)
    expect(out).not.toContain('useInteract(')
  })

  it('preserves existing style prop as _rw.us so the runtime can merge it into the resolved array', () => {
    const out = run(
      `import { View as V } from 'react-native'; export default ({ outer }: any) => <V className="active:bg-sky-700" style={outer} />`,
    )
    expect(out).toMatch(/<_ib _rw=\{\{\s*as: V,\s*cn: _c_[0-9a-f]+,\s*t: _t,\s*us: outer\s*\}\}/)
    expect(out).not.toMatch(/style=\{outer\}/)
  })

  it('supports JSX member tags (`Animated.View`) by converting them to a MemberExpression in _rw.as', () => {
    const out = run(`const Animated: any = {}; export default () => <Animated.View className="active:bg-sky-700" />`)
    expect(out).toMatch(/<_ib _rw=\{\{\s*as: Animated\.View/)
  })
})
