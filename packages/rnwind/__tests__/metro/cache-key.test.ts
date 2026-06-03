import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { getRnwindCacheKey } from '../../src/metro/state'

/**
 * Regression: the Metro cache key must change when host-source /
 * host-component config changes, else Metro replays stale transforms — a
 * newly-opted-in host keeps its un-rewritten `className`, a removed one
 * keeps the rewrite. (Found in the full review: the key mixed in the
 * className-prefix env but not the two host envs.)
 */
const HOST_SOURCES_ENV = 'RNWIND_HOST_SOURCES'
const HOST_COMPONENTS_ENV = 'RNWIND_HOST_COMPONENTS'

/** Reset the host-config env vars so each test starts from a known key. */
function clear(): void {
  delete process.env[HOST_SOURCES_ENV]
  delete process.env[HOST_COMPONENTS_ENV]
}

beforeEach(clear)
afterEach(clear)

describe('getRnwindCacheKey — host config participates in the key', () => {
  it('flips when hostSources change', () => {
    const before = getRnwindCacheKey()
    process.env[HOST_SOURCES_ENV] = '@acme/ui'
    expect(getRnwindCacheKey()).not.toBe(before)
  })

  it('flips when hostComponents change', () => {
    const before = getRnwindCacheKey()
    process.env[HOST_COMPONENTS_ENV] = 'MyBox,Animated.View'
    expect(getRnwindCacheKey()).not.toBe(before)
  })
})
