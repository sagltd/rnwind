import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configureRnwindState, resetRnwindState, transform } from '../../src/metro'

const gen = (generate as unknown as { default?: typeof generate }).default ?? generate

let projectRoot: string

/**
 * Transform one source through the full Metro entrypoint.
 * @param filename Absolute filename.
 * @param source Source text.
 * @returns Regenerated post-transform code.
 */
async function run(filename: string, source: string): Promise<string> {
  writeFileSync(filename, source)
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  const result = await transform({ filename, src: source, options: { projectRoot }, ast: ast as never })
  return gen(result.ast).code
}

beforeEach(() => {
  projectRoot = mkdtempSync(path.join(tmpdir(), 'rnwind-usecss-'))
  writeFileSync(path.join(projectRoot, 'global.css'), `@import "tailwindcss";`)
  configureRnwindState(path.join(projectRoot, 'global.css'), path.join(projectRoot, '.rnwind'))
})

afterEach(() => {
  resetRnwindState()
  if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true })
})

describe('useCss-only file — classes register on transform (no stale scan)', () => {
  it('records a class that only appears inside useCss("…") (no className= in the file)', async () => {
    const filename = path.join(projectRoot, 'use-accent.ts')
    await run(filename, `import { useCss } from 'rnwind'\nexport const useAccent = () => useCss("text-1 mx-2")`)
    const common = readFileSync(path.join(projectRoot, '.rnwind', 'common.style.js'), 'utf8')
    expect(common).toContain('"mx-2"')
    // text-1 needs a --color-1 token to compile; mx-2 is enough to prove the scan ran.
  })

  it('does NOT wrap imports in a useCss-only file (skia primitives stay untouched)', async () => {
    const filename = path.join(projectRoot, 'logo.tsx')
    const out = await run(
      filename,
      `import { Canvas, LinearGradient } from '@shopify/react-native-skia'\n` +
        `import { useCss } from 'rnwind'\n` +
        `export function Logo() {\n  const p = useCss("mx-2")\n  return <Canvas><LinearGradient /></Canvas>\n}`,
    )
    // No className / no spread → wrapping is skipped; skia keeps its raw imports.
    expect(out).not.toContain('_rnwWrap')
    expect(out).not.toContain('wrapNamespace')
  })
})
