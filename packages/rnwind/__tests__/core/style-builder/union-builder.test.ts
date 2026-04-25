import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TailwindParser, type SourceEntry } from '../../../src/core/parser'
import { UnionBuilder } from '../../../src/core/style-builder/union-builder'

let projectRoot: string
let cacheDir: string

const THEME_CSS = `@import 'tailwindcss';`

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
  projectRoot = mkdtempSync(path.join(tmpdir(), 'rnwind-ub-'))
  cacheDir = path.join(projectRoot, '.rnwind')
  mkdirSync(cacheDir, { recursive: true })
})

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
})

/**
 * Multi-worker clobbering repro: two UnionBuilder instances (standing in
 * for two Metro workers) operate on the same cacheDir. Each builds its
 * own parser with oxide sources pointing at the shared projectRoot, so
 * `ensureProjectScanned` gives BOTH workers the complete atom union —
 * no partial clobbering regardless of which files each worker
 * subsequently transforms.
 */
describe('UnionBuilder — multi-worker safety via oxide project scan', () => {
  it('parseProject discovers atoms across every source file', async () => {
    writeFileSync(path.join(projectRoot, 'A.tsx'), `export default () => <div className="flex-1 bg-red-500" />`)
    writeFileSync(path.join(projectRoot, 'B.tsx'), `export default () => <div className="p-4 text-blue-500" />`)

    const parser = new TailwindParser({ themeCss: THEME_CSS, sources: sourcesFor(projectRoot) })
    const builder = new UnionBuilder(cacheDir, parser)
    await builder.writeSchemes()

    const common = readFileSync(path.join(cacheDir, 'common.style.js'), 'utf8')
    expect(common).toContain('"flex-1"')
    expect(common).toContain('"bg-red-500"')
    expect(common).toContain('"p-4"')
    expect(common).toContain('"text-blue-500"')
  })

  it('worker B writing after worker A does NOT clobber worker A atoms', async () => {
    writeFileSync(path.join(projectRoot, 'A.tsx'), `export default () => <div className="flex-1" />`)
    writeFileSync(path.join(projectRoot, 'B.tsx'), `export default () => <div className="p-4" />`)

    // Worker A: its own parser + builder, both bound to the same projectRoot sources.
    const parserA = new TailwindParser({ themeCss: THEME_CSS, sources: sourcesFor(projectRoot) })
    const workerA = new UnionBuilder(cacheDir, parserA)
    const parsedA = await parserA.parseAtoms({ content: `<V className="flex-1" />`, extension: 'tsx' })
    await workerA.recordFile(path.join(projectRoot, 'A.tsx'), parsedA.atoms, parsedA.keyframes)
    await workerA.writeSchemes()
    const afterA = readFileSync(path.join(cacheDir, 'common.style.js'), 'utf8')
    expect(afterA).toContain('"flex-1"')
    expect(afterA).toContain('"p-4"')

    // Worker B: starts fresh, same sources → its own project scan sees
    // both files too. Its writeSchemes produces byte-identical output —
    // nothing gets clobbered.
    const parserB = new TailwindParser({ themeCss: THEME_CSS, sources: sourcesFor(projectRoot) })
    const workerB = new UnionBuilder(cacheDir, parserB)
    const parsedB = await parserB.parseAtoms({ content: `<V className="p-4" />`, extension: 'tsx' })
    await workerB.recordFile(path.join(projectRoot, 'B.tsx'), parsedB.atoms, parsedB.keyframes)
    await workerB.writeSchemes()
    const afterB = readFileSync(path.join(cacheDir, 'common.style.js'), 'utf8')
    expect(afterB).toContain('"flex-1"')
    expect(afterB).toContain('"p-4"')
  })

  it('CSS value change: a fresh parser + builder re-resolves every atom with the new theme', async () => {
    writeFileSync(path.join(projectRoot, 'A.tsx'), `export default () => <div className="bg-primary" />`)
    const cssPath = path.join(projectRoot, 'global.css')

    writeFileSync(cssPath, `@import 'tailwindcss';\n@theme { --color-primary: #ff0000; }`)
    const parser1 = new TailwindParser({
      themeCss: readFileSync(cssPath, 'utf8'),
      sources: sourcesFor(projectRoot),
    })
    const builder1 = new UnionBuilder(cacheDir, parser1)
    await builder1.writeSchemes()
    expect(readFileSync(path.join(cacheDir, 'common.style.js'), 'utf8')).toContain('#ff0000')

    // Simulate CSS edit: `getRnwindState` detects hash change → fresh parser + builder.
    writeFileSync(cssPath, `@import 'tailwindcss';\n@theme { --color-primary: #00ff00; }`)
    const parser2 = new TailwindParser({
      themeCss: readFileSync(cssPath, 'utf8'),
      sources: sourcesFor(projectRoot),
    })
    const builder2 = new UnionBuilder(cacheDir, parser2)
    await builder2.writeSchemes()
    const updated = readFileSync(path.join(cacheDir, 'common.style.js'), 'utf8')
    expect(updated).toContain('#00ff00')
    expect(updated).not.toContain('#ff0000')
  })

  it('recordFile returns a `changed` flag — false when the file re-transforms with the same atom set', async () => {
    // Fast-refresh hot path: the transformer should short-circuit
    // `writeSchemes` on saves where the user didn't edit any className
    // literal. `recordFile` must report whether the union actually
    // shifted so the transformer can skip the (~tens of ms) serializer.
    writeFileSync(path.join(projectRoot, 'A.tsx'), `export default () => <div className="flex-1 p-4" />`)
    const parser = new TailwindParser({ themeCss: THEME_CSS, sources: sourcesFor(projectRoot) })
    const builder = new UnionBuilder(cacheDir, parser)
    const parsed = await parser.parseAtoms({ content: `<V className="flex-1 p-4" />`, extension: 'tsx' })

    const firstPass = await builder.recordFile(path.join(projectRoot, 'A.tsx'), parsed.atoms, parsed.keyframes)
    expect(firstPass.changed).toBe(true)

    const secondPass = await builder.recordFile(path.join(projectRoot, 'A.tsx'), parsed.atoms, parsed.keyframes)
    expect(secondPass.changed).toBe(false)

    // Adding a new atom flips changed back to true.
    const withExtra = await parser.parseAtoms({ content: `<V className="flex-1 p-4 bg-red-500" />`, extension: 'tsx' })
    const thirdPass = await builder.recordFile(path.join(projectRoot, 'A.tsx'), withExtra.atoms, withExtra.keyframes)
    expect(thirdPass.changed).toBe(true)
  })

  it('writeSchemes reuses cached serialized atom values — only newly-resolved atoms hit JSON.stringify', async () => {
    // FR hot path when a user ADDS one className: writeSchemes is called.
    // Without a per-atom cache, every atom in the union re-runs
    // JSON.stringify + envelope + inline, burning ~50ms for 175+ atoms.
    // The cache means only the newly-seen atom pays the full cost.
    writeFileSync(path.join(projectRoot, 'A.tsx'), `export default () => <div className="flex-1 p-4 m-2" />`)
    const parser = new TailwindParser({ themeCss: THEME_CSS, sources: sourcesFor(projectRoot) })
    const builder = new UnionBuilder(cacheDir, parser)
    await builder.writeSchemes()

    // Hook the builder's stringify-cost counter — exposed for tests only.
    const first = builder.serializedMisses
    await builder.writeSchemes()
    const second = builder.serializedMisses
    // Second writeSchemes shouldn't have recomputed anything.
    expect(second).toBe(first)

    // Adding an atom the union hadn't seen still misses exactly ONCE.
    writeFileSync(path.join(projectRoot, 'B.tsx'), `export default () => <div className="bg-red-500" />`)
    const parsedB = await parser.parseAtoms({ content: `<V className="bg-red-500" />`, extension: 'tsx' })
    await builder.recordFile(path.join(projectRoot, 'B.tsx'), parsedB.atoms, parsedB.keyframes)
    await builder.writeSchemes()
    // Exactly one new atom → one miss on top of whatever was already there.
    expect(builder.serializedMisses).toBe(second + 1)
  })

  it('manifest + common scheme file always exist after the first writeSchemes', async () => {
    const parser = new TailwindParser({ themeCss: THEME_CSS, sources: sourcesFor(projectRoot) })
    const builder = new UnionBuilder(cacheDir, parser)
    await builder.writeSchemes()
    expect(existsSync(path.join(cacheDir, 'schemes.js'))).toBe(true)
    expect(existsSync(path.join(cacheDir, 'common.style.js'))).toBe(true)
  })
})
