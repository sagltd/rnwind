import type { Config } from 'jest'

/**
 * Bench suite runs with jest because the three libraries under comparison
 * (rnwind, nativewind, react-native-unistyles) all publish their
 * babel/metro transforms and their test recipes against jest. We use the
 * `node` test environment (no jsdom, no jest-expo preset) because the
 * perf loop measures pure-JS work — `@testing-library/react-native`'s
 * `render` mounts components without needing the RN native bridge.
 *
 * `--runInBand --no-cache` (set via the package.json script) guarantees
 * no parallelism and no stale jest transform cache skews results.
 */
const config: Config = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/__tests__/**/*.test.ts', '<rootDir>/__tests__/**/*.test.tsx'],
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': [
      'babel-jest',
      {
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          ['@babel/preset-react', { runtime: 'automatic' }],
          '@babel/preset-typescript',
        ],
      },
    ],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  // react-native resolves to its .js entry which pulls Flow-typed native code we
  // don't need for the perf loop. Map it to a minimal shim so both the transform
  // and render paths have the same "View / Text / StyleSheet" surface.
  moduleNameMapper: {
    '^react-native$': '<rootDir>/src/rn-shim.compiled.cjs',
    '^react-native/(.*)$': '<rootDir>/src/rn-shim.compiled.cjs',
  },
  setupFiles: ['<rootDir>/src/jest-globals.ts'],
  testTimeout: 60_000,
  verbose: false,
  reporters: ['default'],
}

export default config
