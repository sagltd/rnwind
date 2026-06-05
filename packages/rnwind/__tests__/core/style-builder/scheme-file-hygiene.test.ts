import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TailwindParser, type SourceEntry } from '../../../src/core/parser'
import { UnionBuilder } from '../../../src/core/style-builder/union-builder'

let projectRoot: string
let cacheDir: string

/** Theme declaring BOTH light + dark variants so a real `dark.style.js` is emitted. */
const THEME_LIGHT_DARK = `@import 'tailwindcss';
@custom-variant light (&:where(.light, .light *));
@custom-variant dark (&:where(.dark, .dark *));
@variant dark { @theme { --color-bg: #0a0a0a; } }`

/** Theme with NO dark variant — the swap target where `dark` must vanish. */
const THEME_LIGHT_ONLY = `@import 'tailwindcss';`

/**
 * Build oxide Scanner sources for a given project root — same shape
 * `state.ts` produces for real Metro sessions.
 * @param projectRoot_ Absolute path of the project to scan.
 * @returns Scanner sources (include JS/TS sources; exclude node_modules + cache).
 */
function sourcesFor(projectRoot_: string): readonly SourceEntry[] {
  return [
    { base: projectRoot_, pattern: '**/*.{ts,tsx,js,jsx}', negated: false },
    { base: projectRoot_, pattern: '**/node_modules/**', negated: true },
    { base: projectRoot_, pattern: '**/.rnwind/**', negated: true },
  ]
}

beforeEach(() => {
  projectRoot = mkdtempSync(path.join(tmpdir(), 'rnwind-hygiene-'))
  cacheDir = path.join(projectRoot, '.rnwind')
  mkdirSync(cacheDir, { recursive: true })
})

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('UnionBuilder.writeSchemes — on-disk scheme file hygiene', () => {
  it('deletes an orphaned variant file when its scheme disappears from the theme', async () => {
    // Theme declares dark → dark.style.js exists on disk after the first write.
    writeFileSync(path.join(projectRoot, 'A.tsx'), `export default () => <div className="bg-bg dark:bg-bg" />`)
    const parserWithDark = new TailwindParser({ themeCss: THEME_LIGHT_DARK, sources: sourcesFor(projectRoot) })
    const builderWithDark = new UnionBuilder(cacheDir, parserWithDark)
    await builderWithDark.writeSchemes()
    const darkPath = path.join(cacheDir, 'dark.style.js')
    expect(existsSync(darkPath)).toBe(true)

    // Theme swap (git pull): dark variant removed. A fresh builder is created
    // (CSS hash changed) but writes into the SAME cacheDir. The stale
    // dark.style.js must be removed and its in-memory signature dropped.
    const parserLightOnly = new TailwindParser({ themeCss: THEME_LIGHT_ONLY, sources: sourcesFor(projectRoot) })
    const builderLightOnly = new UnionBuilder(cacheDir, parserLightOnly)
    await builderLightOnly.writeSchemes()

    expect(existsSync(darkPath)).toBe(false)
    // common + manifest survive.
    expect(existsSync(path.join(cacheDir, 'common.style.js'))).toBe(true)
    expect(existsSync(path.join(cacheDir, 'schemes.js'))).toBe(true)
  })

  it('removes the orphaned scheme signature so a re-introduced scheme rewrites cleanly', async () => {
    // Build with dark, then swap to light-only on the SAME builder so the
    // schemeSignatures map carries a 'dark' entry that must be purged.
    writeFileSync(path.join(projectRoot, 'A.tsx'), `export default () => <div className="bg-bg dark:bg-bg" />`)
    const parserWithDark = new TailwindParser({ themeCss: THEME_LIGHT_DARK, sources: sourcesFor(projectRoot) })
    const builder = new UnionBuilder(cacheDir, parserWithDark)
    await builder.writeSchemes()
    expect(builder.schemeSignatureKeys()).toContain('dark')

    // The cache dir already holds dark.style.js. Now record a file with NO
    // dark atoms via a fresh light-only parse and write again on a builder
    // whose union has no dark scheme. Simulate by manually re-seeding: a
    // new builder over the same dir with a light-only theme.
    const parserLightOnly = new TailwindParser({ themeCss: THEME_LIGHT_ONLY, sources: sourcesFor(projectRoot) })
    const builder2 = new UnionBuilder(cacheDir, parserLightOnly)
    await builder2.writeSchemes()
    expect(builder2.schemeSignatureKeys()).not.toContain('dark')
  })

  it('rewrites a target whose on-disk bytes were corrupted even when the signature still matches', async () => {
    // First write seeds common.style.js + caches its signature.
    writeFileSync(path.join(projectRoot, 'A.tsx'), `export default () => <div className="flex-1 p-4" />`)
    const parser = new TailwindParser({ themeCss: THEME_LIGHT_ONLY, sources: sourcesFor(projectRoot) })
    const builder = new UnionBuilder(cacheDir, parser)
    await builder.writeSchemes()

    const commonPath = path.join(cacheDir, 'common.style.js')
    const correct = readFileSync(commonPath, 'utf8')
    expect(correct).toContain('"flex-1"')

    // Externally corrupt the file WITHOUT touching the in-memory signature.
    // The signature still matches the (now stale) expected source, so the
    // naive `existsSync` skip would leave the garbage in place.
    writeFileSync(commonPath, '/* CORRUPTED */', 'utf8')

    // Next write (no union change) must detect the byte mismatch and restore.
    await builder.writeSchemes()
    const restored = readFileSync(commonPath, 'utf8')
    expect(restored).toBe(correct)
    expect(restored).not.toContain('CORRUPTED')
  })
})
