import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * The cache key must include a `lib:<hex>` segment derived from the
 * rnwind library's installed code. When the library is rebuilt
 * (workspace dev OR npm install of a new version), the segment
 * rotates, Metro's transform cache invalidates, and a fresh
 * `style.js` is regenerated — preventing stale atom shapes from a
 * previous library from persisting through a hot reload.
 */
describe('cache key bakes a rnwind library-fingerprint segment', () => {
  let temporary: string

  beforeEach(() => {
    temporary = mkdtempSync(path.join(tmpdir(), 'rnwind-fp-'))
    const cssPath = path.join(temporary, 'global.css')
    writeFileSync(cssPath, "@import 'tailwindcss';")
    process.env.RNWIND_CSS_ENTRY_FILE = cssPath
    process.env.RNWIND_CACHE_DIR = temporary
  })

  afterEach(() => {
    delete process.env.RNWIND_CSS_ENTRY_FILE
    delete process.env.RNWIND_CACHE_DIR
    rmSync(temporary, { recursive: true, force: true })
  })

  it('includes a "lib:<hex>" segment so library upgrades rotate the cache key', async () => {
    delete require.cache[require.resolve('../../src/metro/state')]
    const { getRnwindCacheKey } = await import('../../src/metro/state')
    const key = getRnwindCacheKey()
    expect(key).toMatch(/\blib:[a-f0-9]{8,}/)
  })
})
