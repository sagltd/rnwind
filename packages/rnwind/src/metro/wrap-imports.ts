import * as t from '@babel/types'
import type { File } from '@babel/types'

/**
 * Build-time import rewrite. For every `import { View } from
 * 'react-native'` (and the other configured modules) it aliases the
 * original export and binds a `wrap()`-ed component in its place:
 *
 * ```
 * import { View, StyleSheet } from 'react-native'
 * ⇩
 * import { View as _rnw0, StyleSheet } from 'react-native'
 * import { wrap as _rnwWrap } from 'rnwind'
 * const View = _rnwWrap(_rnw0)
 * ```
 *
 * Now `<View className="…">` resolves className → style at render via the
 * wrapper — no matter how className arrived (literal, `{...rest}` spread,
 * forwarded through custom layers). Non-component exports (`StyleSheet`)
 * are left untouched.
 */

/** Local binding the injected `wrap` import is aliased to. */
const WRAP_LOCAL = '_rnwWrap'
/** Local binding the injected `wrapNamespace` import is aliased to. */
const WRAP_NS_LOCAL = '_rnwWrapNs'
/** Module the wrapper is imported from. */
const RUNTIME_MODULE = 'rnwind'

/**
 * Wrap-modules whose DEFAULT export is a component NAMESPACE accessed via
 * member expressions (`Animated.View`), not a single component. Their
 * default import is bound through `wrapNamespace` (a Proxy that wraps each
 * accessed component member) instead of `wrap`. Every other default import
 * is treated as a plain component.
 */
const NAMESPACE_DEFAULT_MODULES: ReadonlySet<string> = new Set(['react-native-reanimated'])

/**
 * react-native mixes styleable components with utilities (`StyleSheet`,
 * `Platform`, …). Only these named exports are wrapped; everything else
 * passes through. Other ecosystem modules export components only and use
 * the `'all'` policy instead.
 */
const REACT_NATIVE_COMPONENTS: ReadonlySet<string> = new Set([
  'View',
  'Text',
  'TextInput',
  'Pressable',
  'ScrollView',
  'Image',
  'ImageBackground',
  'FlatList',
  'SectionList',
  'VirtualizedList',
  'KeyboardAvoidingView',
  'SafeAreaView',
  'Modal',
  'Switch',
  'RefreshControl',
  'ActivityIndicator',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
  'TouchableNativeFeedback',
  'Button',
  'StatusBar',
])

/**
 * Named exports that LOOK like components (PascalCase) under an `'all'`
 * policy but aren't — React contexts, gesture-handler enums/namespaces,
 * etc. Wrapping these would turn `Gesture.Pan()` / `State.ACTIVE` /
 * `<XContext.Provider>` into a `wrap()`-ed component and break them.
 * Names ending in `Context` are excluded separately.
 */
const NON_COMPONENT_EXPORTS: ReadonlySet<string> = new Set([
  'Gesture',
  'GestureObjects',
  'State',
  'Directions',
  'Extrapolation',
  'Extrapolate',
  'Easing',
  'ReduceMotion',
  'KeyframeRegistry',
  // gesture-handler enums (PascalCase, but value objects accessed as
  // `PointerType.TOUCH` / `MouseButton.LEFT`) — wrapping breaks the access.
  'PointerType',
  'MouseButton',
  'HoverEffect',
])

/**
 * react-native-reanimated's NAMED exports are hooks, worklets, animation
 * builders (`FadeIn`, `ZoomIn`, `Keyframe`, `Layout`…), easing helpers and
 * enums (`SensorType`…) — NOT className-styleable components. Its only
 * styleable surface is the DEFAULT `Animated` namespace, wrapped separately
 * via {@link NAMESPACE_DEFAULT_MODULES}. Under the `'all'` policy the
 * PascalCase heuristic wrongly wrapped builders/enums into `wrap()`-ed
 * functions, so `FadeIn.duration()` / `new Keyframe()` / `SensorType.X` threw
 * "is not a function" / "is not a constructor" / read `undefined`. An empty
 * allow-list wraps none of them while leaving the default namespace intact.
 */
const REANIMATED_NAMED_COMPONENTS: ReadonlySet<string> = new Set()

/** Per-module policy: an explicit allow-list, or `'all'` named exports. */
export type WrapPolicy = 'all' | ReadonlySet<string>

/**
 * Default module → wrap policy. react-native is allow-listed (mixed
 * exports); the rest are component-only packages → `'all'`. Only modules
 * the project has installed are ever hit (you can't import from a missing
 * package), so listing optional peers is free.
 */
export const DEFAULT_WRAP_MODULES: ReadonlyMap<string, WrapPolicy> = new Map<string, WrapPolicy>([
  ['react-native', REACT_NATIVE_COMPONENTS],
  ['react-native-reanimated', REANIMATED_NAMED_COMPONENTS],
  ['react-native-svg', 'all'],
  ['react-native-gesture-handler', 'all'],
  ['react-native-safe-area-context', 'all'],
  ['expo-linear-gradient', 'all'],
  ['expo-image', 'all'],
  ['expo-blur', 'all'],
  ['expo-symbols', 'all'],
  ['@shopify/flash-list', 'all'],
  ['@shopify/react-native-skia', 'all'],
  ['lottie-react-native', 'all'],
])

/**
 * Whether a named import from a wrap-module should be wrapped.
 *
 * Explicit allow-lists (react-native) match by exact name. The `'all'`
 * policy wraps only component-style names — PascalCase, not a React
 * context (`*Context`), and not a known non-component export. This is
 * what stops `useSafeAreaInsets` (a hook) from being wrapped into a
 * component and crashing when called.
 * @param policy The module's wrap policy.
 * @param importedName The exported name being imported.
 * @returns True when the name is a component to wrap.
 */
function shouldWrap(policy: WrapPolicy, importedName: string): boolean {
  if (policy !== 'all') return policy.has(importedName)
  if (!/^[A-Z]/.test(importedName)) return false
  if (importedName.endsWith('Context')) return false
  return !NON_COMPONENT_EXPORTS.has(importedName)
}

/**
 * Merge user-supplied wrap modules onto the defaults — a bare module name
 * adopts the `'all'` policy.
 * @param extra User module specifiers (or undefined).
 * @returns Effective module → policy map.
 */
export function buildWrapModules(extra?: readonly string[]): ReadonlyMap<string, WrapPolicy> {
  if (!extra || extra.length === 0) return DEFAULT_WRAP_MODULES
  const merged = new Map<string, WrapPolicy>(DEFAULT_WRAP_MODULES)
  for (const moduleName of extra) if (!merged.has(moduleName)) merged.set(moduleName, 'all')
  return merged
}

/**
 * The `imported` name of an import specifier (`import { a as b }` → `'a'`).
 * @param specifier Named import specifier.
 * @returns The exported name.
 */
function importedNameOf(specifier: t.ImportSpecifier): string {
  return t.isIdentifier(specifier.imported) ? specifier.imported.name : specifier.imported.value
}

/**
 * Whether an import kind is type-only (`import type …` / `import { type … }`,
 * and the Flow `typeof` variants). Type-only bindings carry no runtime value —
 * preset-typescript strips them from the bundle — so wrapping one emits a
 * `const X = wrap(_rnwN)` referencing a binding that no longer exists at
 * runtime → Hermes "Property '_rnwN' doesn't exist". They must never be wrapped.
 * @param kind The `importKind` of a declaration or specifier.
 * @returns True when the import is type-only.
 */
function isTypeOnly(kind: t.ImportDeclaration['importKind'] | t.ImportSpecifier['importKind']): boolean {
  return kind === 'type' || kind === 'typeof'
}

/**
 * Build `const Local = <wrapper>(alias)` and rebind the specifier's local
 * to `alias` in place.
 * @param specifier The import specifier to rebind.
 * @param alias The `_rnwN` alias to bind the original import to.
 * @param wrapper The runtime helper local (`_rnwWrap` / `_rnwWrapNs`).
 * @returns The wrap declaration.
 */
function makeWrapDecl(
  specifier: t.ImportSpecifier | t.ImportDefaultSpecifier | t.ImportNamespaceSpecifier,
  alias: string,
  wrapper: string,
): t.VariableDeclaration {
  const { name: localName } = specifier.local
  specifier.local = t.identifier(alias)
  return t.variableDeclaration('const', [
    t.variableDeclarator(t.identifier(localName), t.callExpression(t.identifier(wrapper), [t.identifier(alias)])),
  ])
}

/**
 * Rewrite one import declaration's wrappable specifiers, aliasing each to
 * `_rnw<N>` in place:
 *  - named (`{ View }`) → `const View = wrap(_rnwN)` (per policy),
 *  - namespace (`* as Animated`) → `const Animated = wrapNamespace(_rnwN)`,
 *  - default → `wrapNamespace` for {@link NAMESPACE_DEFAULT_MODULES}
 *    (reanimated's `Animated`), else `wrap` (a plain default component).
 * @param node Import declaration to inspect.
 * @param policy The module's wrap policy.
 * @param counter Next alias index (caller-threaded for uniqueness).
 * @returns New wrap declarations, advanced counter, and whether any
 *   binding used `wrapNamespace`.
 */
function wrapSpecifiers(
  node: t.ImportDeclaration,
  policy: WrapPolicy,
  counter: number,
): { decls: t.VariableDeclaration[]; counter: number; usesNamespace: boolean } {
  const decls: t.VariableDeclaration[] = []
  const moduleName = node.source.value
  let next = counter
  let usesNamespace = false
  // `import type { … }` — whole declaration is type-only; nothing to wrap.
  if (isTypeOnly(node.importKind)) return { decls, counter: next, usesNamespace }
  for (const specifier of node.specifiers) {
    if (t.isImportSpecifier(specifier)) {
      // `import { type X }` — inline type-only specifier; skip it.
      if (isTypeOnly(specifier.importKind)) continue
      if (!shouldWrap(policy, importedNameOf(specifier))) continue
      decls.push(makeWrapDecl(specifier, `_rnw${next}`, WRAP_LOCAL))
      next += 1
      continue
    }
    const isNamespace = t.isImportNamespaceSpecifier(specifier) || NAMESPACE_DEFAULT_MODULES.has(moduleName)
    const wrapper = isNamespace ? WRAP_NS_LOCAL : WRAP_LOCAL
    decls.push(makeWrapDecl(specifier, `_rnw${next}`, wrapper))
    next += 1
    if (isNamespace) usesNamespace = true
  }
  return { decls, counter: next, usesNamespace }
}

/**
 * Insert the `wrap` import at the top and the `const X = wrap(_rnwN)`
 * declarations AFTER every import. The consts reference the aliased
 * binding `_rnwN`, and in Metro's real transform (CommonJS interop + the
 * reanimated worklets plugin) a const placed above its source import
 * evaluates before the binding initialises → `ReferenceError: _rnw0
 * doesn't exist`. ESM-only hoisting would mask this; the bundle does not.
 * @param ast Parsed Babel file (mutated).
 * @param wrapDecls The wrap declarations to place.
 * @param usesNamespace Whether any binding used `wrapNamespace`.
 */
function placeWrapDecls(ast: File, wrapDecls: readonly t.VariableDeclaration[], usesNamespace: boolean): void {
  const specifiers = [t.importSpecifier(t.identifier(WRAP_LOCAL), t.identifier('wrap'))]
  if (usesNamespace) specifiers.push(t.importSpecifier(t.identifier(WRAP_NS_LOCAL), t.identifier('wrapNamespace')))
  ast.program.body.unshift(t.importDeclaration(specifiers, t.stringLiteral(RUNTIME_MODULE)))
  let afterImports = 0
  for (let index = 0; index < ast.program.body.length; index += 1) {
    if (t.isImportDeclaration(ast.program.body[index])) afterImports = index + 1
  }
  ast.program.body.splice(afterImports, 0, ...wrapDecls)
}

/**
 * Rewrite component imports from the configured wrap-modules into
 * `wrap()`-ed bindings, in place. Injects the `wrap` import once when any
 * binding was rewritten.
 * @param ast Parsed Babel file (mutated).
 * @param modules Effective module → policy map.
 * @returns True when at least one import was wrapped.
 */
export function rewriteWrapImports(ast: File, modules: ReadonlyMap<string, WrapPolicy>): boolean {
  const wrapDecls: t.VariableDeclaration[] = []
  let counter = 0
  let usesNamespace = false

  for (const node of ast.program.body) {
    if (!t.isImportDeclaration(node)) continue
    const policy = modules.get(node.source.value)
    if (!policy) continue
    const { decls, counter: nextCounter, usesNamespace: ns } = wrapSpecifiers(node, policy, counter)
    counter = nextCounter
    usesNamespace = usesNamespace || ns
    wrapDecls.push(...decls)
  }

  if (wrapDecls.length === 0) return false
  placeWrapDecls(ast, wrapDecls, usesNamespace)
  return true
}
