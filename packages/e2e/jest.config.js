const path = require('node:path')

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/__tests__/rn/**/*.test.@(ts|tsx)'],
  rootDir: __dirname,
  // Workspace-hoisted node_modules (bun stores deps in `<repo>/node_modules/.bun/...`)
  // lives two levels up. Jest by default refuses to execute files outside `rootDir`.
  roots: ['<rootDir>', path.resolve(__dirname, '..', '..')],
  modulePaths: [path.resolve(__dirname, '..', '..', 'node_modules')],
  // Bun installs packages into `.bun/<pkg>@<ver>/node_modules/<pkg>`. Allow
  // anything containing react-native / expo / jest-expo / rnwind through
  // babel transform regardless of where in the path it lives.
  transformIgnorePatterns: [
    'node_modules/(?!.*(react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|jest-expo|react-navigation|@react-navigation|@sentry/react-native|native-base|rnwind))',
  ],
}
