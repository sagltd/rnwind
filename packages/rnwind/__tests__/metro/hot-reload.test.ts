import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configureRnwindState, onThemeChange, resetRnwindState } from '../../src/metro/state'
import { getCacheKey, transform } from '../../src/metro/transformer'
import { THEME_SIGNATURE_MODULE, createRnwindResolver } from '../../src/metro/resolver'

let projectRoot: string
let cssPath: string
let cacheDir: string

beforeEach(() => {
  projectRoot = mkdtempSync(path.join(tmpdir(), 'rnwind-hr-'))
  cssPath = path.join(projectRoot, 'global.css')
  cacheDir = path.join(projectRoot, '.cache')
  writeFileSync(cssPath, `@import 'tailwindcss';\n@theme { --color-bg: #f8fafc; }\n`)
  configureRnwindState(cssPath, cacheDir)
})

afterEach(() => {
  resetRnwindState()
  rmSync(projectRoot, { recursive: true, force: true })
})

/**
 * Hot reload of the theme CSS no longer needs a file-watcher or
 * source-padding hack. Every transformed file imports
 * `rnwind/__generated/style`; when the theme changes, the union
 * `style.js` gets regenerated with new bytes; Metro's content-SHA1
 * dedup detects the change and invalidates every importer through
 * the dep graph automatically. `getCacheKey()` covers Metro's
 * per-file transform cache so cold starts pick up the new theme too.
 */
describe('Hot-reload of theme CSS', () => {
  it("getCacheKey() changes when global.css contents change — Metro's transform cache invalidates", () => {
    const before = getCacheKey()
    writeFileSync(cssPath, `@import 'tailwindcss';\n@theme { --color-bg: #ff00ff; }\n`)
    const after = getCacheKey()
    expect(before).not.toBe(after)
  })

  it('every transformed file imports the THEME_SIGNATURE_MODULE sentinel', async () => {
    const filename = path.join(projectRoot, 'App.tsx')
    const source = `import { View as V } from 'react-native'; export default () => <V className="flex-1" />`
    writeFileSync(filename, source)
    const result = await transform({ filename, src: source, options: { projectRoot } })
    const generated = await import('@babel/generator').then(
      (m) => (m.default as unknown as { default?: typeof m.default }).default ?? m.default,
    )
    const { code } = generated(result.ast)
    expect(code).toContain(THEME_SIGNATURE_MODULE)
  })

  it("createRnwindResolver maps the sentinel to the user's CSS path so Metro watches it", () => {
    const resolve = createRnwindResolver(null)
    process.env.RNWIND_CSS_ENTRY_FILE = cssPath
    const result = resolve({} as never, THEME_SIGNATURE_MODULE, null)
    expect(result).toEqual({ type: 'sourceFile', filePath: cssPath })
  })

  it('transformer short-circuits .css inputs to an empty `export {}` module', async () => {
    const result = await transform({ filename: cssPath, src: '', options: { projectRoot } })
    expect(result.ast.program.body.length).toBeGreaterThan(0)
  })

  it('common.style.js is rewritten when a new atom appears — its bytes change so importers invalidate via Metro dep graph', async () => {
    const commonFile = path.join(cacheDir, 'common.style.js')
    const fileA = path.join(projectRoot, 'A.tsx')
    writeFileSync(fileA, `import { View as V } from 'react-native'; export default () => <V className="flex-1" />`)
    await transform({
      filename: fileA,
      src: readFileSync(fileA, 'utf8'),
      options: { projectRoot },
    })
    const before = readFileSync(commonFile, 'utf8')
    expect(before).toContain('"flex-1"')

    // Add a second file with a new atom — common.style.js must include both now.
    const fileB = path.join(projectRoot, 'B.tsx')
    writeFileSync(fileB, `import { View as V } from 'react-native'; export default () => <V className="bg-red-500" />`)
    await transform({
      filename: fileB,
      src: readFileSync(fileB, 'utf8'),
      options: { projectRoot },
    })
    const after = readFileSync(commonFile, 'utf8')
    expect(after).not.toBe(before)
    expect(after).toContain('"flex-1"')
    expect(after).toContain('"bg-red-500"')
  })

  it('re-transforming the same file with no atom changes leaves common.style.js bytes unchanged', async () => {
    const commonFile = path.join(cacheDir, 'common.style.js')
    const filename = path.join(projectRoot, 'App.tsx')
    const source = `import { View as V } from 'react-native'; export default () => <V className="flex-1" />`
    writeFileSync(filename, source)
    await transform({ filename, src: source, options: { projectRoot } })
    const first = readFileSync(commonFile, 'utf8')

    await transform({ filename, src: source, options: { projectRoot } })
    const second = readFileSync(commonFile, 'utf8')
    expect(second).toBe(first)
  })

  it('transforming global.css (Metro watcher firing after an edit) rewrites common.style.js inline', async () => {
    // When Metro detects the CSS source changed, it invokes the
    // transformer on the CSS file. rnwind piggybacks on that call —
    // `onThemeChange` runs inside the `.css` branch — so scheme files
    // land on disk BEFORE Metro finishes that transform, and the
    // dep-graph pushes the rebuilt `common.style.js` to the device.
    const commonFile = path.join(cacheDir, 'common.style.js')
    const filename = path.join(projectRoot, 'App.tsx')
    const source = `import { View as V } from 'react-native'; export default () => <V className="bg-bg" />`
    writeFileSync(filename, source)

    writeFileSync(cssPath, `@import 'tailwindcss';\n@theme { --color-bg: #ff0000; }\n`)
    await transform({ filename, src: source, options: { projectRoot } })
    expect(readFileSync(commonFile, 'utf8')).toContain('#ff0000')

    // User saves a new theme colour. Metro picks the change up via its
    // own watcher (the CSS is in the dep graph as the theme signature
    // sentinel), then invokes our transformer on the CSS file itself.
    writeFileSync(cssPath, `@import 'tailwindcss';\n@theme { --color-bg: #00ff00; }\n`)
    await transform({
      filename: cssPath,
      src: readFileSync(cssPath, 'utf8'),
      options: { projectRoot },
    })

    const after = readFileSync(commonFile, 'utf8')
    expect(after).toContain('#00ff00')
    expect(after).not.toContain('#ff0000')
  })

  it('the .css module output bytes change when CSS content changes (propagates Metro invalidation downstream)', async () => {
    const result1 = await transform({
      filename: cssPath,
      src: `@import 'tailwindcss';\n@theme { --color-bg: #111; }`,
      options: { projectRoot },
    })
    const result2 = await transform({
      filename: cssPath,
      src: `@import 'tailwindcss';\n@theme { --color-bg: #222; }`,
      options: { projectRoot },
    })
    const generated = await import('@babel/generator').then(
      (m) => (m.default as unknown as { default?: typeof m.default }).default ?? m.default,
    )
    expect(generated(result1.ast).code).not.toBe(generated(result2.ast).code)
  })

  it('editing global.css rewrites common.style.js with the new theme values', async () => {
    // Repro for the reported `global.css edits don't refresh` bug: user
    // saves a new `@theme` value but the app never sees it because
    // nothing rebuilds scheme files until a JS file is re-transformed.
    const commonFile = path.join(cacheDir, 'common.style.js')
    const filename = path.join(projectRoot, 'App.tsx')
    const source = `import { View as V } from 'react-native'; export default () => <V className="bg-bg" />`
    writeFileSync(filename, source)

    writeFileSync(cssPath, `@import 'tailwindcss';\n@theme { --color-bg: #ff0000; }\n`)
    await transform({ filename, src: source, options: { projectRoot } })
    const before = readFileSync(commonFile, 'utf8')
    expect(before).toContain('#ff0000')

    // User edits global.css — changes the color, does NOT touch any JS file.
    writeFileSync(cssPath, `@import 'tailwindcss';\n@theme { --color-bg: #00ff00; }\n`)

    // rnwind must notice the CSS change and rewrite scheme files so Metro's
    // file-watcher propagates the update to the app. This asserts the
    // state's `refreshTheme` (or equivalent) rewrites on CSS edit.
    await onThemeChange(projectRoot)

    const after = readFileSync(commonFile, 'utf8')
    expect(after).toContain('#00ff00')
    expect(after).not.toContain('#ff0000')
  })
})
