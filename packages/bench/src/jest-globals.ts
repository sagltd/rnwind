/**
 * Globals each library expects to exist in a React Native environment.
 * Jest runs under Node, which doesn't define `__DEV__` or other RN-flag
 * globals — without this setup, uniwind's HOC and nativewind's runtime
 * throw ReferenceErrors that React swallows (rendering `null`).
 *
 * Kept minimal and symmetric: the bench never sets a library-specific
 * flag that could favour one library over another.
 */

// NODE_ENV=production in the bench, so __DEV__ is false — mirrors what
// a production RN bundle sees and skips any dev-only logging overhead.
;(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false
// React 19's test renderer logs a noisy warning unless this flag is set —
// it signals that act()-wrapped updates are the test-environment contract.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
