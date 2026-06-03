import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configureRnwindState, resetRnwindState, transform } from '../../src/metro'

const gen = (generate as unknown as { default?: typeof generate }).default ?? generate

/**
 * Regression coverage for two transformer bugs found in the full review:
 *  1. The cheap rewrite gate skipped files whose only rnwind usage was a
 *     `<prefix>ClassName` attribute (the gate looked for lowercase
 *     `className=`, which `contentContainerClassName=` doesn't contain).
 *  2. JSX with a className inside a function the transformer doesn't
 *     recognise as a component (a top-level `renderItem` helper) emitted
 *     a reference to an undeclared `_t` → runtime ReferenceError.
 */
let projectRoot: string

/**
 * Run the full Metro transform entrypoint over one source string.
 * @param source Source text to transform.
 * @returns Regenerated post-transform code.
 */
async function run(source: string): Promise<string> {
  const filename = path.join(projectRoot, 'App.tsx')
  writeFileSync(filename, source)
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  const result = await transform({ filename, src: source, options: { projectRoot }, ast: ast as never })
  return gen(result.ast).code
}

beforeEach(() => {
  projectRoot = mkdtempSync(path.join(tmpdir(), 'rnwind-review-'))
  const cssPath = path.join(projectRoot, 'global.css')
  writeFileSync(cssPath, `@import "tailwindcss";`)
  configureRnwindState(cssPath, path.join(projectRoot, '.rnwind-cache'))
})

afterEach(() => {
  resetRnwindState()
  if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true })
})

describe('rewrite gate — files with only a `<prefix>ClassName` attribute must still be processed', () => {
  it('rewrites contentContainerClassName even when no plain className= is present', async () => {
    const source = `import { ScrollView } from 'react-native'
      export default () => <ScrollView contentContainerClassName="p-4" />`
    const out = await run(source)
    expect(out).toMatch(/contentContainerStyle=\{_l\(/)
  })
})

describe('undeclared `_t` — JSX in a non-component function must not emit a dangling context binding', () => {
  it('leaves className untouched for a top-level renderItem helper (no crash-causing _t reference)', async () => {
    const source = `import { View } from 'react-native'
      export const renderItem = ({ item }) => <View className="p-4" />`
    const out = await run(source)
    // No enclosing component → bail: className stays, no _l() call, no
    // dangling `_t` reference, no rnwind import.
    expect(out).toContain('className="p-4"')
    expect(out).not.toMatch(/_l\(/)
    expect(out).not.toContain('_t')
  })

  it('still rewrites the same JSX when it lives inside a real component', async () => {
    const source = `import { View, FlatList } from 'react-native'
      export function List() {
        const renderItem = ({ item }) => <View className="p-4" />
        return <FlatList renderItem={renderItem} />
      }`
    const out = await run(source)
    // Inside List → _t injected in List's body, inner arrow closes over it.
    expect(out).toMatch(/const _t = useR_\(\)/)
    expect(out).toMatch(/style=\{_l\(/)
  })
})
