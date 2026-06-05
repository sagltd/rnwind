import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { parse } from '@babel/parser'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configureRnwindState, resetRnwindState, transform } from '../../src/metro'
import { onThemeChange } from '../../src/metro/state'

let root: string

const common = (): string => {
  const f = path.join(root, '.rnwind', 'common.style.js')
  return existsSync(f) ? readFileSync(f, 'utf8') : '<none>'
}

/**
 * Write a source file and run it through the transformer once.
 * @param file Path relative to the temp project root.
 * @param source File contents.
 */
async function tx(file: string, source: string): Promise<void> {
  writeFileSync(path.join(root, file), source)
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  await transform({ filename: path.join(root, file), src: source, options: { projectRoot: root }, ast: ast as never })
}

/**
 * Overwrite the theme CSS, then run the watcher's theme-change handler.
 * @param css New theme CSS contents.
 */
async function editTheme(css: string): Promise<void> {
  writeFileSync(path.join(root, 'global.css'), css)
  await onThemeChange(root)
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'rnwind-theme-hmr-'))
})
afterEach(() => {
  resetRnwindState()
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

describe('theme.css edit propagates to common.style.js (dep-edge HMR)', () => {
  it('changing a custom token value rewrites the atom with the new color', async () => {
    writeFileSync(path.join(root, 'global.css'), `@import 'tailwindcss';\n@theme { --color-brand: #ef4444; }`)
    configureRnwindState(path.join(root, 'global.css'), path.join(root, '.rnwind'))
    await tx('A.tsx', `import {View} from 'react-native'\nexport default ()=><View className="bg-brand"/>`)
    expect(common().toLowerCase()).toContain('#ef4444')

    // Edit the theme token → the same atom must regenerate with the new value.
    await editTheme(`@import 'tailwindcss';\n@theme { --color-brand: #00ff00; }`)
    const after = common().toLowerCase()
    expect(after).toContain('#00ff00')
    expect(after).not.toContain('#ef4444')
  })

  it('adding a NEW token then using it resolves after a theme edit', async () => {
    writeFileSync(path.join(root, 'global.css'), `@import 'tailwindcss';\n@theme { --color-brand: #ef4444; }`)
    configureRnwindState(path.join(root, 'global.css'), path.join(root, '.rnwind'))
    await tx('A.tsx', `import {View} from 'react-native'\nexport default ()=><View className="bg-accent"/>`)
    // `--color-accent` doesn't exist yet → no concrete color for bg-accent.
    expect(common().toLowerCase()).not.toContain('#123456')

    await editTheme(`@import 'tailwindcss';\n@theme { --color-brand: #ef4444; --color-accent: #123456; }`)
    expect(common().toLowerCase()).toContain('#123456')
  })
})
