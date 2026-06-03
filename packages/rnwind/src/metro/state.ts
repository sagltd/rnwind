import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { UnionBuilder } from '../core/style-builder'
import { TailwindParser, type SourceEntry } from '../core/parser'
import { resolveThemeCss } from './css-imports'

/**
 * Default oxide Scanner globs — walk every JS/TS source under the
 * project root AND every monorepo watch folder, excluding
 * `node_modules` and rnwind's own cache dir so we don't rescan
 * generated scheme files.
 *
 * Monorepo layouts (Yarn workspaces, pnpm workspaces, Nx) surface
 * sibling package roots as `metroConfig.watchFolders`. Every folder
 * Metro watches must also be scanned so atoms declared in shared UI
 * packages make it into the union — without this, only the app's
 * own files would be scanned and every UI-package atom would resolve
 * to `undefined` at runtime.
 * @param projectRoot Absolute project root.
 * @param cacheDir Absolute rnwind cache dir (to exclude).
 * @param watchFolders Extra monorepo roots Metro is watching.
 * @returns Scanner sources suitable for `parser.parseProject()`.
 */
function defaultSources(projectRoot: string, cacheDir: string, watchFolders: readonly string[]): readonly SourceEntry[] {
  const cacheBaseName = path.basename(cacheDir)
  const roots = new Set<string>([projectRoot, ...watchFolders])
  const sources: SourceEntry[] = []
  for (const root of roots) {
    sources.push({ base: root, pattern: '**/*.{ts,tsx,js,jsx}', negated: false }, { base: root, pattern: '**/node_modules/**', negated: true }, { base: root, pattern: `**/${cacheBaseName}/**`, negated: true })
  }
  return sources
}

/**
 * Read monorepo watch-folder paths out of the worker environment.
 * Empty array when the host isn't a monorepo.
 * @returns Absolute paths Metro also watches (sibling packages).
 */
function readWatchFolders(): readonly string[] {
  const raw = process.env[WATCH_FOLDERS_ENV]
  if (!raw || raw.length === 0) return []
  return raw.split('\0').filter((entry) => entry.length > 0)
}

/** Env var Metro workers read to locate the theme CSS on disk. */
const CSS_ENTRY_ENV = 'RNWIND_CSS_ENTRY_FILE'
/** Env var Metro workers read to locate the cache directory (`.rnwind`). */
const CACHE_DIR_ENV = 'RNWIND_CACHE_DIR'
/** Env var carrying `watchFolders` from Metro config (NUL-separated). */
const WATCH_FOLDERS_ENV = 'RNWIND_WATCH_FOLDERS'
/** Env var carrying extra className prefixes the Metro config supplied. */
const CLASSNAME_PREFIXES_ENV = 'RNWIND_CLASSNAME_PREFIXES'
/** Env var carrying extra import sources whose JSX exports get className→style rewrites. Comma-separated. */
const HOST_SOURCES_ENV = 'RNWIND_HOST_SOURCES'
/** Env var carrying extra JSX tag names (verbatim, may contain `.`) treated as hosts. Comma-separated. */
const HOST_COMPONENTS_ENV = 'RNWIND_HOST_COMPONENTS'

/** Memoised library fingerprint — read once per worker process. */
let libraryFingerprint: string | undefined

/** Live state shared across one Metro transform worker. */
let cached: RnwindState | null = null

/**
 * Cheap content-hash readout. SHA-256 prefix of the FULLY-RESOLVED theme
 * CSS — `@import`s flattened — so an edit to a theme file the entry only
 * re-exports (`@import "@acme/ui/theme.css"`) still rotates the hash and
 * invalidates Metro's cache. Returns `'missing'` when the entry can't be
 * read so the cache key stays deterministic.
 * @param cssPath Absolute CSS path.
 * @returns 16-char hex content hash.
 */
function readThemeHashFor(cssPath: string): string {
  if (!existsSync(cssPath)) return 'missing'
  try {
    return createHash('sha256').update(resolveThemeCss(cssPath)).digest('hex').slice(0, 16)
  } catch {
    return 'missing'
  }
}

/**
 * Hash a small set of rnwind library files whose changes affect the
 * generated transform output. When the library is rebuilt (workspace
 * dev OR npm install of a new version) the file bytes change, the
 * fingerprint rotates, and Metro's transform cache invalidates.
 *
 * Includes the JSX rewriter (`transform-ast`) alongside the parser /
 * style-builder so a change to the transformer — e.g. renaming the
 * injected context hook — invalidates every stale per-file cache entry
 * on the next dev run. Without this, a user upgrading rnwind in-place
 * would keep loading the old transformed bytes; React-refresh would
 * then preserve fiber state across the version bump and the rendered
 * hook list could shift, surfacing as "change in the order of Hooks"
 * runtime errors.
 * Memoised — read once per worker process.
 * @returns 16-char hex fingerprint.
 */
function getLibraryFingerprint(): string {
  if (libraryFingerprint !== undefined) return libraryFingerprint
  const here = path.dirname(__filename)
  const candidates = [
    path.resolve(here, '..', 'core', 'style-builder', 'build-style.mjs'),
    path.resolve(here, '..', 'core', 'style-builder', 'build-style.cjs'),
    path.resolve(here, '..', 'core', 'parser', 'tw-parser.mjs'),
    path.resolve(here, '..', 'core', 'parser', 'tw-parser.cjs'),
    path.resolve(here, 'transform-ast.mjs'),
    path.resolve(here, 'transform-ast.cjs'),
    path.resolve(here, 'transformer.mjs'),
    path.resolve(here, 'transformer.cjs'),
    // Source-tree fallback for tests + workspace dev (no built lib yet).
    path.resolve(here, '..', '..', 'src', 'core', 'style-builder', 'build-style.ts'),
    path.resolve(here, '..', '..', 'src', 'core', 'parser', 'tw-parser.ts'),
    path.resolve(here, '..', '..', 'src', 'metro', 'transform-ast.ts'),
    path.resolve(here, '..', '..', 'src', 'metro', 'transformer.ts'),
  ]
  const hash = createHash('sha256')
  let included = 0
  for (const file of candidates) {
    if (!existsSync(file)) continue
    try {
      hash.update(readFileSync(file))
      included += 1
    } catch {
      // Unreadable file — skip; fingerprint still derives from whatever WE could read.
    }
  }
  libraryFingerprint = included > 0 ? hash.digest('hex').slice(0, 16) : '0'.repeat(16)
  return libraryFingerprint
}

/**
 * Worker-local state. Lazy-initialised on first access so files that
 * bypass the transform don't pay for construction.
 */
export interface RnwindState {
  parser: TailwindParser
  builder: UnionBuilder
  themeCss: string
  themeHash: string
  projectRoot: string
}

/**
 * Publish the theme CSS path + cache dir to the environment so worker
 * subprocesses (spawned by Metro once `babelTransformerPath` is set)
 * can rebuild the same state without re-reading the Metro config.
 * @param cssEntryFile Absolute path to the user's theme CSS.
 * @param cacheDir Absolute path to the cache dir (`.rnwind`).
 * @param watchFolders
 * @param classNamePrefixes Extra JSX prop-name prefixes to rewrite.
 * @param hostSources
 * @param hostComponents
 */
export function configureRnwindState(
  cssEntryFile: string,
  cacheDir: string,
  watchFolders: readonly string[] = [],
  classNamePrefixes?: readonly string[],
  hostSources?: readonly string[],
  hostComponents?: readonly string[],
): void {
  process.env[CSS_ENTRY_ENV] = cssEntryFile
  process.env[CACHE_DIR_ENV] = cacheDir
  if (watchFolders.length === 0) {
    delete process.env[WATCH_FOLDERS_ENV]
  } else {
    process.env[WATCH_FOLDERS_ENV] = watchFolders.join('\0')
  }
  if (!classNamePrefixes || classNamePrefixes.length === 0) {
    delete process.env[CLASSNAME_PREFIXES_ENV]
  } else {
    process.env[CLASSNAME_PREFIXES_ENV] = classNamePrefixes.join(',')
  }
  if (!hostSources || hostSources.length === 0) {
    delete process.env[HOST_SOURCES_ENV]
  } else {
    process.env[HOST_SOURCES_ENV] = hostSources.join(',')
  }
  if (!hostComponents || hostComponents.length === 0) {
    delete process.env[HOST_COMPONENTS_ENV]
  } else {
    process.env[HOST_COMPONENTS_ENV] = hostComponents.join(',')
  }
  cached = null
}

/**
 * Read the caller-configured extra className prefixes out of the
 * worker environment. Returns an empty array when unset — the
 * transformer applies the built-in `contentContainer` default on top
 * either way.
 * @returns User-supplied extra prefixes.
 */
export function getClassNamePrefixes(): readonly string[] {
  const raw = process.env[CLASSNAME_PREFIXES_ENV]
  if (!raw || raw.length === 0) return []
  return raw.split(',').filter((entry) => entry.length > 0)
}

/**
 * Read the caller-configured extra host module sources out of the
 * worker environment. Empty array when unset — the transformer applies
 * its built-in default list on top either way.
 * @returns User-supplied extra host sources.
 */
export function getHostSources(): readonly string[] {
  const raw = process.env[HOST_SOURCES_ENV]
  if (!raw || raw.length === 0) return []
  return raw.split(',').filter((entry) => entry.length > 0)
}

/**
 * Read the caller-configured extra host JSX tag names out of the worker
 * environment. Verbatim names — may include `.` for member expressions
 * like `'Animated.View'`.
 * @returns User-supplied extra host component names.
 */
export function getHostComponents(): readonly string[] {
  const raw = process.env[HOST_COMPONENTS_ENV]
  if (!raw || raw.length === 0) return []
  return raw.split(',').filter((entry) => entry.length > 0)
}

/**
 * Fetch (or build) the worker-local rnwind state. Re-reads the theme
 * CSS hash on every call: if the user edited `global.css` while Metro
 * is running, the cached state is dropped and a fresh parser + ledger
 * is built. Combined with the `getCacheKey()` export on the
 * transformer (which folds the same hash into Metro's per-file cache
 * key) every CSS edit produces a full, correct re-bundle.
 * @param projectRoot
 * @returns The live rnwind state.
 */
export function getRnwindState(projectRoot: string): RnwindState {
  const cssEntry = process.env[CSS_ENTRY_ENV]
  const cacheDir = process.env[CACHE_DIR_ENV]
  if (!cssEntry) throw new Error('rnwind: RNWIND_CSS_ENTRY_FILE is not set — did `withRnwindConfig` run?')
  if (!cacheDir) throw new Error('rnwind: RNWIND_CACHE_DIR is not set — did `withRnwindConfig` run?')
  const currentHash = readThemeHashFor(cssEntry)
  if (cached?.themeHash === currentHash && cached.projectRoot === projectRoot) return cached
  const themeCss = resolveThemeCss(cssEntry)
  const parser = new TailwindParser({
    themeCss,
    sources: defaultSources(projectRoot, cacheDir, readWatchFolders()),
  })
  const builder = new UnionBuilder(cacheDir, parser)
  cached = { parser, builder, themeCss, themeHash: currentHash, projectRoot }
  return cached
}

/**
 * Compute the rnwind cache-key suffix Metro mixes into every per-file
 * transform cache entry via the transformer's `getCacheKey()` export.
 * Includes the CSS path + its current content hash + the rnwind
 * library fingerprint, so any edit to `global.css` OR a library
 * upgrade flips the cache key and forces Metro to re-run the
 * transformer.
 * @returns Deterministic string suitable for appending to Metro's cache key.
 */
export function getRnwindCacheKey(): string {
  const cssEntry = process.env[CSS_ENTRY_ENV] ?? ''
  const prefixes = process.env[CLASSNAME_PREFIXES_ENV] ?? ''
  // Host source / component config changes which JSX tags get rewritten,
  // so it MUST flip the cache key — otherwise Metro replays stale
  // transforms (a newly-opted-in host keeps its raw className, a removed
  // one keeps the rewrite).
  const hostSources = process.env[HOST_SOURCES_ENV] ?? ''
  const hostComponents = process.env[HOST_COMPONENTS_ENV] ?? ''
  return `rnwind:${cssEntry}:${readThemeHashFor(cssEntry)}|lib:${getLibraryFingerprint()}|pfx:${prefixes}|hs:${hostSources}|hc:${hostComponents}`
}

/** Drop the cached state — call after editing the theme CSS. */
export function resetRnwindState(): void {
  cached = null
}

/**
 * Drop cached state, rebuild parser/builder with the fresh CSS, rescan
 * the project, and rewrite every scheme file on disk. This is what
 * `withRnwindConfig`'s CSS file-watcher invokes so `global.css` edits
 * propagate to the app via Metro's HMR — without this, the CSS-as-JS
 * module would re-emit `export {}` whose bytes never change, so Metro
 * would never invalidate downstream modules.
 * @param projectRoot Absolute project root (from `metroConfig.projectRoot`).
 */
export async function onThemeChange(projectRoot: string): Promise<void> {
  resetRnwindState()
  const state = getRnwindState(projectRoot)
  await state.builder.writeSchemes()
}

/**
 * Resolve the on-disk path of the scheme manifest module for the
 * resolver. The manifest eager-imports `common.style.js` and
 * lazy-requires each variant scheme; SchemeProvider calls its
 * `ensureSchemeLoaded` export to trigger per-scheme requires.
 * @returns Absolute path to `<cacheDir>/schemes.js`.
 */
export function manifestPathFor(): string {
  const cacheDir = process.env[CACHE_DIR_ENV]
  if (!cacheDir) throw new Error('rnwind: RNWIND_CACHE_DIR is not set')
  return path.join(cacheDir, 'schemes.js')
}
