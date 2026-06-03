import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parse } from '@babel/parser'
import { resolveThemeCss } from '../../src/metro/css-imports'
import { TailwindParser, type RNStyle } from '../../src/core/parser'
import { configureRnwindState, resetRnwindState, transform } from '../../src/metro'

/**
 * Replicates meetelios' monorepo setup: the cssEntryFile (`global.css`)
 * is a one-liner that re-exports the real theme from a workspace package
 * via `@import "@scope/ui/theme.css"` (resolved through the package's
 * `exports` map). The theme — with the `@custom-variant` / `@theme` /
 * `@variant` declarations — lives entirely behind that import.
 *
 * Without `@import` flattening, rnwind's text-based scheme extractors see
 * only the bare import line → no schemes → every themed colour collapses
 * into the base `common` bucket and OS light/dark stops switching.
 */
const THEME_CSS = `@import 'tailwindcss';
@import 'rnwind/css';
@custom-variant light (&:where(.scheme-light, .scheme-light *));
@custom-variant dark (&:where(.scheme-dark, .scheme-dark *));
@theme {
  --color-bg: #ffffff;
  --color-primary: #4f46e5;
}
@layer theme {
  :root {
    @variant dark {
      --color-bg: #0a0a0a;
      --color-primary: #6366f1;
    }
  }
}`

let projectRoot: string
let entry: string

beforeEach(() => {
  projectRoot = mkdtempSync(path.join(tmpdir(), 'rnwind-import-'))
  // node_modules/@scope/ui with an `exports` map pointing `./theme.css`
  // at a nested file — exactly meetelios' `@meetelios/ui` shape.
  const pkgDir = path.join(projectRoot, 'node_modules', '@scope', 'ui')
  mkdirSync(path.join(pkgDir, 'src', 'theme'), { recursive: true })
  writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: '@scope/ui', exports: { './theme.css': './src/theme/theme.css' } }),
  )
  writeFileSync(path.join(pkgDir, 'src', 'theme', 'theme.css'), THEME_CSS)
  // The cssEntryFile only re-exports the package theme.
  entry = path.join(projectRoot, 'global.css')
  writeFileSync(entry, `@import "@scope/ui/theme.css";\n`)
})

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('resolveThemeCss — flattens user @imports behind the cssEntryFile', () => {
  it('inlines a package import resolved through its exports map', () => {
    const resolved = resolveThemeCss(entry)
    expect(resolved).toContain('@custom-variant light')
    expect(resolved).toContain('@custom-variant dark')
    expect(resolved).toContain('@variant dark')
    expect(resolved).toContain('--color-bg: #0a0a0a')
    // Framework imports stay for the compiler to resolve.
    expect(resolved).toContain(`@import 'tailwindcss'`)
    expect(resolved).toContain(`@import 'rnwind/css'`)
    // The bare re-export line is gone (it was flattened).
    expect(resolved).not.toContain('@scope/ui/theme.css')
  })

  it('lets the parser detect both schemes from the imported theme', async () => {
    const parser = new TailwindParser({ themeCss: resolveThemeCss(entry) })
    expect([...parser.declaredSchemes].toSorted((a, b) => a.localeCompare(b))).toEqual(['dark', 'light'])

    const out = await parser.parseAtoms({ content: '<V className="bg-bg" />', extension: 'tsx' })
    const bucket = out.atoms.get('bg-bg') as Record<string, RNStyle> | undefined
    expect(bucket).toEqual({
      light: { backgroundColor: '#ffffff' },
      dark: { backgroundColor: '#0a0a0a' },
    })
  })

  it('contrast: the un-resolved entry alone yields no schemes (the bug)', async () => {
    // Proves the import is load-bearing — reading the entry raw (what the
    // code did before) collapses everything to base.
    const parser = new TailwindParser({ themeCss: `@import "@scope/ui/theme.css";` })
    expect(parser.declaredSchemes).toEqual(['base'])
  })
})

describe('full pipeline (meetelios shape) — transform writes real per-scheme files', () => {
  afterEach(() => {
    resetRnwindState()
  })

  it('themed atoms land in light/dark scheme files, not frozen in common', async () => {
    const cacheDir = path.join(projectRoot, '.rnwind')
    // cssEntryFile = the bare re-export, exactly like meetelios' global.css.
    configureRnwindState(entry, cacheDir)

    const source = `import { View } from "react-native"
      export default function Index() { return <View className="flex-1 bg-bg">x</View> }`
    const filename = path.join(projectRoot, 'index.tsx')
    writeFileSync(filename, source)
    await transform({
      filename,
      src: source,
      options: { projectRoot },
      ast: parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) as never,
    })

    // The regression symptom was: only common.style.js, bg-bg frozen there.
    expect(existsSync(path.join(cacheDir, 'light.style.js'))).toBe(true)
    expect(existsSync(path.join(cacheDir, 'dark.style.js'))).toBe(true)
    const light = readFileSync(path.join(cacheDir, 'light.style.js'), 'utf8')
    const dark = readFileSync(path.join(cacheDir, 'dark.style.js'), 'utf8')
    const common = readFileSync(path.join(cacheDir, 'common.style.js'), 'utf8')
    expect(light).toContain('"bg-bg"')
    expect(light).toContain('#ffffff')
    expect(dark).toContain('"bg-bg"')
    expect(dark).toContain('#0a0a0a')
    // bg-bg is themed → must NOT be frozen in the scheme-uniform common file.
    expect(common).not.toContain('"bg-bg"')
    // Layout atoms stay in common (scheme-agnostic).
    expect(common).toContain('"flex-1"')
  })
})
