/* eslint-disable sonarjs/no-unused-vars */
import type { File as BabelFile } from '@babel/types'
import { parse } from '@babel/parser'
import generateImport from '@babel/generator'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as React from 'react'
import type {
  render as testingLibraryRender,
  renderHook as testingLibraryRenderHook,
  RenderHookOptions,
} from '@testing-library/react-native'
import { configureRnwindState, resetRnwindState, transform as metroTransform } from '../metro'
import {
  __resetLookupCssState,
  registerAtoms,
  registerBreakpoints,
  registerThemeTokens,
  registerSchemeLoader,
} from '../runtime/lookup-css'
import { __resetResolveState, registerGradients, registerHaptics, registerMolecules } from '../runtime/resolve'
import * as rnwindRuntime from '../runtime'
import type { Insets } from '../runtime/components/rnwind-provider'
import { RnwindProvider } from '../runtime/components/rnwind-provider'
import type { OnHaptics } from '../core/parser/haptics'
import type { Scheme } from '../runtime/types'

// ────────────────────────────────────────────────────────────────────────
// Private constants
// ────────────────────────────────────────────────────────────────────────

/**
 * Minimal theme every `renderWithCss` call defaults to. Ships the two
 * conventional schemes so atoms carrying `dark:` / `light:` prefixes
 * resolve without the caller having to craft a theme CSS string.
 */
const DEFAULT_THEME_CSS = `@import 'tailwindcss';
@layer theme {
  :root {
    @variant light { --color-bg: #ffffff; --color-fg: #0a0a0a; }
    @variant dark  { --color-bg: #0a0a0a; --color-fg: #ffffff; }
  }
}
`

/** `StyleSheet.create` stub the evaluated bundle calls — identity at test time. */
const BUNDLE_STYLE_SHEET = { create: <T>(styles: T): T => styles, hairlineWidth: 1 }

// Synthesize a require rooted at the consumer's cwd so optional peer
// lookups (`@testing-library/react-native`, `esbuild`) resolve from THEIR
// node_modules, not rnwind's. A workspace-local rnwind install resolves
// through a different node_modules chain than the test cwd — we want the
// test's chain.
const localRequire: NodeRequire = createRequire(path.join(process.cwd(), 'package.json'))

const generate: typeof generateImport = (generateImport as { default?: typeof generateImport }).default ?? generateImport

/**
 * Pre-loaded `@testing-library/react-native`. Resolved once at module
 * init (not lazily per-call) because the testing library registers
 * `beforeAll`/`afterEach` cleanup hooks on import — and Bun's test
 * runner refuses to register lifecycle hooks from inside a running
 * test body, which is where the first `renderWithCss` call lands.
 */
const TESTING_LIBRARY: {
  render: typeof testingLibraryRender
  renderHook: typeof testingLibraryRenderHook
} = (() => {
  try {
    return localRequire('@testing-library/react-native') as {
      render: typeof testingLibraryRender
      renderHook: typeof testingLibraryRenderHook
    }
  } catch (error) {
    throw new Error(
      'rnwind/testing: cannot load `@testing-library/react-native`. Add it to your dev dependencies. Underlying error: ' +
        (error instanceof Error ? error.message : String(error)),
    )
  }
})()

// ────────────────────────────────────────────────────────────────────────
// Private helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Scheme string typed to match what `<RnwindProvider>` accepts. Users
 * who declare their own scheme names via `rnwind-types.d.ts` get them
 * through `Scheme`; everyone else gets `'light' | 'dark' | string`.
 */
type SchemeName = Scheme

/**
 * Default lookup for the test process's `react-native` module. Users
 * who run with a mocked `react-native` (via Bun's `mock.module` or
 * Jest's `jest.mock`) get the mock here automatically.
 * @returns React Native namespace bindings.
 */
function resolveReactNative(): Record<string, unknown> {
  return localRequire('react-native') as Record<string, unknown>
}

/**
 * Compile JSX + TypeScript source to plain JS. Prefers Bun's built-in
 * transpiler (fast, zero-dep); falls back to `esbuild` if running under
 * Node (Jest users). Throws with an install hint if neither is available.
 * @param source Source text to compile.
 * @returns JavaScript suitable for `new Function(...)` evaluation.
 */
function compileToJs(source: string): string {
  const globalBun = (
    globalThis as { Bun?: { Transpiler: new (options: unknown) => { transformSync: (text: string) => string } } }
  ).Bun
  if (globalBun?.Transpiler) {
    return new globalBun.Transpiler({
      loader: 'tsx',
      tsconfig: JSON.stringify({ compilerOptions: { jsx: 'react', target: 'esnext' } }),
    }).transformSync(source)
  }
  try {
    const esbuild = localRequire('esbuild') as {
      transformSync: (text: string, options: { loader: string; jsx: string; target?: string }) => { code: string }
    }
    return esbuild.transformSync(source, { loader: 'tsx', jsx: 'transform', target: 'esnext' }).code
  } catch {
    throw new Error(
      'rnwind/testing: cannot compile JSX. Run tests under Bun (which has a built-in transpiler) ' +
        'or install `esbuild` as a dev dependency for Node / Jest setups.',
    )
  }
}

/**
 * Evaluate one generated registry file (`common.style.js`,
 * `<variant>.style.js`, or `schemes.js`) so its `registerAtoms` /
 * `registerBreakpoints` / `registerGradients` / `registerHaptics` /
 * `registerSchemeLoader` calls land in the process-global registries the
 * runtime resolver reads. Imports (`'rnwind'`, `'react-native'`, relative
 * `./common.style`), `require(...)` loaders, and `export {...}` are
 * stripped — every scheme file is evaluated directly, so lazy loaders are
 * inert.
 * @param filePath Absolute path to the generated file.
 */
function evaluateGeneratedFile(filePath: string): void {
  if (!existsSync(filePath)) return
  const body = readFileSync(filePath, 'utf8')
    .replaceAll(/import\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?\s*\n?/g, '')
    .replaceAll(/import\s+['"][^'"]+['"];?\s*\n?/g, '')
    .replaceAll(/export\s+\{[^}]*\}\s*;?\s*\n?/g, '')
  // Generated body is produced by rnwind itself — not user-controlled.
  // `require` is neutralised: each variant file is evaluated directly,
  // so the manifest's lazy `require('./x.style')` loaders are no-ops.
  // eslint-disable-next-line sonarjs/code-eval
  new Function(
    'StyleSheet',
    'registerAtoms',
    'registerMolecules',
    'registerBreakpoints',
    'registerGradients',
    'registerHaptics',
    'registerThemeTokens',
    'registerSchemeLoader',
    'require',
    body,
  )(
    BUNDLE_STYLE_SHEET,
    registerAtoms,
    registerMolecules,
    registerBreakpoints,
    registerGradients,
    registerHaptics,
    registerThemeTokens,
    registerSchemeLoader,
    () => {},
  )
}

/**
 * Sort comparator that floats `common.style.js` to the front, rest alpha.
 * @param a
 * @param b
 */
function commonFirst(a: string, b: string): number {
  if (a === 'common.style.js') return -1
  if (b === 'common.style.js') return 1
  return a.localeCompare(b)
}

/**
 * Evaluate every generated registry the transform wrote (`common` +
 * every variant scheme + the manifest) so the runtime resolver sees the
 * full atom / molecule / gradient / haptic registries — same state a
 * production bundle would hold once all scheme files load.
 * @param cacheDir The rnwind cache dir holding the generated files.
 */
function evaluateGeneratedRegistries(cacheDir: string): void {
  if (!existsSync(cacheDir)) return
  const files = readdirSync(cacheDir).filter((name) => name.endsWith('.style.js'))
  // common first so variants layer their diffs on top of it.
  for (const name of files.toSorted(commonFirst)) {
    evaluateGeneratedFile(path.join(cacheDir, name))
  }
  evaluateGeneratedFile(path.join(cacheDir, 'schemes.js'))
}

/**
 * Move every `const {…} = __rnwind;` / `const {…} = __reactNative;`
 * binding line to the top of the source, preserving order, so they
 * initialise before the transformer's `const View = _rnwWrap(_rnw0)`
 * wrap declarations reference them. Mirrors ESM import hoisting.
 * @param source Source with imports already converted to const-destructures.
 * @returns Source with binding consts hoisted to the front.
 */
function hoistBindingConsts(source: string): string {
  const hoisted: string[] = []
  const rest: string[] = []
  for (const line of source.split('\n')) {
    if (/=\s*__(?:rnwind|reactNative);\s*$/.test(line)) hoisted.push(line)
    else rest.push(line)
  }
  return [...hoisted, ...rest].join('\n')
}

/**
 * Evaluate the transformer's rewritten source as a standalone module:
 * strip synthetic generated imports, forward `import ... from 'rnwind'`
 * (incl. the injected `wrap as _rnwWrap`) and `'react-native'` to local
 * bindings, compile JSX via the compiler, and capture the default export.
 * Aliased named imports (`{ View as _rnw0 }`) are converted to valid
 * destructuring (`{ View: _rnw0 }`). The import-derived `const`s are then
 * hoisted above the body: the transformer injects `const View =
 * _rnwWrap(_rnw0)` ahead of the (real-ESM-hoisted) `import … as _rnw0`,
 * so without re-hoisting the binding the eval would hit a TDZ on `_rnw0`.
 * @param transformedSource Post-transformer source.
 * @param reactNative `react-native` namespace bindings to forward.
 * @returns The default-exported component.
 */
function evaluateRewrittenModule(
  transformedSource: string,
  reactNative: Record<string, unknown>,
): React.ComponentType<Record<string, unknown>> {
  const prepared = transformedSource
    .replaceAll(/import\s+["']rnwind\/__generated\/[^"']+["'];?\s*\n?/g, '')
    .replaceAll(/import\s+\{([^}]+)\}\s+from\s+["']rnwind["'];?/g, (_m, spec: string) => `const {${spec.replaceAll(/\bas\b/g, ':')}} = __rnwind;`)
    .replaceAll(/import\s+\{([^}]+)\}\s+from\s+["']react-native["'];?/g, (_m, spec: string) => `const {${spec.replaceAll(/\bas\b/g, ':')}} = __reactNative;`)
    .replace(/export\s+default\s+/, 'module.exports.default = ')

  const compiled = compileToJs(hoistBindingConsts(prepared))
  const moduleObject: { exports: { default?: React.ComponentType<Record<string, unknown>> } } = { exports: {} }
  // Compiled source originates from rnwind's own transformer + the JSX compiler.
  // eslint-disable-next-line sonarjs/code-eval
  new Function('React', '__rnwind', '__reactNative', 'module', compiled)(React, rnwindRuntime, reactNative, moduleObject)
  if (!moduleObject.exports.default) {
    throw new Error('rnwind/testing: evaluated module did not export a default component.')
  }
  return moduleObject.exports.default
}

/**
 * Build the root element `@testing-library/react-native`'s `render`
 * receives. When a scheme is specified, wrap the component in a live
 * `<RnwindProvider>` so hooks like `useScheme()` and `useCss()` return
 * the requested scheme. Otherwise render bare (context falls back to the
 * default `'light'`).
 * @param Component Component to render.
 * @param scheme Optional active scheme override.
 * @param insets
 * @param onHaptics
 * @returns The React element to hand to `render`.
 */
function buildRootElement(
  Component: React.ComponentType<Record<string, unknown>>,
  scheme: string | undefined,
  insets: Partial<Insets> | undefined,
  onHaptics: OnHaptics | undefined,
): React.ReactElement {
  const child = React.createElement(Component)
  if (scheme === undefined && !insets && !onHaptics) return child
  const providerProps: { scheme: SchemeName; insets?: Partial<Insets>; onHaptics?: OnHaptics } = {
    scheme: (scheme ?? 'light') as SchemeName,
  }
  if (insets) providerProps.insets = insets
  if (onHaptics) providerProps.onHaptics = onHaptics
  return React.createElement(RnwindProvider, providerProps, child)
}

/**
 * Compose the `wrapper` option `renderHook` accepts. When a scheme is
 * set, wrap the hook's execution context in `<RnwindProvider>` so hooks
 * that read `useScheme()` see the requested scheme. If the user also
 * supplies their own wrapper, nest it inside the provider so both apply.
 * @param scheme Optional active scheme override.
 * @param userWrapper Optional user-supplied wrapper component.
 * @returns A wrapper component suitable for `renderHook`'s `wrapper` option.
 */
function composeHookWrapper(
  scheme: string | undefined,
  userWrapper: React.ComponentType<{ children?: React.ReactNode }> | undefined,
): React.ComponentType<{ children?: React.ReactNode }> | undefined {
  if (scheme === undefined && !userWrapper) return undefined
  return function RnwindTestWrapper({ children }: { children?: React.ReactNode }): React.ReactElement {
    const inner = userWrapper ? React.createElement(userWrapper, null, children) : (children as React.ReactElement)
    if (scheme === undefined) return inner
    return React.createElement(RnwindProvider, { scheme: scheme as SchemeName }, inner)
  }
}

/**
 * Spin up an ephemeral rnwind project and register the atoms produced
 * by `source` (when provided) into the runtime. Returns the project
 * state and the post-transform source so callers can render the
 * rewritten module or just rely on the registered atoms.
 *
 * Shared between `renderWithCss` (needs the rewritten component) and
 * `renderHookWithCss` (only needs the atoms in the registry).
 * @param options Options controlling the theme and pre-registered source.
 * @param options.themeCss Theme CSS override.
 * @param options.source Source whose Tailwind candidates should be registered.
 * @returns Paths plus the transformed source and a `cleanup` closure.
 */
async function bootstrapRnwindRuntime(options: { themeCss?: string; source?: string }): Promise<{
  projectRoot: string
  cacheDir: string
  transformedSource: string
  cleanup: () => void
}> {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'rnwind-test-'))
  const cacheDir = path.join(projectRoot, '.rnwind-cache')
  const cssPath = path.join(projectRoot, 'theme.css')
  writeFileSync(cssPath, options.themeCss ?? DEFAULT_THEME_CSS)
  configureRnwindState(cssPath, cacheDir)

  let transformedSource = ''
  if (options.source !== undefined) {
    const filename = path.join(projectRoot, 'App.tsx')
    writeFileSync(filename, options.source)
    const ast: BabelFile = parse(options.source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    const result = await metroTransform({ filename, src: options.source, options: { projectRoot }, ast })
    transformedSource = generate(result.ast).code
    evaluateGeneratedRegistries(cacheDir)
  }

  const cleanup = (): void => {
    __resetLookupCssState()
    __resetResolveState()
    resetRnwindState()
    if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true })
  }

  return { projectRoot, cacheDir, transformedSource, cleanup }
}

/**
 * Synthesize a throwaway source file that mentions each className in a
 * JSX `className="..."` attribute so the Metro transformer's scanner
 * picks them up and records their resolved styles into the union
 * `style.js`. Used by `renderHookWithCss` to pre-register atoms the
 * hook under test will look up.
 * @param classNames Class names to include.
 * @returns Source string suitable for `bootstrapRnwindRuntime`.
 */
function sourceFromClassNames(classNames: readonly string[]): string {
  const joined = classNames.join(' ').replaceAll('"', String.raw`\"`)
  return `const V: any = () => null\nexport default () => <V className="${joined}" />\n`
}

// ────────────────────────────────────────────────────────────────────────
// Public exports — types
// ────────────────────────────────────────────────────────────────────────

/** Exact signature of `@testing-library/react-native`'s `render`. */
export type Render = typeof testingLibraryRender

/** Exact signature of `@testing-library/react-native`'s `renderHook`. */
export type RenderHook = typeof testingLibraryRenderHook

/**
 * Exact return type of `@testing-library/react-native`'s `render` — we
 * re-export the upstream type so tests get every query (`getByTestId`,
 * `queryByText`, `rerender`, `unmount`, `debug`, `UNSAFE_root`, …) with
 * its real signature.
 */
export type TestingLibraryRenderAPI = ReturnType<typeof testingLibraryRender>

/** Options accepted by {@link renderWithCss}. */
export interface RenderWithCssOptions {
  /** Theme CSS fed to rnwind's parser. Defaults to {@link DEFAULT_THEME_CSS}. */
  themeCss?: string
  /**
   * Active scheme the runtime resolver uses. Defaults to `'light'`.
   * Flip to `'dark'` / `'brand'` / ... to exercise scheme-variant atoms.
   */
  scheme?: string
  /**
   * Safe-area insets to inject. When provided, the component tree is
   * rendered under a `<RnwindProvider insets={...}>` so `*-safe` atoms
   * resolve to real numbers instead of the `0` fallback. Partial is
   * accepted — missing sides default to zero.
   */
  insets?: Partial<Insets>
  /**
   * Haptic dispatcher forwarded onto the implicit `<RnwindProvider>`.
   * Tests pass a spy callback to assert which haptic atoms fired.
   */
  onHaptics?: OnHaptics
  /**
   * `react-native` namespace bindings forwarded into the rewritten
   * module. Defaults to importing the test process's `react-native`
   * (typically a mocked stub). Override to inject custom host elements.
   */
  reactNative?: Record<string, unknown>
}

/**
 * Result of a {@link renderWithCss} call. Every key from
 * `@testing-library/react-native`'s `render` return value is spread onto
 * this object — `getByTestId`, `queryByText`, `rerender`, `unmount`,
 * `debug`, etc. — so tests use the testing-library API directly.
 *
 * Two rnwind-specific handles are added:
 *  - `transformedSource` — the exact code the rnwind Metro transformer
 *    emitted for your input. Log it to confirm the rewrite.
 *  - `cleanup` — tears down the ephemeral rnwind state + chunk cache dir.
 *    Call from `afterEach` so successive tests don't share atoms.
 */
export type RenderWithCssResult = TestingLibraryRenderAPI & {
  /** The post-transformer source text. Same code Metro would ship. */
  transformedSource: string
  /** Tear down the ephemeral rnwind state + cache dir. */
  cleanup: () => void
}

/** Options accepted by {@link renderHookWithCss}. */
export interface RenderHookWithCssOptions<Props> extends RenderHookOptions<Props> {
  /** Theme CSS fed to rnwind's parser. Defaults to the built-in minimal theme. */
  themeCss?: string
  /**
   * Active scheme the runtime resolver uses. Defaults to `'light'`. When
   * set, the hook is wrapped in `<RnwindProvider scheme={scheme}>` so
   * `useScheme()` / `useCss()` observe the override.
   */
  scheme?: string
  /**
   * Class names to pre-register into the runtime atom registry before
   * the hook runs. rnwind synthesizes a throwaway source file mentioning
   * these classes, feeds it through the real Metro transformer, and
   * evaluates the generated `style.js` bundle — so the hook sees
   * exactly the atoms the production bundle would register.
   */
  classNames?: readonly string[]
}

/**
 * Result of a {@link renderHookWithCss} call. Mirrors
 * `@testing-library/react-native`'s `renderHook` return type — `result`,
 * `rerender`, `unmount` — and adds a `cleanup` that tears down the
 * ephemeral rnwind state.
 */
export type RenderHookWithCssResult<Result, Props> = ReturnType<typeof testingLibraryRenderHook<Result, Props>> & {
  /** Tear down the ephemeral rnwind state + cache dir. */
  cleanup: () => void
}

// ────────────────────────────────────────────────────────────────────────
// Public exports — functions
// ────────────────────────────────────────────────────────────────────────

/**
 * Feed a source string through rnwind's Metro transformer, evaluate
 * the generated `style.js` bundle, evaluate the rewritten module, and
 * render the default-exported component with
 * `@testing-library/react-native`.
 *
 * The rendered RN element's `style` prop is the EXACT array your
 * production bundle would attach — same transformer, same runtime
 * resolver, same atoms. Assert on `flatten(node.props.style)` to verify
 * the resolved values.
 * @example
 * ```tsx
 * const handle = await renderWithCss(
 *   `import { View } from 'react-native'
 *    export default () => <View className="bg-primary p-4" testID="box" />`,
 *   { themeCss: `@import 'tailwindcss'; @theme { --color-primary: #6366f1; }` },
 * )
 * const flat = flatten(handle.getByTestId('box').props.style)
 * expect(flat.backgroundColor).toBe('#6366f1')
 * ```
 * @param source User source (one file) to transform + render.
 * @param options Optional theme override, scheme, and `react-native` bindings.
 * @returns Render queries + diagnostic handles.
 */
export async function renderWithCss(source: string, options: RenderWithCssOptions = {}): Promise<RenderWithCssResult> {
  const reactNative = options.reactNative ?? resolveReactNative()
  const {
    projectRoot: _projectRoot,
    transformedSource,
    cleanup,
  } = await bootstrapRnwindRuntime({
    themeCss: options.themeCss,
    source,
  })
  const Component = evaluateRewrittenModule(transformedSource, reactNative)
  const rendered = TESTING_LIBRARY.render(buildRootElement(Component, options.scheme, options.insets, options.onHaptics))
  return Object.assign({}, rendered, { transformedSource, cleanup })
}

/**
 * Render-side counterpart to {@link renderWithCss} for testing hooks in
 * isolation. Pre-registers atoms for the supplied `classNames`, wraps
 * the hook in an optional `<RnwindProvider>`, and forwards to
 * `@testing-library/react-native`'s `renderHook`.
 * @example
 * ```ts
 * const { result, cleanup } = await renderHookWithCss(
 *   () => useCss('bg-primary'),
 *   {
 *     themeCss: `@import 'tailwindcss'; @theme { --color-primary: #6366f1; }`,
 *     classNames: ['bg-primary'],
 *   },
 * )
 * expect(flatten(result.current).backgroundColor).toBe('#6366f1')
 * cleanup()
 * ```
 * @param callback Hook body — same shape as `renderHook(callback)`.
 * @param options Theme, scheme, classNames to pre-register, plus
 *   everything `renderHook` itself accepts (`initialProps`, `wrapper`).
 * @returns `renderHook`'s return value plus a `cleanup` function.
 */
export async function renderHookWithCss<Result, Props = unknown>(
  callback: (props: Props) => Result,
  options: RenderHookWithCssOptions<Props> = {},
): Promise<RenderHookWithCssResult<Result, Props>> {
  const { cleanup } = await bootstrapRnwindRuntime({
    themeCss: options.themeCss,
    source: options.classNames && options.classNames.length > 0 ? sourceFromClassNames(options.classNames) : undefined,
  })
  const wrapper = composeHookWrapper(options.scheme, options.wrapper as RenderHookWithCssOptions<Props>['wrapper'])
  const { themeCss: _themeCss, scheme: _scheme, classNames: _classNames, ...hookOptions } = options
  const rendered = TESTING_LIBRARY.renderHook<Result, Props>(callback, {
    ...(hookOptions as RenderHookOptions<Props>),
    wrapper,
  })
  return Object.assign({}, rendered, { cleanup })
}

/**
 * Flatten a React Native style array (or single style object) into one
 * merged record. RN flattens left-to-right (later wins), so the returned
 * record is what the native view manager actually applies.
 * @param styles Style array, single object, or null/undefined.
 * @returns Flat style record.
 */
export function flatten(styles: unknown): Record<string, unknown> {
  if (styles == null) return {}
  if (Array.isArray(styles)) return Object.assign({}, ...styles.map((entry) => flatten(entry)))
  if (typeof styles === 'object') return styles as Record<string, unknown>
  return {}
}
