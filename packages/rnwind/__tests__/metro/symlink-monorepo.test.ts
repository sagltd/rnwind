import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import generateModule from '@babel/generator'
import { configureRnwindState, resetRnwindState } from '../../src/metro/state'
import { transform } from '../../src/metro/transformer'

const generate = (generateModule as unknown as { default?: typeof generateModule }).default ?? generateModule

/**
 * Regression: monorepo packages symlinked into `node_modules` (yarn /
 * pnpm / bun workspaces) used to be skipped by the transformer's
 * `/node_modules/` filter. The REAL file lives under `packages/<name>`,
 * but Metro hands the transformer the symlink path containing
 * `/node_modules/<name>/...` — so the cheap "is this a third-party
 * install?" guard saw `/node_modules/` and bailed. Result: every JSX
 * `className=` in a workspace UI package was passed straight to the
 * upstream babel pipeline untouched, so the user saw "ui components are
 * not styled" even though oxide had successfully scanned them and the
 * atoms were sitting in the registry.
 *
 * Setup mirrors the user's mobile-expanse layout:
 *  - `<root>/packages/ui/src/View.tsx` — the real workspace file.
 *  - `<root>/node_modules/ui` → symlink to `../packages/ui`.
 *  - `transform()` is called with the symlinked path; realpath points
 *    at the workspace folder, so the transformer MUST run.
 */
describe('transformer — workspace packages symlinked into node_modules', () => {
  let root: string
  let cssPath: string
  let cacheDir: string

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'rnwind-symlink-'))
    mkdirSync(path.join(root, 'packages', 'ui', 'src'), { recursive: true })
    mkdirSync(path.join(root, 'node_modules'), { recursive: true })
    symlinkSync(path.join(root, 'packages', 'ui'), path.join(root, 'node_modules', 'ui'), 'dir')
    // realpath() needs the file to exist on disk — write the workspace source.
    writeFileSync(
      path.join(root, 'packages', 'ui', 'src', 'View.tsx'),
      `import { View } from 'react-native'\nexport default () => <View className="p-4" />`,
    )
    cssPath = path.join(root, 'theme.css')
    writeFileSync(cssPath, `@import 'tailwindcss';\n`)
    cacheDir = path.join(root, '.rnwind-cache')
    configureRnwindState(cssPath, cacheDir)
  })

  afterAll(() => {
    resetRnwindState()
    rmSync(root, { recursive: true, force: true })
  })

  it('transforms a workspace file accessed via the node_modules symlink path', async () => {
    const symlinkedFilename = path.join(root, 'node_modules', 'ui', 'src', 'View.tsx')
    const source = `import { View } from 'react-native'\nexport default () => <View className="p-4" />`
    const result = await transform({ filename: symlinkedFilename, src: source, options: { projectRoot: root } })
    const {code} = generate(result.ast)
    expect(code).not.toContain('className=')
    expect(code).toMatch(/style=\{_l\(/)
  })

  it('still skips a real third-party package install (path AND realpath under node_modules)', async () => {
    const realThirdParty = path.join(root, 'node_modules', 'some-real-pkg', 'index.tsx')
    mkdirSync(path.dirname(realThirdParty), { recursive: true })
    writeFileSync(realThirdParty, `import { View } from 'react-native'\nexport default () => <View className="p-4" />`)
    const source = `import { View } from 'react-native'\nexport default () => <View className="p-4" />`
    const result = await transform({ filename: realThirdParty, src: source, options: { projectRoot: root } })
    const {code} = generate(result.ast)
    // True install — bypassed; className stays raw.
    expect(code).toContain('className="p-4"')
    expect(code).not.toMatch(/style=\{_l\(/)
  })
})
