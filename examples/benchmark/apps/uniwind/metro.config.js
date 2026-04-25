const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')
const { withUniwindConfig } = require('uniwind/metro')

const workspaceRoot = path.resolve(__dirname, '../../../..')
const config = getDefaultConfig(__dirname)
config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules'), path.resolve(workspaceRoot, 'node_modules')]

// uniwind joins cssEntryFile against `process.cwd()`, so it MUST be a path
// relative to the app directory — not an absolute path.
module.exports = withUniwindConfig(config, { cssEntryFile: './global.css' })
