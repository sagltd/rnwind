import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resetRnwindState, withRnwindConfig, type MetroConfigLike } from '../../src/metro'

/**
 * Exercise the `withRnwindConfig` wrapper end-to-end: set env, install the
 * babel-transformer path, chain the virtual-style resolver, write the
 * `.d.ts`, add the cache dir to `watchFolders`.
 */

let projectRoot: string

/**
 * Upstream resolver stub — returns `{fallback: moduleName}` so tests can
 * verify the rnwind resolver chained correctly.
 * @param _ctx Metro resolve context (unused).
 * @param moduleName Specifier being resolved.
 * @returns Fallback sentinel.
 */
function fakeUpstream(_ctx: unknown, moduleName: string): unknown {
  return { fallback: moduleName }
}

beforeEach(() => {
  projectRoot = mkdtempSync(path.join(tmpdir(), 'rnwind-withcfg-'))
  const cssPath = path.join(projectRoot, 'theme.css')
  writeFileSync(
    cssPath,
    `@import 'tailwindcss';\n@layer theme {\n  :root {\n    @variant light { --color-bg: #fff; }\n    @variant dark { --color-bg: #000; }\n  }\n}\n`,
  )
})

afterEach(() => {
  resetRnwindState()
  if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true })
})

const baseConfig = (): MetroConfigLike => ({})

describe('withRnwindConfig', () => {
  it('installs the babel transformer path', () => {
    const cfg = withRnwindConfig(baseConfig(), {
      cssEntryFile: path.join(projectRoot, 'theme.css'),
      projectRoot,
      dtsFile: false,
    })
    expect(cfg.transformer?.babelTransformerPath).toBeString()
    expect(cfg.transformer?.babelTransformerPath).toContain('transformer')
  })

  it('adds the cache dir to watchFolders once', () => {
    const cfg = withRnwindConfig({ watchFolders: ['/some/extra'] } as MetroConfigLike, {
      cssEntryFile: path.join(projectRoot, 'theme.css'),
      projectRoot,
      cacheDir: path.join(projectRoot, '.custom-cache'),
      dtsFile: false,
    })
    expect(cfg.watchFolders).toContain(path.join(projectRoot, '.custom-cache'))
    expect(cfg.watchFolders).toContain('/some/extra')
  })

  it('chains resolveRequest — upstream hook is preserved when rnwind does not handle', () => {
    const cfg = withRnwindConfig({ resolver: { resolveRequest: fakeUpstream } } as MetroConfigLike, {
      cssEntryFile: path.join(projectRoot, 'theme.css'),
      projectRoot,
      dtsFile: false,
    })
    expect(cfg.resolver?.resolveRequest).toBeFunction()
    // Non-rnwind specifier falls through to upstream.
    const result = cfg.resolver!.resolveRequest!({} as never, 'react', null)
    expect(result).toMatchObject({ fallback: 'react' })
  })

  it('writes the .d.ts file at the default path', () => {
    withRnwindConfig(baseConfig(), {
      cssEntryFile: path.join(projectRoot, 'theme.css'),
      projectRoot,
    })
    const dtsPath = path.join(projectRoot, 'rnwind-types.d.ts')
    expect(existsSync(dtsPath)).toBe(true)
    const contents = readFileSync(dtsPath, 'utf8')
    expect(contents).toContain("declare module 'react-native'")
    expect(contents).toContain("themes: readonly ['light', 'dark']")
  })

  it('honors a custom dtsFile path', () => {
    const customDts = path.join(projectRoot, 'types', 'custom.d.ts')
    withRnwindConfig(baseConfig(), {
      cssEntryFile: path.join(projectRoot, 'theme.css'),
      projectRoot,
      dtsFile: customDts,
    })
    expect(existsSync(customDts)).toBe(true)
  })

  it('dtsFile=false skips the write', () => {
    withRnwindConfig(baseConfig(), {
      cssEntryFile: path.join(projectRoot, 'theme.css'),
      projectRoot,
      dtsFile: false,
    })
    expect(existsSync(path.join(projectRoot, 'rnwind-types.d.ts'))).toBe(false)
  })

  it('accepts an absolute cssEntryFile', () => {
    const abs = path.join(projectRoot, 'theme.css')
    const cfg = withRnwindConfig(baseConfig(), { cssEntryFile: abs, projectRoot, dtsFile: false })
    expect(cfg).toBeDefined()
  })

  it('falls back to process.cwd() when projectRoot is missing', () => {
    const cfg = withRnwindConfig(baseConfig(), {
      cssEntryFile: path.join(projectRoot, 'theme.css'),
      dtsFile: false,
    })
    expect(cfg).toBeDefined()
  })
})
