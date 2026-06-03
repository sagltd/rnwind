import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { getRnwindCacheKey } from '../../src/metro/state'

/**
 * Regression: the Metro cache key must change when the wrap-module config
 * changes, else Metro replays stale transforms — a newly-opted-in module
 * keeps its un-wrapped import, a removed one keeps the wrap.
 */
const WRAP_MODULES_ENV = 'RNWIND_WRAP_MODULES'

/** Reset the wrap-module env var so each test starts from a known key. */
function clear(): void {
  delete process.env[WRAP_MODULES_ENV]
}

beforeEach(clear)
afterEach(clear)

describe('getRnwindCacheKey — wrap-module config participates in the key', () => {
  it('flips when wrapModules change', () => {
    const before = getRnwindCacheKey()
    process.env[WRAP_MODULES_ENV] = '@acme/ui'
    expect(getRnwindCacheKey()).not.toBe(before)
  })

  it('flips again when more modules are added', () => {
    process.env[WRAP_MODULES_ENV] = '@acme/ui'
    const before = getRnwindCacheKey()
    process.env[WRAP_MODULES_ENV] = '@acme/ui,@acme/icons'
    expect(getRnwindCacheKey()).not.toBe(before)
  })
})
