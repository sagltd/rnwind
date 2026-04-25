/**
 * rnwind transform wrapper. Drives rnwind's real Metro babel transformer
 * (`rnwind/metro/transformer`) against the shared bench fixture, then
 * feeds the rewritten source through `@babel/core` with a standard
 * JSX + TypeScript preset stack — exactly what Metro does upstream.
 *
 * The separation matters: rnwind's transformer OWNS the JSX rewrite
 * (`<View className="…" />` → `<View style={lookupCss(…)} />`) and then
 * hands the rewritten source to whatever `babelTransformerPath` Metro
 * originally had. For a fair bench we run the same second step so the
 * `react/jsx-runtime` calls + TS stripping cost counts for rnwind too.
 */

import path from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { transformFromAstSync, transformSync } from '@babel/core'
import generate from '@babel/generator'
import { transform as rnwindTransform } from 'rnwind/metro/transformer'
import { configureRnwindState } from 'rnwind/metro'
import { rnwindSource } from '../../fixtures/card.source'
import { rnwindListSource } from '../../fixtures/list.source'
import { assertTransformOutput } from '../assert-transform'
import { redirectReactNative } from '../rewrite-requires'

const cacheDir = path.resolve(__dirname, '..', '..', '.cache', 'rnwind')
const styleFile = path.join(cacheDir, 'style.js')
const themeSignatureStub = path.join(cacheDir, 'theme-signature-stub.js')
const fixtureFilename = path.resolve(__dirname, '..', '..', 'fixtures', 'Card.rnwind.tsx')
let rnwindReady = false

/**
 * Stand up the shared rnwind state once. Points the transformer at a
 * synthetic theme CSS so `parseAtoms` has something to compile against
 * — the bench classes (`flex-1`, `p-4`, etc.) are all stock Tailwind v4
 * utilities, so we only need `@import 'tailwindcss'` in the theme.
 */
function ensureRnwindReady(): void {
  if (rnwindReady) return
  mkdirSync(cacheDir, { recursive: true })
  const themeFile = path.resolve(cacheDir, 'theme.css')
  // The transformer re-reads this file on every worker init — write it
  // once with a fixed content so the hash stays stable across runs.
  writeFileSync(themeFile, `@import 'tailwindcss';\n`, 'utf8')
  // A benign stub for the `rnwind/__generated/theme-signature` sentinel
  // that Metro normally resolves to an empty CSS-change-tracked module.
  writeFileSync(themeSignatureStub, 'module.exports = {}\n', 'utf8')
  configureRnwindState(themeFile, cacheDir)
  rnwindReady = true
}

/**
 * Replace Metro-virtual `rnwind/__generated/*` imports with absolute
 * disk paths so the module graph can be resolved by plain `require()`.
 * In a real Metro bundle these paths are served by rnwind's custom
 * resolver; in-process evaluation has no resolver, so we bake in the
 * on-disk path the ledger already wrote during flush.
 * @param code Transformed source text.
 * @returns Source with `rnwind/__generated/*` requires redirected.
 */
function rewriteGeneratedRequires(code: string): string {
  return code
    .replaceAll(/require\(["']rnwind\/__generated\/style["']\)/g, () => `require(${JSON.stringify(styleFile)})`)
    .replaceAll(
      /require\(["']rnwind\/__generated\/theme-signature["']\)/g,
      () => `require(${JSON.stringify(themeSignatureStub)})`,
    )
}

/**
 * rnwind's union `style.js` is emitted as an ES module
 * (`import { registerAtoms } from 'rnwind'` + maybe
 * `import { StyleSheet } from 'react-native'`). Node's CommonJS loader
 * can't `require()` it directly. After the ledger flushes, compile the
 * file into CJS with the bench's RN-redirect applied. Idempotent — an
 * already-compiled file is skipped.
 */
function compileStyleToCjs(): void {
  if (!existsSync(styleFile)) return
  const raw = readFileSync(styleFile, 'utf8')
  // `"use strict";` is what preset-env emits at the top — sentinel for already-compiled.
  if (raw.startsWith('"use strict"')) return
  const out = transformSync(raw, {
    filename: styleFile,
    presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]],
    babelrc: false,
    configFile: false,
  })
  if (!out?.code) return
  writeFileSync(styleFile, redirectReactNative(out.code), 'utf8')
}

/**
 * Run the full rnwind transform pipeline on the shared fixture source.
 * Returns the final bundled JS (post-`@babel/core` second pass), ready
 * for {@link evaluateTransformed}.
 * @returns Transformed CommonJS source string.
 */
export async function transformRnwind(): Promise<string> {
  return transformRnwindSource(fixtureFilename, rnwindSource)
}

/**
 * Produce the rnwind-transformed CJS for the shared List fixture. Used
 * by the list-render scenario; pipes through the same rnwind metro
 * transformer + babel second pass as the Card fixture so the measured
 * cost per iteration is apples-to-apples with the other scenarios.
 * @returns Transformed CommonJS source string.
 */
export async function transformRnwindList(): Promise<string> {
  const filename = path.resolve(__dirname, '..', '..', 'fixtures', 'List.rnwind.tsx')
  return transformRnwindSource(filename, rnwindListSource)
}

/**
 * Shared transform body for the Card + List fixtures.
 * @param filename Source filename — fed to babel for source-map parity.
 * @param source Full fixture source text.
 * @returns Transformed CommonJS source ready to hand to {@link evaluateTransformed}.
 */
async function transformRnwindSource(filename: string, source: string): Promise<string> {
  ensureRnwindReady()
  const { ast } = await rnwindTransform({
    filename,
    src: source,
    options: { projectRoot: path.resolve(__dirname, '..', '..') },
  })
  // The transformer handed us back a rewritten AST. Regenerate source
  // so the second-pass babel (preset-env + preset-react + preset-ts)
  // starts from a clean string — equivalent to Metro serialising the
  // AST across the worker boundary, which is the real path.
  const generateFn = (generate as unknown as { default?: typeof generate }).default ?? generate
  const rewrittenSource = generateFn(ast).code
  const fromAst = transformFromAstSync(ast, rewrittenSource, {
    filename,
    presets: [
      ['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }],
      ['@babel/preset-react', { runtime: 'automatic' }],
      '@babel/preset-typescript',
    ],
    babelrc: false,
    configFile: false,
  })
  if (!fromAst?.code) throw new Error('rnwind: babel returned no code')
  assertTransformOutput('rnwind', fromAst.code, ['lookupCss'])
  compileStyleToCjs()
  return rewriteGeneratedRequires(fromAst.code)
}
