import { mock } from 'bun:test'

/**
 * Bun cannot parse React Native's runtime entry (it contains Flow-only
 * `import typeof` syntax), and no native runtime is available inside Bun's
 * test VM anyway. This preload substitutes the `react-native` module with a
 * minimal JS-only stub that satisfies the handful of APIs rnwind's runtime
 * actually touches at test time.
 *
 * Tests that need scheme-specific behaviour from `useColorScheme` can override
 * it via `globalThis.__RNWIND_TEST_COLOR_SCHEME` (null by default, meaning
 * `useColorScheme()` returns null and `useResolvedStyles` falls back to
 * `'light'`).
 */

// `react-test-renderer@19` prints a `console.error("react-test-renderer
// is deprecated...")` from its `create()` export, gated behind
// `global.IS_REACT_NATIVE_TEST_ENVIRONMENT !== true`. Setting the flag
// is React's intended opt-out for RN test harnesses (see RTR source at
// node_modules/react-test-renderer/cjs/react-test-renderer.development.js:14599).
// Without it Bun's test output is dominated by the banner.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_NATIVE_TEST_ENVIRONMENT: boolean | undefined
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_NATIVE_TEST_ENVIRONMENT = true
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// React 19's `act()` from react-test-renderer doesn't always flush a
// `useState` setter synchronously in Bun's test VM — even when the
// caller wraps the setter in `act(() => onPressIn(...))`, the
// follow-up render fires AFTER `act` returns, and React surfaces a
// "not wrapped in act" warning. The tests themselves are correct
// (assertions read the post-flush state); the noise is purely a
// scheduling-edge mismatch between RTR's act-batcher and Bun. We
// filter just the one banner so test output stays signal.
const originalError = console.error.bind(console)
console.error = (...args: unknown[]): void => {
  const first = args[0]
  if (typeof first === 'string' && first.includes('was not wrapped in act')) return
  originalError(...args)
}

declare global {
  // eslint-disable-next-line no-var
  var __RNWIND_TEST_COLOR_SCHEME: 'light' | 'dark' | null | undefined
  // eslint-disable-next-line no-var
  var __RNWIND_TEST_WINDOW_DIMENSIONS: { width?: number; height?: number; fontScale?: number; scale?: number } | undefined
}

globalThis.__RNWIND_TEST_COLOR_SCHEME = null
globalThis.__RNWIND_TEST_WINDOW_DIMENSIONS = undefined

mock.module('react-native', () => ({
  useColorScheme: () => globalThis.__RNWIND_TEST_COLOR_SCHEME ?? null,
  useWindowDimensions: () => ({
    width: globalThis.__RNWIND_TEST_WINDOW_DIMENSIONS?.width ?? 375,
    height: globalThis.__RNWIND_TEST_WINDOW_DIMENSIONS?.height ?? 812,
    fontScale: globalThis.__RNWIND_TEST_WINDOW_DIMENSIONS?.fontScale ?? 1,
    scale: globalThis.__RNWIND_TEST_WINDOW_DIMENSIONS?.scale ?? 2,
  }),
  View: 'RNView',
  Text: 'RNText',
  Pressable: 'RNPressable',
  ScrollView: 'RNScrollView',
  StyleSheet: {
    create: <T>(styles: T) => styles,
    flatten: <T>(style: T) => style,
    hairlineWidth: 1,
    absoluteFill: {},
    absoluteFillObject: {},
  },
}))
