import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  __setLibraryFingerprintForTest,
  configureRnwindState,
  getRnwindState,
  resetRnwindState,
} from '../../src/metro/state'

/**
 * Stability regression: the in-memory rebuild guard in `getRnwindState`
 * reused the cached builder whenever the CSS hash matched — but it ignored
 * the library fingerprint. Upgrading rnwind in-place WITHOUT touching the
 * theme CSS therefore kept a stale builder / stale on-disk scheme format
 * alive for the process. The guard must also rebuild when the library
 * fingerprint changes, mirroring `getRnwindCacheKey`.
 */
let root: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'rnwind-rebuild-fp-'))
  const cssPath = path.join(root, 'global.css')
  writeFileSync(cssPath, `@import 'tailwindcss';`)
  configureRnwindState(cssPath, path.join(root, '.rnwind'))
})

afterEach(() => {
  resetRnwindState()
  __setLibraryFingerprintForTest()
  rmSync(root, { recursive: true, force: true })
})

describe('getRnwindState rebuild guard folds in the library fingerprint', () => {
  it('reuses the cached state when nothing changed', () => {
    const first = getRnwindState(root)
    const second = getRnwindState(root)
    expect(second).toBe(first)
  })

  it('rebuilds when the library fingerprint changes even though the CSS hash is identical', () => {
    __setLibraryFingerprintForTest('aaaaaaaaaaaaaaaa')
    const first = getRnwindState(root)
    __setLibraryFingerprintForTest('bbbbbbbbbbbbbbbb')
    const second = getRnwindState(root)
    expect(second).not.toBe(first)
  })
})
