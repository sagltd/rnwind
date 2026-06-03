import type { File } from '@babel/types'
import * as t from '@babel/types'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { getRnwindCacheKey, getRnwindState, getWrapModules, onThemeChange } from './state'
import { rewriteWrapImports } from './wrap-imports'
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
 * Wrap host imports + compile any className literals, then regenerate
 * source. Two paths:
 *  - **className present**: oxide-scan the file, record its atoms into
 *    the union, and inject the generated-style + theme-signature
 *    side-effect imports so the runtime registries populate.
 *  - **import-only** (a `{...rest}` forwarder or a leaf with no literal
 *    `className=`): just wrap the host imports so a forwarded className
 *    still resolves at render — no oxide scan, no injected imports.
 *
 * On parse failure, fall back to the original source — a transient parse
 * error shouldn't crash Metro for a file the upstream might handle fine.
 * @param args Metro args; `src` is the original source text.
 * @returns Rewritten source text.
 */
async function rewriteSource(args: BabelTransformerArgs): Promise<string> {
  const ast = parseUserSource(args.src)
  if (!ast) return args.src

  // Wrap host component imports so `<View className=…>` resolves at render
  // through the runtime `wrap` (works for literal, spread, and forwarded
  // classNames alike). No JSX is rewritten here.
  const wrapped = rewriteWrapImports(ast, getWrapModules())

  if (!/classname=/i.test(args.src)) {
    // Import-only file: nothing to compile. Drop any stale atom
    // contribution (className may have just been removed) and emit the
    // wrapped imports — or the untouched source when nothing wrapped.
    dropFileSafely(args.filename, projectRootOf(args))
    return wrapped ? generateModule(ast).code : args.src
  }

  const state = getRnwindState(projectRootOf(args))
  const extension = extensionOf(args.filename)
  const parsed = await state.parser.parseAtoms({ content: args.src, extension })

  warnUnknownClasses(args.src, parsed.candidates, parsed.atoms, args.filename)

  if (parsed.atoms.size === 0) {
    state.builder.dropFile(args.filename)
    await state.builder.writeSchemes()
    injectThemeSignatureImport(ast)
    return generateModule(ast).code
  }

  const literals = collectClassNameLiterals(ast)
  const { changed } = await state.builder.recordFile(args.filename, parsed.atoms, parsed.keyframes, literals)
  if (changed) await state.builder.writeSchemes()

  injectSideEffectImports(ast, STYLE_SPECIFIERS)
  injectThemeSignatureImport(ast)
  return generateModule(ast).code
}

/**
 * Drop a file's union contribution, swallowing the "state not configured"
 * error unit tests hit when they call the transformer without
 * `configureRnwindState`.
 * @param filename Absolute source path.
 * @param projectRoot Project root for state lookup.
 */
function dropFileSafely(filename: string, projectRoot: string): void {
  try {
    getRnwindState(projectRoot).builder.dropFile(filename)
  } catch {
    // State not configured (standalone/unit test). Nothing to drop.
  }
}

/**
 * Whether a JSX attribute names a className-style prop (`className` or
 * any `<prefix>ClassName`).
 * @param node JSX attribute node.
 * @returns True when the attribute is a className prop.
 */
function isClassNameAttribute(node: t.JSXAttribute): boolean {
  if (!t.isJSXIdentifier(node.name)) return false
  const {name} = node.name
  return name === 'className' || name.endsWith('ClassName')
}

/**
 * Pull static string literals out of a className expression. Handles a
 * bare string, a no-substitution template, and the branches of a
 * ternary / `&&` (so `cond ? 'a' : 'b'` and `flag && 'x'` both register
 * their literals). Dynamic interpolations are skipped — they resolve via
 * the runtime atom path.
 * @param expr Expression inside a `className={...}` container.
 * @param out Accumulator for discovered literals.
 */
function collectLiteralsFromExpression(expr: t.Expression | t.JSXEmptyExpression | null | undefined, out: string[]): void {
  if (!expr) return
  if (t.isStringLiteral(expr)) {
    out.push(expr.value)
    return
  }
  if (t.isTemplateLiteral(expr) && expr.expressions.length === 0 && expr.quasis.length === 1) {
    const cooked = expr.quasis[0]?.value.cooked
    if (typeof cooked === 'string') out.push(cooked)
    return
  }
  if (t.isConditionalExpression(expr)) {
    collectLiteralsFromExpression(expr.consequent, out)
    collectLiteralsFromExpression(expr.alternate, out)
    return
  }
  if (t.isLogicalExpression(expr)) {
    collectLiteralsFromExpression(expr.right as t.Expression, out)
  }
}

/** AST node keys the literal walk skips — position / comment metadata. */
const SKIP_WALK_KEYS = new Set(['type', 'loc', 'start', 'end', 'range', 'leadingComments', 'trailingComments', 'innerComments'])

/**
 * Collect the static literals from one className JSX attribute into the
 * dedup accumulator.
 * @param attribute The (already className-matched) JSX attribute.
 * @param seen Dedup set of literals already collected.
 * @param out Ordered accumulator.
 */
function collectAttributeLiterals(attribute: t.JSXAttribute, seen: Set<string>, out: string[]): void {
  const { value } = attribute
  const found: string[] = []
  if (t.isStringLiteral(value)) found.push(value.value)
  else if (t.isJSXExpressionContainer(value)) collectLiteralsFromExpression(value.expression, found)
  for (const literal of found) {
    if (seen.has(literal)) continue
    seen.add(literal)
    out.push(literal)
  }
}

/**
 * Walk the AST for every `className=` / `<prefix>ClassName=` literal so
 * the builder can pre-merge each into a per-scheme molecule. A generic
 * node walk (no scope build) keeps it cheap; only JSX attribute nodes do
 * any work.
 * @param ast Parsed Babel file.
 * @returns Distinct literal className strings, in first-seen order.
 */
function collectClassNameLiterals(ast: File): readonly string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    const typed = node as { type?: string; [key: string]: unknown }
    if (typeof typed.type !== 'string') return
    if (typed.type === 'JSXAttribute' && isClassNameAttribute(node as t.JSXAttribute)) {
      collectAttributeLiterals(node as t.JSXAttribute, seen, out)
    }
    for (const key in typed) {
      if (SKIP_WALK_KEYS.has(key)) continue
      visit(typed[key])
    }
  }
  visit(ast.program)
  return out
}

/**
 * Prepend side-effect imports (`import '<spec>'`) so the generated
 * per-scheme style + manifest modules load — registering this file's
 * atoms / molecules / features into the runtime registries the wrapper's
 * `resolve` reads.
 * @param ast Babel File AST to mutate in place.
 * @param specifiers Module specifiers to side-effect-import.
 */
function injectSideEffectImports(ast: File, specifiers: readonly string[]): void {
  for (const specifier of specifiers) {
    ast.program.body.unshift(t.importDeclaration([], t.stringLiteral(specifier)))
  }
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
  // Process the file when it either:
  //  - carries a `className=` / `<prefix>ClassName=` literal (case-
  //    insensitive — `contentContainerClassName=` has a capital C), or
  //  - spreads props (`{...rest}`) onto a host from a wrap-module, where a
  //    forwarded className must still get its import wrapped (no literal
  //    appears in this file). A style-less `<View/>` with neither is left
  //    alone so it never pays for an unused wrapper.
  const hasClassName = /classname=/i.test(args.src)
  const isForwarder = /\{\s*\.\.\./.test(args.src) && mentionsWrapModule(args.src)
  if (!hasClassName && !isForwarder) return false
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
 * Cheap pre-parse check: does the source import from any configured
 * wrap-module? A quoted specifier match is enough — `rewriteWrapImports`
 * re-verifies precisely on the AST, so a false positive only costs a
 * no-op parse.
 * @param source Source text.
 * @returns True when a wrap-module specifier appears in the source.
 */
function mentionsWrapModule(source: string): boolean {
  for (const moduleName of getWrapModules().keys()) {
    if (source.includes(`'${moduleName}'`) || source.includes(`"${moduleName}"`)) return true
  }
  return false
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
