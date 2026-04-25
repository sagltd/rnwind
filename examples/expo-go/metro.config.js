const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')
const { withRnwindConfig } = require('rnwind/metro')

const config = getDefaultConfig(__dirname)

module.exports = withRnwindConfig(config, {
  cssEntryFile: path.resolve(__dirname, 'global.css'),
  cacheDir: path.resolve(__dirname, '.rnwind'),
  maxChunkBytes: 10 * 1024, // 100 KB
  classNamePrefixes: ['omg'],
})
