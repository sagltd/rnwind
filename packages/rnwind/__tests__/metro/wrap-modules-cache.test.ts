import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configureRnwindState, getWrapModules, resetRnwindState } from '../../src/metro/state'

/**
 * Perf regression: `getWrapModules()` rebuilt an 11-entry Map on EVERY file
 * transform even though the wrap-module env var never changes mid-session.
 * The result must be cached module-scoped and only rebuilt after a config
 * reset (`configureRnwindState` / `resetRnwindState`). A configured extra
 * module forces `buildWrapModules` to mint a NEW Map each call, so the cache
 * (vs. a per-call rebuild) is observable by reference identity.
 */
let root: string

/**
 * Configure state with one extra wrap module so each rebuild yields a new Map.
 * @param extra
 */
function configureWith(extra: readonly string[]): void {
  writeFileSync(path.join(root, 'global.css'), `@import 'tailwindcss';`)
  configureRnwindState(path.join(root, 'global.css'), path.join(root, '.rnwind'), [], extra)
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'rnwind-wm-cache-'))
  configureWith(['@acme/ui'])
})

afterEach(() => {
  resetRnwindState()
  rmSync(root, { recursive: true, force: true })
})

describe('getWrapModules caches its Map until a reset', () => {
  it('returns the same Map reference across calls', () => {
    const first = getWrapModules()
    const second = getWrapModules()
    expect(second).toBe(first)
    expect(first.has('@acme/ui')).toBe(true)
  })

  it('rebuilds a fresh Map after resetRnwindState', () => {
    const before = getWrapModules()
    resetRnwindState()
    const after = getWrapModules()
    expect(after).not.toBe(before)
  })

  it('rebuilds when configureRnwindState changes the wrap modules', () => {
    const before = getWrapModules()
    configureWith(['@acme/ui', '@acme/icons'])
    const after = getWrapModules()
    expect(after).not.toBe(before)
    expect(after.has('@acme/icons')).toBe(true)
  })
})
