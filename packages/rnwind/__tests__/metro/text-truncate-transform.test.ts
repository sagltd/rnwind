import { describe, expect, it } from 'bun:test'
import { parse } from '@babel/parser'
import generateModule from '@babel/generator'
import type { File } from '@babel/types'
import { transformAst } from '../../src/metro/transform-ast'

const generate = (generateModule as unknown as { default?: typeof generateModule }).default ?? generateModule

/**
 * Direct transformer tests for text-truncate rewriting. Parses the
 * source, runs `transformAst`, and inspects the regenerated code for
 * `numberOfLines={N}` / `ellipsizeMode="tail"|"clip"` JSX attributes
 * alongside the stripped atom array.
 */

/**
 * Run `transformAst` against a source string with no parser plumbing —
 * truncate detection is name-based and lives entirely in the
 * transformer.
 * @param source TSX source fragment.
 * @returns Regenerated post-transform source.
 */
function run(source: string): string {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) as unknown as File
  transformAst(ast, { styleSpecifiers: [] })
  return generate(ast).code
}

describe('transform-ast — text-truncate rewriting', () => {
  it('rewrites `truncate` to numberOfLines=1 + ellipsizeMode="tail"', () => {
    const out = run(`export default () => <Text className="truncate text-red-500" />`)
    expect(out).toMatch(/numberOfLines=\{1\}/)
    expect(out).toMatch(/ellipsizeMode="tail"/)
    // Truncate atom stripped from the lookupCss atom array; text-red-500 remains.
    expect(out).toMatch(/const _c_[0-9a-f]+ = \["text-red-500"\]/)
    expect(out).not.toMatch(/"truncate"/)
  })

  it('rewrites `line-clamp-3` to numberOfLines={3} with no ellipsizeMode', () => {
    const out = run(`export default () => <Text className="line-clamp-3" />`)
    expect(out).toMatch(/numberOfLines=\{3\}/)
    expect(out).not.toMatch(/ellipsizeMode/)
  })

  it('text-ellipsis alone emits no JSX attrs (needs companion line count)', () => {
    const out = run(`export default () => <Text className="text-ellipsis" />`)
    expect(out).not.toMatch(/numberOfLines/)
    expect(out).not.toMatch(/ellipsizeMode/)
  })

  it('line-clamp-2 + text-clip emits clip mode', () => {
    const out = run(`export default () => <Text className="line-clamp-2 text-clip" />`)
    expect(out).toMatch(/numberOfLines=\{2\}/)
    expect(out).toMatch(/ellipsizeMode="clip"/)
  })

  it('later atom overrides earlier (line-clamp-3 beats truncate)', () => {
    const out = run(`export default () => <Text className="truncate line-clamp-3" />`)
    expect(out).toMatch(/numberOfLines=\{3\}/)
    // ellipsizeMode from truncate persists because line-clamp-3 doesn't override it.
    expect(out).toMatch(/ellipsizeMode="tail"/)
  })

  it('line-clamp-none clears truncate (emits nothing)', () => {
    const out = run(`export default () => <Text className="truncate line-clamp-none" />`)
    expect(out).not.toMatch(/numberOfLines/)
    expect(out).not.toMatch(/ellipsizeMode/)
  })

  it('arbitrary line-clamp-[5] is honoured', () => {
    const out = run(`export default () => <Text className="line-clamp-[5]" />`)
    expect(out).toMatch(/numberOfLines=\{5\}/)
  })

  it('user-provided numberOfLines is overridden by className', () => {
    const out = run(`export default () => <Text numberOfLines={2} className="truncate" />`)
    expect(out).toMatch(/numberOfLines=\{1\}/)
    // The user's 2 was stripped — only the class-derived 1 remains.
    expect(out).not.toMatch(/numberOfLines=\{2\}/)
  })

  it('passes through files without any truncate atoms', () => {
    const out = run(`export default () => <Text className="text-red-500 font-bold" />`)
    expect(out).not.toMatch(/numberOfLines/)
    expect(out).not.toMatch(/ellipsizeMode/)
  })

  it('skips emission on dynamic className (same constraint as gradient)', () => {
    const out = run(
      `export default ({cls}: {cls: string}) => <Text className={\`truncate \${cls}\`} />`,
    )
    // Template-literal-with-expression = dynamic. The transformer can't
    // inspect atoms, so no JSX attrs are spliced.
    expect(out).not.toMatch(/numberOfLines/)
    expect(out).not.toMatch(/ellipsizeMode/)
  })
})
