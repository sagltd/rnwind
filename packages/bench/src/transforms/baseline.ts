/**
 * Baseline transform — zero-library React Native.
 *
 * The baseline fixture is plain RN with `StyleSheet.create` at module
 * scope; the only build-time work needed is what every RN app pays:
 * strip TypeScript, lower JSX, lower syntax. The bench uses the same
 * preset stack every other library composes on top of, so the delta
 * between a library and the baseline is exactly the cost that library
 * adds on top of raw RN.
 */

import path from 'node:path'
import { transformSync } from '@babel/core'
import { baselineCardSource, baselineListSource } from '../../fixtures/baseline.source'
import { assertTransformOutput } from '../assert-transform'

const cardFixtureFilename = path.resolve(__dirname, '..', '..', 'fixtures', 'Card.baseline.tsx')
const listFixtureFilename = path.resolve(__dirname, '..', '..', 'fixtures', 'List.baseline.tsx')

/**
 * Run the baseline babel pipeline on the Card fixture.
 * @returns Transformed CommonJS source.
 */
export async function transformBaseline(): Promise<string> {
  return runBaselineTransform(cardFixtureFilename, baselineCardSource)
}

/**
 * Run the baseline babel pipeline on the List fixture.
 * @returns Transformed CommonJS source.
 */
export async function transformBaselineList(): Promise<string> {
  return runBaselineTransform(listFixtureFilename, baselineListSource)
}

/**
 * Shared transform body — standard preset stack, no library plugins.
 * @param filename Source filename — fed to babel for source-map parity.
 * @param source Full fixture source text.
 * @returns Transformed CommonJS source.
 */
function runBaselineTransform(filename: string, source: string): string {
  const result = transformSync(source, {
    filename,
    presets: [
      ['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }],
      ['@babel/preset-react', { runtime: 'automatic' }],
      '@babel/preset-typescript',
    ],
    babelrc: false,
    configFile: false,
  })
  if (!result?.code) throw new Error('baseline: babel returned no code')
  // The baseline output must reference `StyleSheet.create` — nothing else
  // exercises the per-library hot path the bench cares about.
  assertTransformOutput('baseline', result.code, ['StyleSheet'])
  return result.code
}
