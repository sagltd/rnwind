import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configureRnwindState, resetRnwindState, transform } from '../../src/metro'

const gen = (generate as unknown as { default?: typeof generate }).default ?? generate

/**
 * End-to-end smoke: stand up a fake project with a real theme CSS,
 * feed source files through the Metro transformer, assert the
 * regenerated source imports the manifest specifier and the per-
 * scheme style files land on disk with the right atoms (and
 * keyframes inlined into atom values via `animationName`).
 */

let projectRoot: string
let cacheDir: string

beforeEach(() => {
  projectRoot = mkdtempSync(path.join(tmpdir(), 'rnwind-e2e-'))
  cacheDir = path.join(projectRoot, '.rnwind-cache')
  const cssPath = path.join(projectRoot, 'global.css')
  writeFileSync(cssPath, `@import "tailwindcss";`)
  configureRnwindState(cssPath, cacheDir)
})

afterEach(() => {
  resetRnwindState()
  if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true })
})

describe('Metro transform pipeline — end-to-end', () => {
  it('wraps the host import + keeps className + writes common.style.js + manifest', async () => {
    const source = `import { View as V } from 'react-native'; export default () => <V className="flex-1 p-4" />`
    const filename = path.join(projectRoot, 'App.tsx')
    writeFileSync(filename, source)
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    const result = await transform({ filename, src: source, options: { projectRoot }, ast: ast as never })
    const out = gen(result.ast).code
    // Import wrapped under the local alias; className stays for the runtime wrapper.
    expect(out).toMatch(/const V = _rnwWrap\(_rnw0\)/)
    expect(out).toContain('className="flex-1 p-4"')
    expect(out).toContain(`import { wrap as _rnwWrap } from "rnwind"`)
    expect(out).toContain(`import "rnwind/__generated/schemes"`)

    const manifestFile = path.join(cacheDir, 'schemes.js')
    const commonFile = path.join(cacheDir, 'common.style.js')
    expect(existsSync(manifestFile)).toBe(true)
    expect(existsSync(commonFile)).toBe(true)
    const commonSource = readFileSync(commonFile, 'utf8')
    expect(commonSource).toContain(`registerAtoms("common", {`)
    expect(commonSource).toContain('"flex-1"')
    expect(commonSource).toContain('"p-4"')
  })

  it('two files with the same atoms produce one merged common.style.js (no duplication)', async () => {
    const source = `import { View as V } from 'react-native'; export default () => <V className="flex-1" />`
    const fileA = path.join(projectRoot, 'A.tsx')
    const fileB = path.join(projectRoot, 'B.tsx')
    writeFileSync(fileA, source)
    writeFileSync(fileB, source)
    await transform({
      filename: fileA,
      src: source,
      options: { projectRoot },
      ast: parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) as never,
    })
    await transform({
      filename: fileB,
      src: source,
      options: { projectRoot },
      ast: parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) as never,
    })

    const commonSource = readFileSync(path.join(cacheDir, 'common.style.js'), 'utf8')
    // The atom is registered exactly once (the second file dedupes into
    // the same union entry). `"flex-1"` ALSO appears as a molecule key, so
    // scope the count to the `registerAtoms({...})` block only. A
    // single-use value is inlined (`"flex-1": {…}`); a shared one
    // references a const (`"flex-1": _sN`). Match either form.
    const atomsBlock = commonSource.slice(commonSource.indexOf('registerAtoms('), commonSource.indexOf('registerMolecules('))
    const atomMatches = atomsBlock.match(/"flex-1":\s*(?:_s\d+|\{)/g) ?? []
    expect(atomMatches).toHaveLength(1)
  })

  it('two files with disjoint atoms merge into one common.style.js carrying both', async () => {
    const fileA = path.join(projectRoot, 'A.tsx')
    const fileB = path.join(projectRoot, 'B.tsx')
    const sourceA = `import { View as V } from 'react-native'; export default () => <V className="flex-1" />`
    const sourceB = `import { View as V } from 'react-native'; export default () => <V className="bg-red-500" />`
    writeFileSync(fileA, sourceA)
    writeFileSync(fileB, sourceB)
    await transform({
      filename: fileA,
      src: sourceA,
      options: { projectRoot },
      ast: parse(sourceA, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) as never,
    })
    await transform({
      filename: fileB,
      src: sourceB,
      options: { projectRoot },
      ast: parse(sourceB, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) as never,
    })

    const commonSource = readFileSync(path.join(cacheDir, 'common.style.js'), 'utf8')
    expect(commonSource).toContain('"flex-1"')
    expect(commonSource).toContain('"bg-red-500"')
  })

  it('animate-* atoms inline their keyframes into the atom value via animationName', async () => {
    const source = `import { View as V } from 'react-native'; export default () => <V className="animate-spin" />`
    const filename = path.join(projectRoot, 'App.tsx')
    writeFileSync(filename, source)
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    await transform({ filename, src: source, options: { projectRoot }, ast: ast as never })
    const commonSource = readFileSync(path.join(cacheDir, 'common.style.js'), 'utf8')
    expect(commonSource).toContain('"animate-spin"')
    expect(commonSource).toContain('"animationName"')
    expect(commonSource).toContain('"rotate":"360deg"')
  })

  it('pre-merges a static literal className into a common-scheme molecule', async () => {
    const source = `import { View as V } from 'react-native'; export default () => <V className="flex-1 p-4" />`
    const filename = path.join(projectRoot, 'App.tsx')
    writeFileSync(filename, source)
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    await transform({ filename, src: source, options: { projectRoot }, ast: ast as never })
    const commonSource = readFileSync(path.join(cacheDir, 'common.style.js'), 'utf8')
    // The literal is registered as ONE pre-merged style object keyed by
    // its normalized className — the runtime resolver returns it by ref.
    expect(commonSource).toContain(`registerMolecules("common", {`)
    expect(commonSource).toMatch(/"flex-1 p-4":\s*\{[^}]*"flex":1[^}]*"padding":16[^}]*\}/)
  })

  it('does NOT emit a molecule for a context-dependent className (font-scale text)', async () => {
    const source = `import { Text as T } from 'react-native'; export default () => <T className="text-base font-bold" />`
    const filename = path.join(projectRoot, 'App.tsx')
    writeFileSync(filename, source)
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    await transform({ filename, src: source, options: { projectRoot }, ast: ast as never })
    const commonSource = readFileSync(path.join(cacheDir, 'common.style.js'), 'utf8')
    // `text-base` carries fontSize → font-scale-sensitive → not a molecule.
    expect(commonSource).not.toMatch(/"text-base font-bold":/)
  })

  it('no per-file JSON atom records are written (atoms directory never appears)', async () => {
    const source = `import { View as V } from 'react-native'; export default () => <V className="flex-1" />`
    const filename = path.join(projectRoot, 'App.tsx')
    writeFileSync(filename, source)
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    await transform({ filename, src: source, options: { projectRoot }, ast: ast as never })
    expect(existsSync(path.join(cacheDir, 'atoms'))).toBe(false)
  })
})
