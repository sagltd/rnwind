import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  __getThemeReadCount,
  __resetThemeMemo,
  configureRnwindState,
  getRnwindCacheKey,
  getRnwindState,
  resetRnwindState,
} from '../../src/metro/state'

/**
 * Perf regression: every `transform()` paid a full theme-CSS read +
 * `@import` inline + SHA-256, and the rebuild path read it a SECOND time.
 * The mtime-keyed memo must collapse those to ONE disk read until the file's
 * mtime changes, while a real CSS edit (mtime bump) still busts the cache so
 * correctness holds.
 */
let root: string
let cssPath: string

/**
 * Bump a path's mtime by `seconds` so the memo's stat check sees a change.
 * @param target
 * @param seconds
 */
function bumpMtime(target: string, seconds: number): void {
  const future = Date.now() / 1000 + seconds
  utimesSync(target, future, future)
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'rnwind-hash-memo-'))
  cssPath = path.join(root, 'global.css')
  writeFileSync(cssPath, `@import 'tailwindcss';\n@theme { --color-brand: #ef4444; }`)
  configureRnwindState(cssPath, path.join(root, '.rnwind'))
  __resetThemeMemo()
})

afterEach(() => {
  resetRnwindState()
  __resetThemeMemo()
  rmSync(root, { recursive: true, force: true })
})

describe('theme CSS read + hash are mtime-memoized', () => {
  it('hash is stable and reads disk only once across many calls with no FS change', () => {
    const before = __getThemeReadCount()
    const key1 = getRnwindCacheKey()
    const key2 = getRnwindCacheKey()
    getRnwindState(root)
    const key3 = getRnwindCacheKey()
    expect(key1).toBe(key2)
    expect(key2).toBe(key3)
    // First call reads once; everything after is served from the memo.
    expect(__getThemeReadCount() - before).toBe(1)
  })

  it('busts when the file mtime changes (real edit)', () => {
    const key1 = getRnwindCacheKey()
    const readsAfterFirst = __getThemeReadCount()
    writeFileSync(cssPath, `@import 'tailwindcss';\n@theme { --color-brand: #00ff00; }`)
    bumpMtime(cssPath, 5)
    const key2 = getRnwindCacheKey()
    expect(key2).not.toBe(key1)
    // The edit triggered a fresh disk read.
    expect(__getThemeReadCount()).toBeGreaterThan(readsAfterFirst)
  })
})
