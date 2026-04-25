/**
 * Post-process transformed CommonJS source so the bench can require it
 * outside jest/metro. Every library's output has `require("react-native")`
 * at some point, and the real RN package ships Flow syntax that Node's
 * CommonJS loader can't parse. We redirect to the bench's tiny shim
 * (`src/rn-shim.compiled.cjs`) which exposes the minimum host
 * components + `StyleSheet` API all four bench sources consume.
 *
 * rnwind additionally emits `require("rnwind/__generated/*")` virtual
 * module specifiers that Metro's resolver would normally map to disk.
 * Those redirects live in `transforms/rnwind.ts` — this helper handles
 * only the cross-library rewrites.
 */

import path from 'node:path'

const rnShimPath = path.resolve(__dirname, 'rn-shim.compiled.cjs')

/**
 * Rewrite every `require("react-native")` (and the common subpath
 * variant `require("react-native/...")`) to point at the compiled
 * bench shim. Symmetric across libraries so the measurement doesn't
 * bias one.
 * @param code Transformed source text.
 * @returns Source with RN requires redirected to the shim.
 */
export function redirectReactNative(code: string): string {
  const target = JSON.stringify(rnShimPath)
  return code
    .replaceAll(/require\(["']react-native["']\)/g, () => `require(${target})`)
    .replaceAll(/require\(["']react-native\/[^"']+["']\)/g, () => `require(${target})`)
}

/** Absolute path of the compiled RN shim on disk; tests build this once at startup. */
export const RN_SHIM_PATH: string = rnShimPath
