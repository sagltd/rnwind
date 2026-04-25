/**
 * In-process evaluation of transformed library output.
 *
 * Each bench scenario transforms the fixture once, then mounts the
 * resulting module. The module must load exactly the way it would in a
 * real app — Node's CommonJS require, so each library's runtime
 * (`rnwind/lookupCss`, `nativewind/css-interop`, uniwind's `withUniwind`)
 * is resolved through the real module graph. No `eval` / `new Function`.
 *
 * Strategy: write transformed source to a unique temp file under
 * `.cache/bench-eval/`, scrub that path from `require.cache`, then
 * require it. Equal treatment across all three libraries keeps the
 * timing honest.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { redirectReactNative } from './rewrite-requires'

/** Directory temp modules are written into; scoped under the bench package. */
const cacheRoot = path.resolve(__dirname, '..', '.cache', 'bench-eval')

/** CJS require bound to the bench package so evaluated modules resolve here. */
const benchRequire = createRequire(path.join(__dirname, '..', 'package.json'))

/**
 * Materialise `source` to disk, clear any cached require for the path,
 * then require it. Subsequent calls with the same `(name, source)` pair
 * reuse the same file — one slot per logical module per library.
 * @param name Stable identifier (e.g. `rnwind-card`). Becomes part of the filename.
 * @param source Already-transformed JS (CommonJS).
 * @returns The required module's `module.exports`.
 */
export function evaluateTransformed(name: string, source: string): unknown {
  mkdirSync(cacheRoot, { recursive: true })
  // Redirect `require("react-native")` to the bench shim so Node's
  // CommonJS loader doesn't try to parse the real RN package's Flow
  // syntax. Equal treatment for every library — the same redirect is
  // applied to all three transform outputs.
  const rewritten = redirectReactNative(source)
  // sha256 slice — used only as a unique filename, not a security primitive,
  // but sonarjs still flags the sha1/md5 shortcuts so we use sha256.
  const hash = createHash('sha256').update(rewritten).digest('hex').slice(0, 12)
  const file = path.join(cacheRoot, `${name}.${hash}.js`)
  writeFileSync(file, rewritten, 'utf8')
  // Drop any previous require of this exact path so a fresh evaluation
  // runs on every call — otherwise Node's module cache would return the
  // first-loaded version even across re-transforms.
  delete benchRequire.cache[file]
  return benchRequire(file)
}

/**
 * Pull the default export out of a required module, handling the
 * interop shape babel's preset-env emits (`__esModule: true, default:
 * Component`).
 * @param module_ Required module.
 * @returns Default export.
 */
export function pickDefault(module_: unknown): unknown {
  if (module_ && typeof module_ === 'object' && 'default' in (module_ as { default?: unknown })) {
    return (module_ as { default: unknown }).default
  }
  return module_
}
