/**
 * NativeWind transform wrapper. Runs NativeWind's official babel preset
 * — which is just `react-native-css-interop/babel` under the hood —
 * against the shared bench fixture, then the standard JSX + TS preset
 * stack so the output is requireable CommonJS.
 *
 * The preset rewrites `<View className="…" />` call sites to wrap in
 * NativeWind's `createInteropElement` (`react-native-css-interop`'s JSX
 * runtime), which is the code-path every NativeWind app actually hits
 * on render.
 */

import path from 'node:path'
import { transformSync } from '@babel/core'
import { nativewindSource } from '../../fixtures/card.source'
import { nativewindListSource } from '../../fixtures/list.source'
import { assertTransformOutput } from '../assert-transform'

const fixtureFilename = path.resolve(__dirname, '..', '..', 'fixtures', 'Card.nativewind.tsx')
const listFixtureFilename = path.resolve(__dirname, '..', '..', 'fixtures', 'List.nativewind.tsx')

/**
 * Run the NativeWind babel pipeline on the shared fixture. Uses
 * `automatic` JSX runtime so the output references the NativeWind-
 * shipped `react/jsx-runtime` (which NativeWind remaps via its preset),
 * matching how apps consume it.
 * @returns Transformed CommonJS source string.
 */
export async function transformNativewind(): Promise<string> {
  return runNativewindTransform(fixtureFilename, nativewindSource)
}

/**
 * Produce the NativeWind-transformed CJS for the shared List fixture.
 * Uses the same preset stack as {@link transformNativewind} — the
 * measured cost per iteration is apples-to-apples across scenarios.
 * @returns Transformed CommonJS source string.
 */
export async function transformNativewindList(): Promise<string> {
  return runNativewindTransform(listFixtureFilename, nativewindListSource)
}

/**
 * Shared body for Card + List NativeWind transforms.
 * @param filename Source filename for babel source-map parity.
 * @param source Full fixture source text.
 * @returns Transformed CommonJS source.
 */
function runNativewindTransform(filename: string, source: string): string {
  // NativeWind's preset already does the JSX transform (importing from
  // `react-native-css-interop/jsx-runtime`). Do NOT add `@babel/preset-react`
  // — it would override NativeWind's importSource and silently break the
  // measurement. Order matters: Babel applies presets in reverse, so
  // `preset-typescript` (reverse-last) strips types, then preset-env
  // lowers syntax, then `nativewind/babel` does its own JSX rewrite.
  const result = transformSync(source, {
    filename,
    presets: [
      'nativewind/babel',
      ['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }],
      '@babel/preset-typescript',
    ],
    babelrc: false,
    configFile: false,
  })
  if (!result?.code) throw new Error('nativewind: babel returned no code')
  // NativeWind v4 rewrites JSX call sites to import from
  // `react-native-css-interop/jsx-runtime`. If that import doesn't
  // appear, the preset didn't fire and the number would be bogus.
  assertTransformOutput('nativewind', result.code, ['react-native-css-interop'])
  return result.code
}
