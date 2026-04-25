import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configureRnwindState, createRnwindResolver, resetRnwindState } from '../../src/metro'

/**
 * Verify the resolver recognises the `rnwind/__generated/style`
 * specifier and maps it to the union `style.js` under the configured
 * cacheDir. Non-matching specifiers must fall through to the upstream.
 */

let projectRoot: string
let cacheDir: string

/**
 * Minimal upstream resolver stub — returns `{fallback: moduleName}` so
 * tests can verify the rnwind resolver delegated correctly.
 * @param _ctx Metro's resolve context (unused).
 * @param moduleName The module specifier being resolved.
 * @returns Resolution-result sentinel.
 */
function fakeUpstream(_ctx: unknown, moduleName: string): unknown {
  return { fallback: moduleName }
}

beforeEach(() => {
  projectRoot = mkdtempSync(path.join(tmpdir(), 'rnwind-res-'))
  cacheDir = path.join(projectRoot, '.cache')
  const cssPath = path.join(projectRoot, 'theme.css')
  writeFileSync(cssPath, `@import 'tailwindcss';`)
  configureRnwindState(cssPath, cacheDir)
})

afterEach(() => {
  resetRnwindState()
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('createRnwindResolver', () => {
  it('intercepts rnwind/__generated/schemes → manifest module', () => {
    const resolve = createRnwindResolver(null)
    const result = resolve({} as never, 'rnwind/__generated/schemes', null)
    expect(result).toMatchObject({
      type: 'sourceFile',
      filePath: path.join(cacheDir, 'schemes.js'),
    })
  })

  it('falls back to upstream when specifier does not match', () => {
    const resolve = createRnwindResolver(fakeUpstream)
    const result = resolve({} as never, 'react', null)
    expect(result).toMatchObject({ fallback: 'react' })
  })

  it('returns undefined when upstream is null and specifier is not rnwind', () => {
    const resolve = createRnwindResolver(null)
    const result = resolve({} as never, 'react', null)
    expect(result == null).toBe(true)
  })
})
