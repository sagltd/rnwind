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
/** Module the wrapper is imported from. */
const RUNTIME_MODULE = 'rnwind'

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
  ['react-native-reanimated', 'all'],
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
 * @param policy The module's wrap policy.
 * @param importedName The exported name being imported.
 * @returns True when the name is a component to wrap.
 */
function shouldWrap(policy: WrapPolicy, importedName: string): boolean {
  return policy === 'all' ? true : policy.has(importedName)
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

  for (const node of ast.program.body) {
    if (!t.isImportDeclaration(node)) continue
    const policy = modules.get(node.source.value)
    if (!policy) continue
    for (const specifier of node.specifiers) {
      if (!t.isImportSpecifier(specifier)) continue
      const importedName = importedNameOf(specifier)
      if (!shouldWrap(policy, importedName)) continue
      const localName = specifier.local.name
      const alias = `_rnw${counter}`
      counter += 1
      specifier.local = t.identifier(alias)
      wrapDecls.push(
        t.variableDeclaration('const', [
          t.variableDeclarator(t.identifier(localName), t.callExpression(t.identifier(WRAP_LOCAL), [t.identifier(alias)])),
        ]),
      )
    }
  }

  if (wrapDecls.length === 0) return false
  ast.program.body.unshift(
    t.importDeclaration([t.importSpecifier(t.identifier(WRAP_LOCAL), t.identifier('wrap'))], t.stringLiteral(RUNTIME_MODULE)),
    ...wrapDecls,
  )
  return true
}
