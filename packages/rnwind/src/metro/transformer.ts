import type { File } from '@babel/types'
import * as t from '@babel/types'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { transformAst } from './transform-ast'
import { getClassNamePrefixes, getHostComponents, getHostSources, getRnwindCacheKey, getRnwindState, onThemeChange } from './state'
import { STYLE_SPECIFIERS, THEME_SIGNATURE_MODULE } from './resolver'
import { filterUnknownClassCandidates } from './warn-unknown-classes'

/** The shape of the upstream module we delegate parsing/babel work to. */
interface UpstreamTransformer {
  transform: (args: BabelTransformerArgs) => Promise<BabelTransformerResult> | BabelTransformerResult
}

/** Env var that points at the upstream `babelTransformerPath` we override. */
const UPSTREAM_ENV = 'RNWIND_UPSTREAM_TRANSFORMER'

/** Cached upstream module — required once, reused across every transform call. */
let cachedUpstream: UpstreamTransformer | null = null

const generateModule = (generate as unknown as { default?: typeof generate }).default ?? generate

/**
 * Parse user source with the broad plugin set (Flow + JSX + TypeScript
 * + class properties). Permissive on purpose so we don't reject any
 * file the upstream could have handled. Returns `null` when parse
 * fails — caller falls back to the raw source string.
 * @param source Source text.
 * @returns Parsed AST, or null on parse failure.
 */
function parseUserSource(source: string): File | null {
  try {
    return parse(source, {
      sourceType: 'unambiguous',
      allowReturnOutsideFunction: true,
      allowImportExportEverywhere: true,
      plugins: ['typescript', 'jsx'],
    }) as unknown as File
  } catch {
    try {
      return parse(source, {
        sourceType: 'unambiguous',
        allowReturnOutsideFunction: true,
        allowImportExportEverywhere: true,
        plugins: ['flow', 'jsx'],
      }) as unknown as File
    } catch {
      return null
    }
  }
}

/**
 * Print Tailwind-shaped candidates oxide picked up but the parser
 * could NOT compile — typo, missing custom utility, or class not in
 * the user's theme. Filtering by candidates that ALSO appear inside a
 * `className="…"` literal eliminates false positives from imports,
 * comments, and JSX prop values.
 * @param source Original source text — searched for className literals.
 * @param candidates Every candidate oxide surfaced from the source.
 * @param atoms Successfully resolved atoms (keys are class names).
 * @param filename Source path, prefixed onto the warning.
 */
function warnUnknownClasses(
  source: string,
  candidates: readonly string[],
  atoms: ReadonlyMap<string, unknown>,
  filename: string,
): void {
  const atomNames = new Set(atoms.keys())
  const unknown = filterUnknownClassCandidates(source, candidates, atomNames)
  if (unknown.length === 0) return
  // eslint-disable-next-line no-console
  console.warn(`rnwind: unknown class${unknown.length > 1 ? 'es' : ''} in ${filename}: ${unknown.join(', ')}`)
}

/**
 * Extract the bare extension for oxide / internal switches.
 * @param filename Absolute path.
 * @returns Extension without the leading dot (`tsx` / `ts` / `js` / `jsx`).
 */
function extensionOf(filename: string): string {
  const index = filename.lastIndexOf('.')
  if (index === -1) return 'tsx'
  return filename.slice(index + 1)
}

/**
 * Read the project root Metro hands us per-transform. Falls back to
 * `process.cwd()` only when the upstream harness doesn't set it (unit
 * tests, standalone). Metro's production pipeline always sets it.
 * @param args Metro transformer args.
 * @returns Absolute project root.
 */
function projectRootOf(args: BabelTransformerArgs): string {
  const fromOptions = args.options?.projectRoot
  if (typeof fromOptions === 'string' && fromOptions.length > 0) return fromOptions
  return process.cwd()
}

/**
 * Whether a `.css` filename is the user's theme entry (the file
 * `withRnwindConfig` pointed us at via `RNWIND_CSS_ENTRY_FILE`).
 * Only the theme CSS should trigger a scheme rebuild — unrelated CSS
 * files in the project stay invisible to rnwind.
 * @param filename Absolute CSS path.
 * @returns Whether the file is the configured theme entry.
 */
function isThemeCssEntry(filename: string): boolean {
  const cssEntry = process.env.RNWIND_CSS_ENTRY_FILE
  return typeof cssEntry === 'string' && cssEntry.length > 0 && cssEntry === filename
}

/**
 * Parse + run rnwind's JSX rewrite + regenerate source code. When
 * parsing or transformation fails, fall back to the original source —
 * we don't want a transient parse error to crash Metro for a file the
 * upstream might handle fine.
 * @param args Metro args; `src` is the original source text.
 * @returns Rewritten source text (with `className=` rewrites applied).
 */
async function rewriteSource(args: BabelTransformerArgs): Promise<string> {
  const ast = parseUserSource(args.src)
  if (!ast) return args.src

  const state = getRnwindState(projectRootOf(args))
  const extension = extensionOf(args.filename)
  const parsed = await state.parser.parseAtoms({ content: args.src, extension })

  warnUnknownClasses(args.src, parsed.candidates, parsed.atoms, args.filename)

  const classNamePrefixes = getClassNamePrefixes()
  const hostSources = getHostSources()
  const hostComponents = getHostComponents()
  if (parsed.atoms.size === 0) {
    state.builder.dropFile(args.filename)
    await state.builder.writeSchemes()
    transformAst(ast, {
      styleSpecifiers: [],
      gradientAtoms: parsed.gradientAtoms,
      hapticAtoms: parsed.hapticAtoms,
      classNamePrefixes,
      hostSources,
      hostComponents,
    })
    injectThemeSignatureImport(ast)
    return generateModule(ast).code
  }

  const { changed } = await state.builder.recordFile(args.filename, parsed.atoms, parsed.keyframes)
  if (changed) await state.builder.writeSchemes()

  transformAst(ast, {
    styleSpecifiers: STYLE_SPECIFIERS as unknown as readonly string[],
    gradientAtoms: parsed.gradientAtoms,
    hapticAtoms: parsed.hapticAtoms,
    classNamePrefixes,
    hostSources,
    hostComponents,
  })
  injectThemeSignatureImport(ast)
  return generateModule(ast).code
}

/**
 * Prepend `import 'rnwind/__generated/theme-signature'` to every
 * rnwind-transformed file. The resolver maps that specifier to the
 * user's theme CSS so Metro's dependency graph carries a real edge
 * from this JS file to the CSS. When the user edits `global.css`,
 * the CSS module's SHA1 changes, and Metro invalidates every JS file
 * holding this import — forcing them to re-transform with the new
 * theme. The `.css` branch in {@link transform} returns an empty
 * `export {}` module so the runtime cost is one extra `require()`.
 * @param ast Babel File AST to mutate in place.
 */
function injectThemeSignatureImport(ast: File): void {
  const declaration = t.importDeclaration([], t.stringLiteral(THEME_SIGNATURE_MODULE))
  ast.program.body.unshift(declaration)
}

/**
 * Read the upstream transformer's `getCacheKey()` so our cache-key
 * contribution composes with — rather than replaces — whatever the
 * host framework wants to mix in.
 * @returns Upstream cache key, or `null` when no upstream exposes one.
 */
function loadUpstreamCacheKey(): string | null {
  const upstream = loadUpstream() as (UpstreamTransformer & { getCacheKey?: () => string }) | null
  if (!upstream) return null
  try {
    return typeof upstream.getCacheKey === 'function' ? upstream.getCacheKey() : null
  } catch {
    return null
  }
}

/**
 * Invoke the upstream `babelTransformerPath` Metro originally had
 * configured. The path is read from `RNWIND_UPSTREAM_TRANSFORMER`,
 * which `withRnwindConfig` sets at Metro startup. When the env var is
 * unset (unit tests, standalone use), fall back to a typescript+jsx
 * parse.
 * @param args Metro's per-file args.
 * @returns Upstream transform result containing the post-babel AST.
 */
async function runUpstream(args: BabelTransformerArgs): Promise<BabelTransformerResult> {
  if (args.ast && !process.env[UPSTREAM_ENV]) return { ast: args.ast }
  const upstream = loadUpstream()
  if (upstream) return await Promise.resolve(upstream.transform(args))
  if (args.ast) return { ast: args.ast }
  return { ast: parseSource(args.src) }
}

/**
 * Lazily require the upstream transformer module. Cached after first
 * load so per-file overhead is one cache lookup.
 * @returns Upstream module, or null when env is unset.
 */
function loadUpstream(): UpstreamTransformer | null {
  if (cachedUpstream) return cachedUpstream
  const upstreamPath = process.env[UPSTREAM_ENV]
  if (!upstreamPath || upstreamPath.length === 0) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const required = require(upstreamPath) as UpstreamTransformer | { default?: UpstreamTransformer }
    const upstream = (required as { default?: UpstreamTransformer }).default ?? (required as UpstreamTransformer)
    if (typeof upstream.transform !== 'function') return null
    cachedUpstream = upstream
    return upstream
  } catch (error) {
    // eslint-disable-next-line no-console
    if (process.env.RNWIND_DEBUG) console.error('rnwind: failed to load upstream transformer:', error)
    return null
  }
}

/**
 * Cheap guard — the file has to look JS/TS, live outside `node_modules`,
 * and mention `className=` before we spend AST cycles on it.
 *
 * Symlink awareness: monorepo workspaces (yarn / pnpm / bun workspaces)
 * symlink each package into the consumer's `node_modules/<name>`, so a
 * file from `packages/ui/src/Foo.tsx` ends up reaching the transformer
 * as `<root>/node_modules/ui/src/Foo.tsx`. The naïve `/node_modules/`
 * check would skip every workspace UI file. We `realpath` the filename
 * once and only bail when the resolved real path is ALSO under
 * node_modules — true third-party installs.
 * @param args Metro args.
 * @returns Whether the file might need the rnwind pass.
 */
function isRewriteCandidate(args: BabelTransformerArgs): boolean {
  if (!/\.(?:tsx|ts|jsx|js)$/i.test(args.filename)) return false
  if (!args.src.includes('className=')) return false
  if (!args.filename.includes('/node_modules/')) return true
  // node_modules in path → could be a workspace symlink; resolve it.
  try {
    return !realpathSync(args.filename).includes('/node_modules/')
  } catch {
    // realpath failed (broken symlink, missing file). Fall back to skipping.
    return false
  }
}

/**
 * Fallback parse when no upstream is configured AND Metro didn't hand
 * us an AST. Used by unit tests and standalone setups.
 * @param source Source text.
 * @returns Parsed Babel File.
 */
function parseSource(source: string): File {
  return parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) as unknown as File
}

/** Metro's babel transformer signature. */
export interface BabelTransformerArgs {
  filename: string
  src: string
  options: { projectRoot?: string; [key: string]: unknown }
  ast?: File
  plugins?: readonly unknown[]
}

/** Return shape Metro expects from a babel transformer. */
export interface BabelTransformerResult {
  ast: File
  metadata?: unknown
}

/**
 * rnwind's Metro babel transformer. Two phases per source file:
 *
 *  1. **Pre-process the source string before handing it to the upstream
 *     babel pipeline.** babel-preset-expo / React's JSX transform run
 *     inside the upstream and convert `<View className="..."/>` into
 *     `React.createElement(View, {className})`. If we walked the AST
 *     AFTER the upstream, there'd be no JSX attributes left to
 *     rewrite. So we parse, run our pass, regenerate code, and feed
 *     THAT to the upstream as `src`.
 *  2. **Delegate to the upstream `babelTransformerPath`** (Expo's
 *     default handles Flow stripping, expo-router macros, etc.).
 *
 * Skip both phases when the file isn't a JS/TS source under user
 * code, or doesn't mention `className=` — hand straight to upstream.
 * @param args Metro's per-file args.
 * @returns Mutated AST + metadata.
 */
export async function transform(args: BabelTransformerArgs): Promise<BabelTransformerResult> {
  // Short-circuit `.css` inputs: the theme CSS is pulled into the dep
  // graph as a sentinel (see `THEME_SIGNATURE_MODULE` in resolver.ts)
  // so Metro watches it and invalidates importers on edit, but the
  // file's CSS syntax can't go through a JS babel transformer.
  //
  // When the CSS being transformed IS the user's theme entry, we
  // piggyback on Metro's own file-watcher: Metro calls us here on
  // every CSS save; we trigger `onThemeChange` to rebuild parser +
  // rewrite scheme files with the new values. Metro's dep graph then
  // HMRs the regenerated `common.style.js` to the running app.
  //
  // Emitting the CSS content hash in the fake JS output is what makes
  // Metro propagate invalidation to downstream importers — constant
  // `export {}` bytes would never look changed and Metro would skip
  // the chain.
  if (args.filename.endsWith('.css')) {
    if (isThemeCssEntry(args.filename)) {
      try {
        await onThemeChange(projectRootOf(args))
      } catch {
        // CSS edit happened outside a configured project (e.g. tests).
      }
    }
    const themeHash = createHash('sha256').update(args.src).digest('hex').slice(0, 16)
    const stub = `export const __rnwindThemeHash = ${JSON.stringify(themeHash)};\n`
    return { ast: parse(stub, { sourceType: 'module' }) as unknown as File }
  }
  if (!isRewriteCandidate(args)) {
    if (/\.(?:tsx|ts|jsx|js)$/i.test(args.filename) && !args.filename.includes('/node_modules/')) {
      try {
        getRnwindState(projectRootOf(args)).builder.dropFile(args.filename)
      } catch {
        // State not configured (e.g. test). Nothing to drop.
      }
    }
    return runUpstream(args)
  }

  const rewrittenSource = await rewriteSource(args)
  return runUpstream({ ...args, src: rewrittenSource, ast: undefined })
}

/**
 * Metro's babel-transformer contract: a `getCacheKey()` export is
 * sampled per-file and mixed into the transform cache key. Returning
 * a string that includes the theme CSS content hash invalidates every
 * cached transform on every CSS edit — so the bundle rebuilds with
 * the new theme automatically on the next request.
 * @returns Cache-key segment that includes rnwind's current theme hash.
 */
export function getCacheKey(): string {
  const upstreamKey = loadUpstreamCacheKey()
  const ownKey = getRnwindCacheKey()
  return upstreamKey ? `${upstreamKey}|${ownKey}` : ownKey
}

/** Test-only — drop the cached upstream so a new env var picks up next call. */
export function __resetUpstreamCache(): void {
  cachedUpstream = null
}
