import { createRequire } from 'node:module'
import path from 'node:path'
import nodeResolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import typescript from '@rollup/plugin-typescript'

const require = createRequire(import.meta.url)
const pkg = require('./package.json')

const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
])

const isExternal = (id) => {
  if (id.startsWith('node:')) return true
  if (declared.has(id)) return true
  for (const name of declared) {
    if (id === name || id.startsWith(`${name}/`)) return true
  }
  return false
}

const ENTRIES = {
  'runtime/index': 'src/runtime/index.ts',
  'metro/index': 'src/metro/index.ts',
  'metro/transformer': 'src/metro/transformer.ts',
  'testing/index': 'src/testing/index.ts',
}

/**
 * Single-pass preserve-modules build, one per format. Everything that `src/`
 * contains becomes its own output module so consumers tree-shake freely.
 * `src/runtime/index.ts` is the library's main entry; `src/metro/*` are the
 * Metro surface entries — all land under `lib/<format>/` mirroring the
 * source layout.
 *
 * Emits `.d.ts` alongside every `.mjs` / `.cjs` so TypeScript consumers get
 * module-level types for tree-shake-friendly imports.
 * @param outDir Output directory (e.g. `lib/esm`).
 * @param format Rollup output format (`'esm'` or `'cjs'`).
 * @returns Rollup config for this format.
 */
const preserveModulesConfig = (outDir, format) => {
  const extension = format === 'esm' ? 'mjs' : 'cjs'
  return {
    input: ENTRIES,
    external: isExternal,
    plugins: [
      json(),
      nodeResolve({ extensions: ['.ts', '.tsx', '.mjs', '.js'] }),
      commonjs(),
      typescript({
        tsconfig: path.resolve('./tsconfig.build.json'),
        declaration: true,
        declarationDir: outDir,
        outDir,
        sourceMap: true,
        inlineSources: true,
      }),
    ],
    output: {
      dir: outDir,
      format,
      sourcemap: true,
      exports: 'named',
      preserveModules: true,
      preserveModulesRoot: 'src',
      entryFileNames: `[name].${extension}`,
    },
  }
}

export default [preserveModulesConfig('lib/esm', 'esm'), preserveModulesConfig('lib/cjs', 'cjs')]
