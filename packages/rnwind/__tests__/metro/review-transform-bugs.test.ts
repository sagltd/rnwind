import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configureRnwindState, resetRnwindState, transform } from '../../src/metro'

const gen = (generate as unknown as { default?: typeof generate }).default ?? generate

/**
 * Regression coverage for the import-wrap transformer. In the wrap model
 * the transformer never rewrites JSX — it aliases host-component imports
 * and binds a `wrap()`-ed component in their place, so `className` (and
 * `contentContainerClassName`) stay on the element as raw props the
 * runtime wrapper resolves at render. These assert that wrapping happens
 * regardless of whether the JSX lives inside a recognised component, and
 * that no stale JSX-rewrite artefacts (`_l(`, `_t`, `useR_`) leak in.
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
  it('wraps the ScrollView import even when only contentContainerClassName is present', async () => {
    const source = `import { ScrollView } from 'react-native'
      export default () => <ScrollView contentContainerClassName="p-4" />`
    const out = await run(source)
    // Import wrapped; the prop stays raw for the runtime wrapper to read.
    expect(out).toMatch(/const ScrollView = _rnwWrap\(_rnw0\)/)
    expect(out).toContain('contentContainerClassName="p-4"')
  })
})

describe('import wrap — JSX context is irrelevant; only imports are rewritten', () => {
  it('wraps imports for a top-level renderItem helper and keeps className raw', async () => {
    const source = `import { View } from 'react-native'
      export const renderItem = ({ item }) => <View className="p-4" />`
    const out = await run(source)
    // className stays on the element; the wrapped import resolves it at
    // render. No stale JSX-rewrite artefacts.
    expect(out).toContain('className="p-4"')
    expect(out).toMatch(/const View = _rnwWrap\(_rnw0\)/)
    expect(out).not.toMatch(/_l\(/)
    expect(out).not.toContain('useR_')
  })

  it('wraps imports the same way when the JSX lives inside a component', async () => {
    const source = `import { View, FlatList } from 'react-native'
      export function List() {
        const renderItem = ({ item }) => <View className="p-4" />
        return <FlatList renderItem={renderItem} />
      }`
    const out = await run(source)
    expect(out).toMatch(/const View = _rnwWrap\(_rnw0\)/)
    expect(out).toMatch(/const FlatList = _rnwWrap\(_rnw1\)/)
    expect(out).toContain('className="p-4"')
    expect(out).not.toContain('useR_')
  })
})
