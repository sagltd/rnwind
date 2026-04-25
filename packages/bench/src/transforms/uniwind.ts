/**
 * Uniwind transform wrapper.
 *
 * Uniwind is architecturally different from rnwind/NativeWind: it does
 * not rewrite JSX call sites at build time. The Uniwind metro transform
 * only compiles the CSS entry into a virtual module that registers
 * styles with the Uniwind runtime; user source files go through
 * `metro-transform-worker` unchanged. At render time, `withUniwind(View)`
 * reads `className` as a prop and resolves styles through
 * `UniwindStore.getStyles(...)`.
 *
 * For the bench we therefore:
 *   1. Run the user source through a stock babel pipeline (preset-env +
 *      preset-react + preset-typescript) — the same cost Metro would pay
 *      when Uniwind hands the file through to its worker.
 *   2. Assert the `withUniwind` HOC usage the fixture expects is still
 *      present in the output.
 *
 * All of Uniwind's real work shows up in the render scenarios instead.
 */

import path from 'node:path'
import { transformSync } from '@babel/core'
import { uniwindSource } from '../../fixtures/card.source'
import { uniwindListSource } from '../../fixtures/list.source'
import { assertTransformOutput } from '../assert-transform'

const fixtureFilename = path.resolve(__dirname, '..', '..', 'fixtures', 'Card.uniwind.tsx')
const listFixtureFilename = path.resolve(__dirname, '..', '..', 'fixtures', 'List.uniwind.tsx')

/**
 * Run the stock babel pipeline against the Uniwind fixture source. The
 * Uniwind metro transformer adds zero extra work for JS files — this is
 * the honest build-time cost for Uniwind-using apps.
 * @returns Transformed CommonJS source string.
 */
export async function transformUniwind(): Promise<string> {
  return runUniwindTransform(fixtureFilename, uniwindSource)
}

/**
 * Produce the Uniwind-transformed CJS for the shared List fixture —
 * same stock babel pipeline, since Uniwind does not rewrite JSX.
 * @returns Transformed CommonJS source string.
 */
export async function transformUniwindList(): Promise<string> {
  return runUniwindTransform(listFixtureFilename, uniwindListSource)
}

/**
 * Shared body for Card + List Uniwind transforms.
 * @param filename Source filename for babel source-map parity.
 * @param source Full fixture source text.
 * @returns Transformed CommonJS source.
 */
function runUniwindTransform(filename: string, source: string): string {
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
  if (!result?.code) throw new Error('uniwind: babel returned no code')
  assertTransformOutput('uniwind', result.code, ['withUniwind'])
  return result.code
}
