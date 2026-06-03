const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')
const { withRnwindConfig } = require('rnwind/metro')

const config = getDefaultConfig(__dirname)

module.exports = withRnwindConfig(config, {
  cssEntryFile: path.resolve(__dirname, 'global.css'),
  cacheDir: path.resolve(__dirname, '.rnwind'),
  // Opt extra component packages into the auto-wrap path (react-native +
  // the common ecosystem modules are wrapped by default):
  // wrapModules: ['@acme/ui'],
})
