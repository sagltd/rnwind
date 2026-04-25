import { describe, expect, it } from 'bun:test'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import { transformAst } from '../../src/metro/transform-ast'

const gen = (generate as unknown as { default?: typeof generate }).default ?? generate

/**
 * Parse + transform + regenerate a source fragment for transformer assertions.
 * @param source TSX source.
 * @param styleSpecifiers Side-effect imports the transformer should prepend.
 * @returns Regenerated post-transform source.
 */
function run(source: string, styleSpecifiers: readonly string[] = []): string {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  transformAst(ast, { styleSpecifiers })
  return gen(ast).code
}

describe('transformAst', () => {
  it('rewrites `className="…"` to `style={_l(…, _t)}` with a hoisted atom-name array', () => {
    const out = run(`const V: any = () => null; export default () => <V className="flex-1 p-4" />`)
    expect(out).toMatch(/const _c_[0-9a-f]{12} = \["flex-1", "p-4"\]/)
    expect(out).toMatch(/style=\{_l\(_c_[0-9a-f]{12}, _t\)\}/)
    expect(out).toContain(`import { _l, useR_ } from "rnwind"`)
    expect(out).toContain('const _t = useR_()')
    expect(out).not.toContain('className=')
  })

  it('preserves adjacent `style={…}` prop by merging as the third arg', () => {
    const out = run(`const V: any = () => null; export default () => <V className="p-4" style={{ margin: 8 }} />`)
    expect(out).toMatch(/style=\{_l\(_c_[0-9a-f]{12}, _t, \{\s*margin: 8\s*\}\)\}/)
    const matches = out.match(/\sstyle=/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('treats `className={"…"}` the same as a bare string literal', () => {
    const out = run(`const V: any = () => null; export default () => <V className={'flex-1'} />`)
    expect(out).toMatch(/style=\{_l\(_c_[0-9a-f]{12}, _t\)\}/)
  })

  it('handles a static template literal `{`…`}` as a literal', () => {
    const out = run(`const V: any = () => null; export default () => <V className={\`p-4\`} />`)
    expect(out).toMatch(/const _c_[0-9a-f]{12} = \["p-4"\]/)
  })

  it('passes dynamic expressions through unchanged (no hoist) — and routes them through InteractiveBox', () => {
    const out = run(`const V: any = () => null; export default ({ on }: any) => <V className={on ? 'a' : 'b'} />`)
    expect(out).toMatch(/<_ib _rw=\{\{\s*as: V,\s*cn: on \? 'a' : 'b',\s*t: _t\s*\}\}/)
    expect(out).not.toMatch(/const _c_[0-9a-f]{12} =/)
  })

  it('dedupes identical className literals into one hoisted const', () => {
    const out = run(`const V: any = () => null; export default () => <><V className="a b" /><V className="a b" /></>`)
    const decls = [...out.matchAll(/const _c_[0-9a-f]{12} =/g)]
    expect(decls).toHaveLength(1)
  })

  it('preserves source order in the hoisted atom array — last className wins on RN style flatten', () => {
    const out = run(`const V: any = () => null; export default () => <V className="opacity-100 opacity-0" />`)
    expect(out).toMatch(/const _c_[0-9a-f]{12} = \["opacity-100", "opacity-0"\]/)
  })

  it('treats permutations as distinct hoisted arrays — order is part of the semantic', () => {
    const out = run(`const V: any = () => null; export default () => <><V className="a b" /><V className="b a" /></>`)
    const decls = [...out.matchAll(/const _c_[0-9a-f]{12} =/g)]
    expect(decls).toHaveLength(2)
  })

  it('prepends side-effect chunk imports before any runtime import', () => {
    const out = run(`const V: any = () => null; export default () => <V className="flex-1" />`, [
      'rnwind/__generated/styles/abc12345',
    ])
    const chunkIdx = out.indexOf(`import "rnwind/__generated/styles/abc12345"`)
    const runtimeIdx = out.indexOf(`from "rnwind"`)
    expect(chunkIdx).toBeGreaterThanOrEqual(0)
    expect(runtimeIdx).toBeGreaterThan(chunkIdx)
  })

  it('injects `const _t = useR_()` exactly once per component', () => {
    const out = run(`const V: any = () => null; export default () => <><V className="a" /><V className="b" /></>`)
    const matches = out.match(/const _t = useR_\(\)/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('no-ops when the file has no className attributes and no chunk imports', () => {
    const before = `const V: any = () => null; export default () => <V id="x" />`
    expect(run(before)).toBe(gen(parse(before, { sourceType: 'module', plugins: ['typescript', 'jsx'] })).code)
  })
})
