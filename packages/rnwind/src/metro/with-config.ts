import { existsSync, mkdirSync, watch as watchFile } from 'node:fs'
import path from 'node:path'
import { writeDtsFile } from './dts'
import { createRnwindResolver, type ResolveRequestFn } from './resolver'
import { configureRnwindState, getRnwindState, onThemeChange } from './state'

/** Default cache directory at the project root. Visible for debugging. */
const DEFAULT_CACHE_DIR = '.rnwind'

/**
 * Active CSS watcher — replaced (and the prior one closed) when
 * `withRnwindConfig` is called again (Metro restart, repeated init).
 * Only one watcher per process; no stacking.
 */
let activeCssWatcher: { cssPath: string; close: () => void } | null = null

/**
 * Watch the theme CSS for edits. On change, rebuild state against the fresh
 * CSS and rewrite the per-scheme files (`onThemeChange` → full rescan →
 * `writeSchemes`). That's the entire HMR signal: every transformed source
 * imports `rnwind/__generated/schemes`, which eager-imports
 * `common.style.js`; the rewrite changes its bytes, Metro's content-SHA1
 * dedup notices, and every importer is invalidated + re-bundled with the new
 * style values. The rewritten JSX references atoms by NAME (theme-independent),
 * so no source-file re-transform / mtime nudge is needed — the dep graph
 * carries the signal.
 * @param cssPath Absolute path to the theme CSS to watch.
 * @param projectRoot Metro's project root (for `getRnwindState`).
 */
function watchThemeCss(cssPath: string, projectRoot: string): void {
  if (activeCssWatcher?.cssPath === cssPath) return
  activeCssWatcher?.close()
  if (!existsSync(cssPath)) return
  let pending = false
  const watcher = watchFile(cssPath, { persistent: false }, () => {
    // Debounce: editors often emit 2-3 change events per save (atomic
    // rename dance, tmp files). Coalesce to ONE rebuild per microtask.
    if (pending) return
    pending = true
    queueMicrotask(async () => {
      pending = false
      try {
        await onThemeChange(projectRoot)
      } catch {
        // Invalidation is best-effort — never crash the dev server.
      }
    })
  })
  activeCssWatcher = { cssPath, close: () => watcher.close() }
}

/**
 * Where the rnwind babel transformer lives — resolved relative to this
 * module so the path works from both the `src/` tree (tests) and the
 * built `lib/` output. Tries a few extensions because `require.resolve`
 * doesn't auto-find `.cjs` / `.mjs` from a bare specifier.
 * @returns Absolute path to the rnwind transformer module.
 */
function transformerPath(): string {
  for (const candidate of ['./transformer.cjs', './transformer.mjs', './transformer.js', './transformer.ts', './transformer']) {
    try {
      return require.resolve(candidate)
    } catch {
      // try the next extension
    }
  }
  throw new Error('rnwind: could not resolve the metro transformer path')
}

/**
 * Resolve the effective cache directory, honoring a user override and
 * falling back to `<projectRoot>/.rnwind`.
 * @param projectRoot Anchor for relative paths.
 * @param override User-supplied option.
 * @returns Absolute cache directory.
 */
function resolveCacheDir(projectRoot: string, override: string | undefined): string {
  if (!override || override.length === 0) return path.resolve(projectRoot, DEFAULT_CACHE_DIR)
  return path.isAbsolute(override) ? override : path.resolve(projectRoot, override)
}

/**
 * Read the theme CSS and extract `@variant <name>` blocks for the .d.ts
 * generator. Forces construction of `getRnwindState`, then reads
 * `parser.declaredSchemes` (populated synchronously at construction).
 * @param cssEntry Absolute path to theme CSS.
 * @param projectRoot
 * @returns Scheme names (empty when the theme has no variants; `'base'` is filtered).
 */
function discoverSchemes(cssEntry: string, projectRoot: string): readonly string[] {
  if (!existsSync(cssEntry)) return []
  try {
    const { parser } = getRnwindState(projectRoot)
    return parser.declaredSchemes.filter((name) => name !== 'base')
  } catch {
    return []
  }
}

/** User-facing options for `withRnwindConfig`. */
export interface RnwindMetroOptions {
  /** Path to the theme CSS (absolute or relative to `projectRoot`). Required. */
  cssEntryFile: string
  /** Where rnwind writes the `.d.ts` file. Set `false` to disable. Defaults to `<projectRoot>/rnwind-types.d.ts`. */
  dtsFile?: string | false
  /** Optional project-root override — defaults to `metroConfig.projectRoot` then `process.cwd()`. */
  projectRoot?: string
  /** Cache directory. Absolute, or relative to `projectRoot`. Default: `.rnwind` at project root. */
  cacheDir?: string
  /**
   * Extra module specifiers whose component exports rnwind should
   * auto-wrap at import sites — `import { View } from 'react-native'`
   * becomes `const View = wrap(_rnw0)` so `<View className="…">` resolves
   * styles at runtime. Merged with the built-in defaults: `react-native`,
   * `react-native-reanimated`, `react-native-svg`,
   * `react-native-gesture-handler`, `react-native-safe-area-context`,
   * `expo-linear-gradient`, `expo-image`, and more.
   *
   * A module NOT in this list keeps its raw imports — the importing
   * component receives `className` as a plain prop and can resolve it
   * via `useCss` / `wrap` itself. Use this to opt your design-system /
   * UI primitive packages into the auto-wrap path.
   */
  wrapModules?: readonly string[]
}

/** Shape we mutate on Metro's config. Loose so we don't pin Metro's internal types. */
export interface MetroConfigLike {
  projectRoot?: string
  watchFolders?: string[]
  transformer?: {
    babelTransformerPath?: string
    [key: string]: unknown
  }
  resolver?: {
    resolveRequest?: ResolveRequestFn | null
    [key: string]: unknown
  }
  [key: string]: unknown
}

/**
 * Wrap a Metro config with rnwind's pipeline:
 *  - Install the rnwind babel transformer.
 *  - Chain a `resolveRequest` hook that serves
 *    `rnwind/__generated/schemes` from `<cacheDir>/schemes.js`.
 *  - Write the `.d.ts` so TypeScript accepts `className=` on RN components.
 *  - Publish the theme CSS path + cache dir via env so Metro workers
 *    can rebuild their local state.
 *  - Ensure the cache dir is a watched folder Metro's haste-map indexes.
 *
 * Theme-edit hot reload happens implicitly: every transformed file
 * imports `rnwind/__generated/schemes`, and that module eager-imports
 * `common.style.js`. When the theme changes, the per-scheme files
 * regenerate with new bytes; Metro's content SHA1 dedup detects the
 * change and invalidates every importer automatically.
 * `getCacheKey()` on the transformer covers the per-file transform
 * cache. No file watcher / source-padding hack needed — the dep graph
 * carries the signal.
 * @param metroConfig Config from `getDefaultConfig(__dirname)` or equivalent.
 * @param options rnwind options.
 * @returns The same config, mutated.
 */
export function withRnwindConfig<C extends MetroConfigLike>(metroConfig: C, options: RnwindMetroOptions): C {
  const projectRoot = options.projectRoot ?? metroConfig.projectRoot ?? process.cwd()
  const cacheDir = resolveCacheDir(projectRoot, options.cacheDir)
  const cssEntry = path.isAbsolute(options.cssEntryFile) ? options.cssEntryFile : path.resolve(projectRoot, options.cssEntryFile)

  mkdirSync(cacheDir, { recursive: true })
  const watchFolders = (metroConfig.watchFolders ?? []).filter((p) => typeof p === 'string' && p.length > 0)
  configureRnwindState(cssEntry, cacheDir, watchFolders, options.wrapModules)

  // Warm the state eagerly (in the Metro master process) so oxide's
  // Scanner walks every project source (and every monorepo
  // watch-folder) ONCE and the manifest + scheme files hold the
  // complete union before Metro's resolver tries to SHA1 them on the
  // first transform. Each worker lazy-repeats this scan on its first
  // transform to converge on identical state.
  try {
    void getRnwindState(projectRoot).builder.ensureFilesExist()
  } catch {
    // Any init error surfaces again at the first transform; don't crash Metro boot.
  }

  // Install transformer + resolver. Capture the existing
  // babelTransformerPath BEFORE we override it — our worker chains to
  // it (env-passed) so Flow / expo-router / babel-preset-expo etc. all
  // continue to run.
  const existingTransformerPath = metroConfig.transformer?.babelTransformerPath
  if (typeof existingTransformerPath === 'string' && existingTransformerPath.length > 0) {
    process.env.RNWIND_UPSTREAM_TRANSFORMER = existingTransformerPath
  }
  const upstream = metroConfig.resolver?.resolveRequest ?? null
  metroConfig.transformer = { ...metroConfig.transformer, babelTransformerPath: transformerPath() }
  metroConfig.resolver = { ...metroConfig.resolver, resolveRequest: createRnwindResolver(upstream) }

  // Metro's haste-map indexes `watchFolders` at startup. Adding the
  // cache dir guarantees scheme style files + manifest get SHA1'd
  // without a "Failed to get the SHA-1" race when the first transform
  // writes them.
  const existingWatch = metroConfig.watchFolders ?? []
  metroConfig.watchFolders = existingWatch.includes(cacheDir) ? existingWatch : [...existingWatch, cacheDir]

  if (options.dtsFile !== false) {
    const dtsPath = options.dtsFile ?? path.resolve(projectRoot, 'rnwind-types.d.ts')
    const schemes = discoverSchemes(cssEntry, projectRoot)
    writeDtsFile(dtsPath, schemes)
  }

  // Watch the theme CSS. On edit, we rewrite scheme files AND touch
  // mtime on every transformed source file so Metro invalidates them
  // and re-transforms — the only reliable way to propagate theme
  // changes to an already-running dev server.
  watchThemeCss(cssEntry, projectRoot)

  return metroConfig
}
