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
  it('rewrites a static className into lookupCss + writes common.style.js + manifest', async () => {
    const source = `const V: any = () => null; export default () => <V className="flex-1 p-4" />`
    const filename = path.join(projectRoot, 'App.tsx')
    writeFileSync(filename, source)
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    const result = await transform({ filename, src: source, options: { projectRoot }, ast: ast as never })
    const out = gen(result.ast).code
    expect(out).toMatch(/style=\{_l\(_c_[0-9a-f]{12}, _t\)\}/)
    expect(out).toContain(`import { _l, useR_ } from "rnwind"`)
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
    const source = `const V: any = () => null; export default () => <V className="flex-1" />`
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
    const matches = commonSource.match(/"flex-1"/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('two files with disjoint atoms merge into one common.style.js carrying both', async () => {
    const fileA = path.join(projectRoot, 'A.tsx')
    const fileB = path.join(projectRoot, 'B.tsx')
    const sourceA = `const V: any = () => null; export default () => <V className="flex-1" />`
    const sourceB = `const V: any = () => null; export default () => <V className="bg-red-500" />`
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
    const source = `const V: any = () => null; export default () => <V className="animate-spin" />`
    const filename = path.join(projectRoot, 'App.tsx')
    writeFileSync(filename, source)
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    await transform({ filename, src: source, options: { projectRoot }, ast: ast as never })
    const commonSource = readFileSync(path.join(cacheDir, 'common.style.js'), 'utf8')
    expect(commonSource).toContain('"animate-spin"')
    expect(commonSource).toContain('"animationName"')
    expect(commonSource).toContain('"rotate":"360deg"')
  })

  it('no per-file JSON atom records are written (atoms directory never appears)', async () => {
    const source = `const V: any = () => null; export default () => <V className="flex-1" />`
    const filename = path.join(projectRoot, 'App.tsx')
    writeFileSync(filename, source)
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    await transform({ filename, src: source, options: { projectRoot }, ast: ast as never })
    expect(existsSync(path.join(cacheDir, 'atoms'))).toBe(false)
  })
})
