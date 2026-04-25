import * as t from '@babel/types'
import type { File } from '@babel/types'
import traverseImport, { type NodePath } from '@babel/traverse'
import { createHash } from 'node:crypto'
import type { GradientAtomInfo, GradientDirection, HapticRequest, HapticTrigger } from '../core/parser'
import { detectTextTruncate, mayContainTextTruncate } from '../core/parser/text-truncate'

const traverse = (traverseImport as unknown as { default?: typeof traverseImport }).default ?? traverseImport

/**
 * Name of the internal rnwind context hook the transformer injects at
 * each component top. Must start with `use` + uppercase letter so
 * react-refresh's babel plugin folds it into each component's
 * fast-refresh signature — otherwise stale signatures preserve fiber
 * state across transformer changes and the rendered hook list shifts,
 * which React surfaces as "change in the order of Hooks" runtime errors.
 */
const USE_RNWIND_INTERNAL = 'useR_'
/** Internal alias of `useMountHaptic` — emit `_hm` instead of the public name to dodge shadowing. */
const USE_MOUNT_HAPTIC = '_hm'
/** Internal alias of `triggerHaptic` — `_ht` so a user-defined `triggerHaptic` won't shadow it. */
const TRIGGER_HAPTIC = '_ht'
/** Internal alias of `lookupCss` — `_l` so user can't accidentally shadow at the JSX call sites. */
const LOOKUP_CSS = '_l'
/** Name of the runtime atom-registration entry point imported by the union style file. */
export const REGISTER_ATOMS = 'registerAtoms'
/** Package specifier rnwind runtime primitives import from. */
const RUNTIME_MODULE = 'rnwind'
/** Local binding name for the rnwind context hook result inside components. */
const CONTEXT_BINDING = '_t'
/**
 * Name of the per-instance wrapper component rnwind substitutes for any
 * JSX site that uses active: / focus: variants. One `useInteract()` lives
 * INSIDE each InteractiveBox so siblings never share state — a previous
 * design that called `useInteract()` once per enclosing component caused
 * "press one button, all buttons glow" because every site read the same
 * `_i.state` reference.
 */
const INTERACTIVE_BOX = '_ib'
/** Leading variant prefixes that trigger interact wiring. */
const INTERACTIVE_PREFIXES = ['active:', 'focus:']

/**
 * Regex matching the atom-name shape of every `*-safe` utility the
 * rnwind preset ships. Used by the transformer to decide whether a
 * file needs the `const _i = useInsets()` binding injected. Matches
 * three families:
 *  - `*-safe` exactly (e.g. `pt-safe`, `inset-safe`).
 *  - `*-safe-or-<N>` / `*-safe-offset-<N>` (e.g. `mt-safe-or-4`).
 *  - `*-screen-safe` (e.g. `h-screen-safe`, `min-h-screen-safe`).
 *
 * Dynamic className expressions always inject `_i` — we can't inspect
 * the string at build time, and the runtime slow path reads `SAFE_ATOMS`
 * to pick up any user-defined safe utility the preset doesn't cover.
 */
const SAFE_ATOM_PATTERN = /(?:(?:^|-)safe(?:-or-|-offset-|$))|(?:-screen-safe$)/

/**
 * RN host components that NEVER emit press / focus events — wrapping
 * them in `<InteractiveBox>` buys nothing and costs `useInteract()`'s
 * hooks per mount. When the JSX tag is in this set, we skip the
 * wrapper even for dynamic `className={…}` expressions. On a list of
 * 1000 `<View className={rowCls}>` rows this drops 6 × 1000 hook
 * initialisations per mount.
 *
 * The set is intentionally conservative — anything not listed keeps
 * the wrapper. Custom components, `Animated.View`, and
 * `Pressable`/`TextInput` all still get interactive variants on
 * dynamic className.
 */
const NON_INTERACTIVE_HOST_TAGS = new Set([
  'View',
  'Text',
  'ScrollView',
  'SafeAreaView',
  'Image',
  'ImageBackground',
  'FlatList',
  'SectionList',
  'VirtualizedList',
  'KeyboardAvoidingView',
  'ActivityIndicator',
  'RefreshControl',
  'Fragment',
])

/** Per-file state returned by the transformer, for the caller to integrate with the atom ledger. */
export interface TransformAstResult {
  /** `true` when the AST was mutated (any `className=` rewrite landed). */
  touched: boolean
  /** Atom-name arrays the transformer hoisted — one entry per unique atom set. */
  hoistedArrays: ReadonlyMap<string, readonly string[]>
  /** Candidate literal texts collected from every rewritten `className`. */
  literals: readonly string[]
}

/** Inputs to {@link transformAst}. */
export interface TransformAstOptions {
  /**
   * Module specifiers the transformer side-effect-imports at the top
   * of each rewritten file. Today: the union `style.js` and
   * `keyframes.js` (always two entries — see `STYLE_SPECIFIERS` in
   * resolver.ts). Empty when the file has no atoms to register.
   */
  styleSpecifiers: readonly string[]
  /**
   * Parser-surfaced gradient metadata per atom. The transformer reads
   * this map when rewriting literal `className="..."` sites so it can
   * strip gradient atoms out of the atom array fed to `lookupCss` and
   * emit `colors={...} start={...} end={...}` JSX attributes consumed
   * by `<LinearGradient>` (or any component with the expo prop shape).
   */
  gradientAtoms?: ReadonlyMap<string, GradientAtomInfo>
  /**
   * Parser-surfaced haptic metadata per atom. Keys are the full class
   * name (including any variant prefix — `haptic-light`,
   * `active:haptic-medium`). Values are the structured
   * {@link HapticRequest}. The transformer strips matched atoms from
   * the className, aggregates mount requests per enclosing component,
   * and wires press-in chains directly on the element.
   */
  hapticAtoms?: ReadonlyMap<string, HapticRequest>
  /**
   * Extra prop-name prefixes that turn `<prefix>ClassName="…"` into
   * `<prefix>Style={lookupCss(…)}` with the same plumbing as the plain
   * `className` path. The built-in `'contentContainer'` prefix is always
   * enabled (covers ScrollView / FlatList / SectionList) — entries here
   * are additive, not a replacement. A user-supplied `['myFunny']` yields
   * the effective set `['contentContainer', 'myFunny']`.
   *
   * Prefixed rewrites never go through `<InteractiveBox>`: the targeted
   * sub-surfaces (scroll content containers, column wrappers, etc.)
   * can't fire press / focus events, so we always emit the inline
   * `lookupCss(…)` call regardless of whether the expression is static
   * or dynamic.
   */
  classNamePrefixes?: readonly string[]
  /**
   * Extra module specifiers whose JSX exports the transformer should
   * treat as hosts (rewrite `className` → `style` at compile time).
   * Merged with the built-in {@link DEFAULT_HOST_SOURCES} list. Use
   * this for design-system packages whose primitives wrap RN hosts and
   * accept `style` directly.
   */
  hostSources?: readonly string[]
  /**
   * Extra component names (verbatim, including dotted member access
   * like `'Animated.View'`) the transformer should treat as hosts. Use
   * this for one-off escape-hatches that aren't matchable by source —
   * e.g. you alias `View as MyBox` and want the compile-time path.
   */
  hostComponents?: readonly string[]
}

/**
 * Built-in prefix that's always active — covers the React Native
 * ecosystem's `contentContainerStyle` pattern on ScrollView / FlatList /
 * SectionList. Users who pass `classNamePrefixes` get their list merged
 * on top, never replacing this.
 */
const DEFAULT_CLASSNAME_PREFIXES: readonly string[] = ['contentContainer']

/**
 * Module specifiers whose JSX exports are "host-like" — they consume
 * `style` directly (and own no opaque component logic that depends on
 * receiving the raw `className` string). For tags imported from these
 * sources the transformer rewrites `className="…"` → `style={lookupCss(…)}`
 * at build time, so the runtime cost is zero.
 *
 * For tags from ANY other source the transformer leaves `className`
 * alone — the importing component receives the raw string and decides
 * what to do with it (forward to an inner host, reshape, route a slice
 * to `contentContainerStyle`, …). This is what makes patterns like
 * `<MyButton className="px-4 bg-primary" />` work without rnwind
 * stealing the prop before the component sees it.
 *
 * Users extend the list via `withRnwindConfig`'s `hostSources` option.
 */
const DEFAULT_HOST_SOURCES: readonly string[] = [
  'react-native',
  'react-native-reanimated',
  'react-native-svg',
  'react-native-gesture-handler',
  'react-native-safe-area-context',
  'expo-linear-gradient',
  'expo-image',
  'expo-blur',
  'expo-symbols',
  '@shopify/flash-list',
  '@shopify/react-native-skia',
  'lottie-react-native',
]

/**
 * Whether a JSX tag name is lowercase. Lowercase tags don't appear in
 * native React Native userland — but if one shows up (web target via
 * `react-native-web`, mdx, etc.) treat it as a host so the rewrite
 * engages instead of silently dropping the className.
 * @param name JSX tag identifier text.
 * @returns True for ASCII-lowercase first character.
 */
function isLowercaseTag(name: string): boolean {
  const code = name.codePointAt(0)
  return code !== undefined && code >= 97 && code <= 122
}

/**
 * Walk a JSX opening element's tag name node into a dotted string
 * (`Animated.View`, `Foo.Bar.Baz`). Returns `null` for namespaced names
 * (`<svg:rect>` — invalid in RN; we skip them).
 * @param name JSXOpeningElement name node.
 * @returns Dotted tag text, or null.
 */
function jsxTagText(name: t.JSXOpeningElement['name']): string | null {
  if (t.isJSXIdentifier(name)) return name.name
  if (t.isJSXMemberExpression(name)) {
    const left = jsxTagText(name.object as t.JSXOpeningElement['name'])
    return left ? `${left}.${name.property.name}` : null
  }
  return null
}

/**
 * Leftmost identifier of a (possibly dotted) tag — used to look up its import source.
 * @param tagText
 */
function leftmostIdentifier(tagText: string): string {
  const dot = tagText.indexOf('.')
  return dot === -1 ? tagText : tagText.slice(0, dot)
}

/** Resolves a tag-text to "is this a host?" using import sources + user-extended host names. */
type HostLookup = (tagText: string) => boolean

/**
 * Build the per-file host lookup. Walks every `import` declaration once
 * to map every locally-bound name to its source module. A JSX tag is a
 * host when:
 *  1. its full text matches an entry in `extraHostComponents` (verbatim),
 *  2. its leftmost identifier was imported from a `hostSources` module,
 *  3. it's a lowercase tag (web targets, defensive).
 *
 * Anything else is custom and the transformer leaves its className alone.
 * @param ast File AST.
 * @param extraHostSources User-supplied additional host module specifiers.
 * @param extraHostComponents User-supplied additional host component names.
 * @returns Lookup callback.
 */
function buildHostLookup(
  ast: File,
  extraHostSources: readonly string[] | undefined,
  extraHostComponents: readonly string[] | undefined,
): HostLookup {
  const importSourceByLocal = new Map<string, string>()
  for (const node of ast.program.body) {
    if (!t.isImportDeclaration(node)) continue
    const source = node.source.value
    for (const spec of node.specifiers) {
      if (t.isImportDefaultSpecifier(spec) || t.isImportSpecifier(spec) || t.isImportNamespaceSpecifier(spec)) {
        importSourceByLocal.set(spec.local.name, source)
      }
    }
  }
  // Recognise module-local host aliases — common pattern in React Native:
  //   const AnimatedTextInput = Animated.createAnimatedComponent(TextInput)
  //   const Animated = createAnimatedComponent(View)
  // The local binding wraps a host underneath so its className must still
  // be rewritten. Without this every `<AnimatedTextInput className="…" />`
  // site looked custom and the className silently dropped.
  const localHostAliases = collectCreateAnimatedComponentAliases(ast)
  const hostSources = new Set<string>([...DEFAULT_HOST_SOURCES, ...(extraHostSources ?? [])])
  const hostComponents = new Set<string>(extraHostComponents)
  return (tagText: string): boolean => {
    if (isLowercaseTag(tagText)) return true
    if (hostComponents.has(tagText)) return true
    const left = leftmostIdentifier(tagText)
    if (localHostAliases.has(left)) return true
    const source = importSourceByLocal.get(left)
    return source !== undefined && hostSources.has(source)
  }
}

/**
 * Walk top-level `const X = createAnimatedComponent(Y)` /
 * `Animated.createAnimatedComponent(Y)` declarations and return the set
 * of local names so the host-lookup recognises them. Reanimated +
 * RN-core `Animated.createAnimatedComponent` are the only creators in
 * common use; matching by callee-name covers both shapes without
 * needing import-source resolution.
 * @param ast File AST.
 * @returns Set of locally-bound names that wrap a host component.
 */
function collectCreateAnimatedComponentAliases(ast: File): ReadonlySet<string> {
  const aliases = new Set<string>()
  for (const node of ast.program.body) {
    const declaration = t.isExportNamedDeclaration(node) ? node.declaration : node
    if (!t.isVariableDeclaration(declaration)) continue
    for (const decl of declaration.declarations) {
      if (!t.isIdentifier(decl.id) || !decl.init) continue
      if (!isCreateAnimatedComponentCall(decl.init)) continue
      aliases.add(decl.id.name)
    }
  }
  return aliases
}

/** True for `createAnimatedComponent(...)` and `<x>.createAnimatedComponent(...)` calls. */
function isCreateAnimatedComponentCall(expr: t.Expression): boolean {
  if (!t.isCallExpression(expr)) return false
  const { callee } = expr
  if (t.isIdentifier(callee) && callee.name === 'createAnimatedComponent') return true
  if (t.isMemberExpression(callee) && t.isIdentifier(callee.property) && callee.property.name === 'createAnimatedComponent') return true
  return false
}

/**
 * Mutate an already-parsed Babel AST in place:
 *  - Rewrite every JSX `className="…"` / `className={expr}` attribute to
 *    `style={lookupCss(<ref|expr>, _s, <existingStyle>)}`. Static string
 *    literals get a module-scope `const _c_<hash> = Object.freeze(['a',
 *    'b'])` hoist so React sees an identity-stable array across renders.
 *  - Preserve any adjacent `style={…}` prop — it becomes the third
 *    argument so user inline styles keep working (and trump atoms).
 *  - Inject `const _s = useScheme()` at the top of the enclosing
 *    function component (idempotent — one injection per component).
 *  - Prepend `import { lookupCss, useScheme } from 'rnwind'`.
 *  - Prepend a side-effect `import 'rnwind/__generated/style'` so the
 *    union registry is loaded before any hoist runs.
 * @param ast Babel File AST (usually handed to us by Metro).
 * @param options Extra inputs — side-effect import specifiers + parser metadata.
 * @returns Transform outcome flags + the hoist table.
 */
export function transformAst(ast: File, options: TransformAstOptions): TransformAstResult {
  const hoister = createHoister()
  const gradientHoister = createGradientHoister()
  const literals: string[] = []
  const prefixSet = buildPrefixSet(options.classNamePrefixes)
  const hapticHoister = createHapticHoister()
  const isHostTag = buildHostLookup(ast, options.hostSources, options.hostComponents)
  const rewriteCtx: RewriteContext = {
    needsInsets: false,
    gradientAtoms: options.gradientAtoms ?? EMPTY_GRADIENT_ATOMS,
    gradientHoister,
    hapticAtoms: options.hapticAtoms ?? EMPTY_HAPTIC_ATOMS,
    hapticHoister,
    mountByComponent: new Map(),
    needsHapticsHook: false,
  }
  let touched = false
  let usedLookupCss = false
  let usedInteractiveBox = false
  // Per-element host classification, captured the first time we see each
  // JSXOpeningElement. Necessary because the InteractiveBox wrap mutates
  // `parent.name` in-place from the original tag → `_ib`; sibling
  // attributes processed AFTER the swap would otherwise re-classify off
  // the now-meaningless `_ib` name and skip rewrites they should do
  // (e.g. `contentContainerClassName` next to an `active:` className on
  // the same `<ScrollView>`).
  const customElements = new WeakSet<t.JSXOpeningElement>()
  const classifiedElements = new WeakSet<t.JSXOpeningElement>()

  traverse(ast, {
    JSXAttribute(attributePath: NodePath<t.JSXAttribute>) {
      const { node } = attributePath
      if (!t.isJSXIdentifier(node.name)) return
      const target = classifyAttributeName(node.name.name, prefixSet)
      if (!target) return
      // Skip className rewrite when the parent JSX tag is a custom
      // component (not imported from a known host source). Custom
      // components own their `className` prop — the transformer would
      // steal the string from under them otherwise. The literal still
      // appears in source text, so oxide still discovers its atoms via
      // the project scan; the inner host that ultimately consumes the
      // forwarded className gets rewritten by ITS file's transform.
      const { parent } = attributePath
      if (t.isJSXOpeningElement(parent)) {
        if (!classifiedElements.has(parent)) {
          classifiedElements.add(parent)
          const tagText = jsxTagText(parent.name)
          if (tagText !== null && !isHostTag(tagText)) customElements.add(parent)
        }
        if (customElements.has(parent)) return
      }
      const rewritten = rewriteClassNameAttribute(attributePath, hoister, literals, rewriteCtx, target)
      if (!rewritten) return
      touched = true
      if (rewritten.injectedInteract) usedInteractiveBox = true
      else usedLookupCss = true
    },
  })

  if (!touched && options.styleSpecifiers.length === 0) return { touched: false, hoistedArrays: hoister.entries, literals }

  // Inject `useMountHaptic(<hoisted>)` per component that had bare
  // haptic atoms. Done post-traversal so we know every aggregated
  // request up front and can hoist one frozen array per component.
  injectMountHapticCalls(rewriteCtx)
  const usedMountHaptic = rewriteCtx.mountByComponent.size > 0
  prependRuntimeImports(
    ast,
    {
      usedLookupCss,
      usedInteractiveBox,
      usedMountHaptic,
      usedTriggerHaptic: rewriteCtx.needsHapticsHook,
      touched,
    },
    options.styleSpecifiers,
  )
  if (hoister.entries.size > 0) injectHoistedConsts(ast, hoister.entries)
  if (gradientHoister.entries.size > 0) injectGradientConsts(ast, gradientHoister.entries)
  if (hapticHoister.entries.size > 0) injectHapticConsts(ast, hapticHoister.entries)
  return { touched, hoistedArrays: hoister.entries, literals }
}

/** Default empty gradient-atoms map used when callers don't supply one. */
const EMPTY_GRADIENT_ATOMS: ReadonlyMap<string, GradientAtomInfo> = new Map()
/** Default empty haptic-atoms map used when callers don't supply one. */
const EMPTY_HAPTIC_ATOMS: ReadonlyMap<string, HapticRequest> = new Map()

/**
 * Target of one rewrite — which JSX prop we replace and what name the
 * replacement carries. `kind: 'className'` is the classic `className →
 * style` path; `kind: 'prefix'` is `<prefix>ClassName → <prefix>Style`
 * and skips the InteractiveBox wrapper (prefixed sub-surfaces can't
 * fire press / focus events).
 */
type RewriteTarget =
  | { readonly kind: 'className'; readonly styleProp: 'style' }
  | { readonly kind: 'prefix'; readonly styleProp: string }

/**
 * Merge the built-in default prefix with the caller-supplied list. The
 * default (`contentContainer`) is always present; user entries are
 * additive. Returned as a Set so the hot-path visitor classifies one
 * attribute in O(1).
 * @param userPrefixes Extra prefixes the caller wants active.
 * @returns Sorted effective prefix set.
 */
function buildPrefixSet(userPrefixes: readonly string[] | undefined): ReadonlySet<string> {
  const out = new Set<string>(DEFAULT_CLASSNAME_PREFIXES)
  if (userPrefixes) for (const prefix of userPrefixes) out.add(prefix)
  return out
}

/**
 * Decide whether a JSX attribute name is one the transformer should
 * rewrite, and derive the replacement prop name when it is.
 *
 * `className` is the classic path. `<prefix>ClassName` where `prefix`
 * is in the active set becomes `<prefix>Style`. Everything else returns
 * `null` and the visitor moves on.
 * @param name JSXAttribute's identifier text.
 * @param prefixes Effective prefix set for this transform.
 * @returns Rewrite target record, or `null` when the attribute is not ours.
 */
function classifyAttributeName(name: string, prefixes: ReadonlySet<string>): RewriteTarget | null {
  if (name === 'className') return { kind: 'className', styleProp: 'style' }
  if (!name.endsWith('ClassName')) return null
  const prefix = name.slice(0, -'ClassName'.length)
  if (prefix.length === 0 || !prefixes.has(prefix)) return null
  return { kind: 'prefix', styleProp: `${prefix}Style` }
}

/**
 * Rewrite-wide state threaded through every JSXAttribute visit. Right
 * now it's just the insets-injection flag — flipped to `true` when any
 * atom looks like a safe-area utility so the import writer knows to
 * pull in `useInsets` alongside `useScheme`.
 */
interface RewriteContext {
  /** Flipped on the first safe-area atom seen in the file. */
  needsInsets: boolean
  /** Parser-surfaced gradient metadata, keyed by atom name. */
  gradientAtoms: ReadonlyMap<string, GradientAtomInfo>
  /** Hoister for gradient spec consts (colours / start / end). */
  gradientHoister: GradientHoister
  /** Parser-surfaced haptic metadata, keyed by full class name. */
  hapticAtoms: ReadonlyMap<string, HapticRequest>
  /** Hoister for HapticRequest objects + mount-request arrays. */
  hapticHoister: HapticHoister
  /**
   * Aggregates mount-haptic requests per enclosing component body.
   * Populated as JSX is visited; consumed after traversal to inject
   * one `useMountHaptic(...)` call per component.
   */
  mountByComponent: Map<t.BlockStatement, HapticRequest[]>
  /** Flipped on the first event (press / focus / hover) haptic that needs `_h`. */
  needsHapticsHook: boolean
}

/** Per-attribute outcome from {@link rewriteClassNameAttribute}. */
interface RewriteOutcome {
  /** `true` when the element was wired for active/focus interact state. */
  injectedInteract: boolean
}

/**
 * Rewrite one `className` JSXAttribute node.
 *
 * Two paths:
 *  - **Non-interactive** (literal with no `active:` / `focus:` tokens):
 *    emit `style={lookupCss(<ref|expr>, _s [, userStyle])}` inline on
 *    the existing tag. The JSX site keeps its original component.
 *  - **Interactive** (literal with an interactive token OR any dynamic
 *    expression): replace the JSXElement's tag with `<InteractiveBox>`,
 *    move the original tag into a `_rw.as` spec prop, and forward all
 *    other attributes untouched. Each InteractiveBox instance calls
 *    `useInteract()` internally so sibling elements don't share state.
 *
 * If the element has a sibling `style={…}` attribute it's removed and
 * its expression threads through as the user-style merge source.
 * @param attributePath The JSXAttribute path.
 * @param hoister Per-file hoist table.
 * @param literals Output array — each static literal gets pushed so the
 *   caller can feed them into the parser / atom ledger.
 * @param rewriteCtx
 * @param target
 * @returns Outcome flags, or `null` when the attribute was unrewritable.
 */
function rewriteClassNameAttribute(
  attributePath: NodePath<t.JSXAttribute>,
  hoister: Hoister,
  literals: string[],
  rewriteCtx: RewriteContext,
  target: RewriteTarget,
): RewriteOutcome | null {
  const { node } = attributePath
  const { value } = node
  if (!value) return null
  const buildResult = buildFirstArgument(value, hoister, literals, rewriteCtx)
  if (!buildResult) return null
  const { parent } = attributePath
  if (!t.isJSXOpeningElement(parent)) return null
  const userStyleExpr = extractAndDropSiblingStyle(parent, target.styleProp)
  // Single context binding `_t = _r()` — carries scheme, fontScale,
  // insets together so React tracks all three as render deps via one
  // useContext read.
  const ctxBinding = injectContextHook(attributePath)
  applyDerivedJsxAttributes(attributePath, parent, buildResult, target, rewriteCtx)
  // Prefixed rewrites (`<prefix>ClassName`) target a passive sub-surface
  // that can't receive press / focus — skip the InteractiveBox wrapper
  // even for dynamic expressions. Only the plain `className` path is
  // eligible for InteractiveBox routing.
  if (target.kind === 'className' && buildResult.mayBeInteractive && isTagInteractive(parent.name)) {
    rewriteAsInteractiveBox(attributePath, parent, buildResult.expression, ctxBinding, userStyleExpr)
    return { injectedInteract: true }
  }
  const args: t.Expression[] = [buildResult.expression, t.identifier(ctxBinding)]
  // 3rd arg = userStyle (sibling style={…}). 4th arg = interactState
  // (always undefined in the non-interactive branch).
  if (userStyleExpr) args.push(userStyleExpr)
  const call = t.callExpression(t.identifier(LOOKUP_CSS), args)
  attributePath.replaceWith(t.jsxAttribute(t.jsxIdentifier(target.styleProp), t.jsxExpressionContainer(call)))
  return { injectedInteract: false }
}

/**
 * Apply every JSX attribute + side-effect derived from a parsed
 * className literal: gradient props, truncate props, mount-haptic
 * aggregation, and event-haptic handler chaining. Collected in one
 * helper so {@link rewriteClassNameAttribute} stays under the
 * complexity cap.
 * @param attributePath Path of the className attribute being rewritten.
 * @param parent Opening element to mutate.
 * @param result Per-literal derived state.
 * @param target Rewrite target (only `className`-kind gets derived attrs).
 * @param rewriteCtx Rewrite-wide state.
 */
function applyDerivedJsxAttributes(
  attributePath: NodePath<t.JSXAttribute>,
  parent: t.JSXOpeningElement,
  result: FirstArgumentResult,
  target: RewriteTarget,
  rewriteCtx: RewriteContext,
): void {
  if (target.kind !== 'className') return
  if (result.gradientAttrs) appendGradientAttributes(parent, result.gradientAttrs)
  if (result.truncateAttrs) appendGradientAttributes(parent, result.truncateAttrs)
  if (result.mountHaptics) recordMountHaptics(attributePath, result.mountHaptics, rewriteCtx)
  if (result.eventHaptics) injectEventHapticHandlers(attributePath, parent, result.eventHaptics, rewriteCtx)
}

/**
 * Splice gradient JSX attributes (`colors={…}` / `start={…}` /
 * `end={…}`) into a JSXOpeningElement's attribute list, replacing
 * any already-present attribute with the same name. Users who manually
 * set `colors=` on the same element lose; rnwind's class-derived
 * values win — matching how `className`-resolved styles override
 * inline `style={…}`.
 * @param opening JSXOpeningElement to mutate.
 * @param gradientAttrs Freshly built JSX attributes.
 * @param gradientAttributes
 */
function appendGradientAttributes(opening: t.JSXOpeningElement, gradientAttributes: readonly t.JSXAttribute[]): void {
  const names = new Set<string>()
  for (const attribute of gradientAttributes) if (t.isJSXIdentifier(attribute.name)) names.add(attribute.name.name)
  opening.attributes = opening.attributes.filter((attribute) => {
    if (!t.isJSXAttribute(attribute)) return true
    if (!t.isJSXIdentifier(attribute.name)) return true
    return !names.has(attribute.name.name)
  })
  opening.attributes.push(...gradientAttributes)
}

/**
 * Whether a JSX tag can fire press / focus events. Pure host-tag check
 * against {@link NON_INTERACTIVE_HOST_TAGS}: anything in the set is
 * definitely non-interactive; anything else (custom component,
 * `Animated.View`, etc.) is treated as potentially interactive so the
 * InteractiveBox wrapper is still applied.
 * @param name JSXOpeningElement name node.
 * @returns `true` when the tag might emit press / focus events.
 */
function isTagInteractive(name: t.JSXOpeningElement['name']): boolean {
  if (t.isJSXIdentifier(name)) return !NON_INTERACTIVE_HOST_TAGS.has(name.name)
  // Member expressions (`Animated.View`, `Foo.Bar`): conservatively
  // treat as interactive since the outer object's semantics are opaque.
  return true
}

/**
 * Replace the JSXElement's tag with `<InteractiveBox>`, packing the
 * original tag, the className ref / expression, the scheme binding, and
 * any user style into a single `_rw` spec prop. All other attributes
 * forward through unchanged.
 *
 * The replacement keeps the element's children — only the opening /
 * closing tag name changes, plus the className attribute is replaced by
 * `_rw` (and a preceding `style` attribute was already spliced out).
 * @param attributePath JSXAttribute path for the className being rewritten.
 * @param opening JSXOpeningElement the attribute lives on.
 * @param classNameExpr The first-arg expression (hoisted ref or dynamic).
 * @param schemeBinding Name of the `_s = useScheme()` binding.
 * @param ctxBinding
 * @param userStyleExpr Optional user style spliced from a sibling `style={…}`.
 * @param insetsBinding `_i = useInsets()` binding name when the rewrite needs insets, else null.
 * @param fontScaleBinding `_fs = useFontScale()` binding name — always present since every rewrite injects it.
 */
function rewriteAsInteractiveBox(
  attributePath: NodePath<t.JSXAttribute>,
  opening: t.JSXOpeningElement,
  classNameExpr: t.Expression,
  ctxBinding: string,
  userStyleExpr: t.Expression | null,
): void {
  const originalTagExpr = jsxNameToExpression(opening.name)
  const rwProperties: t.ObjectProperty[] = [
    t.objectProperty(t.identifier('as'), originalTagExpr),
    t.objectProperty(t.identifier('cn'), classNameExpr),
    t.objectProperty(t.identifier('t'), t.identifier(ctxBinding)),
  ]
  if (userStyleExpr) rwProperties.push(t.objectProperty(t.identifier('us'), userStyleExpr))
  const rwAttribute = t.jsxAttribute(t.jsxIdentifier('_rw'), t.jsxExpressionContainer(t.objectExpression(rwProperties)))
  // Swap the className attribute out for `_rw`, keeping it at the
  // attribute's original position so any surrounding spread attrs stay
  // honouring the user's intended order.
  attributePath.replaceWith(rwAttribute)
  opening.name = t.jsxIdentifier(INTERACTIVE_BOX)
  const jsxElement = findParentJsxElement(attributePath)
  if (jsxElement?.closingElement) jsxElement.closingElement.name = t.jsxIdentifier(INTERACTIVE_BOX)
}

/**
 * Walk from a JSXAttribute path up to its JSXElement ancestor.
 * @param attributePath JSXAttribute path.
 * @returns The enclosing JSXElement, or `null` when the shape is unexpected.
 */
function findParentJsxElement(attributePath: NodePath<t.JSXAttribute>): t.JSXElement | null {
  const openingPath = attributePath.parentPath
  if (!openingPath) return null
  const elementPath = openingPath.parentPath
  if (!elementPath) return null
  const { node } = elementPath
  return t.isJSXElement(node) ? node : null
}

/**
 * Convert a JSX opening-element name (identifier or member expression)
 * into a regular JS expression we can splice into the `_rw.as` object
 * property. `<Animated.View>` → `Animated.View`, `<Pressable>` →
 * `Pressable`.
 * @param name JSXOpeningElement name node.
 * @returns Equivalent identifier / member-expression node.
 */
function jsxNameToExpression(name: t.JSXOpeningElement['name']): t.Expression {
  if (t.isJSXIdentifier(name)) return t.identifier(name.name)
  if (t.isJSXMemberExpression(name)) {
    return t.memberExpression(jsxNameToExpression(name.object), t.identifier(name.property.name))
  }
  throw new Error(
    `rnwind: unsupported JSX tag shape "${(name as { type?: string }).type ?? 'unknown'}" for interactive className`,
  )
}

/** Result from {@link buildFirstArgument} — the lookupCss first arg + flags. */
interface FirstArgumentResult {
  /** Expression to splice in as `lookupCss`'s first argument. */
  expression: t.Expression
  /**
   * Whether this className might engage active/focus variants at runtime.
   * `true` for every dynamic (non-literal) expression — we can't know
   * the eventual string. For literals, `true` only if any token carries
   * a recognised interactive prefix.
   */
  mayBeInteractive: boolean
  /**
   * Whether this particular rewrite needs the safe-area insets
   * argument passed to `lookupCss`. Set to `true` for dynamic
   * expressions (can't inspect tokens at build time) and for literals
   * that include any `*-safe` utility. When `false` the rewrite emits
   * the compact 2-arg call so the runtime fast path stays engaged.
   */
  needsInsets: boolean
  /**
   * Extra JSX attributes the rewrite should inject alongside the
   * `style={...}` prop. Non-null only when the literal carried gradient
   * atoms: `colors={_g_x}`, `start={_gs_x}`, `end={_ge_x}`, optionally
   * `locations={_gl_x}` — stable consts hoisted at module scope.
   */
  gradientAttrs?: readonly t.JSXAttribute[]
  /**
   * Extra JSX attributes derived from text-truncate atoms (`truncate`,
   * `line-clamp-<N>`, `text-ellipsis`, `text-clip`). Emitted as inline
   * literals — `numberOfLines={N}` and/or `ellipsizeMode="tail"` — so
   * `<Text>` (and any `Text`-prop-shaped component) gets the right
   * native truncation without the user hand-wiring props.
   */
  truncateAttrs?: readonly t.JSXAttribute[]
  /**
   * Mount-haptic requests collected from this literal (bare `haptic-*`
   * atoms, no variant prefix). Aggregated per-component by the caller.
   */
  mountHaptics?: readonly HapticRequest[]
  /**
   * Event-haptic entries (`active:haptic-*` / `focus:haptic-*` /
   * `hover:haptic-*`). Caller splices the chained event handlers onto
   * the opening element.
   */
  eventHaptics?: readonly { readonly request: HapticRequest; readonly trigger: Exclude<HapticTrigger, 'mount'> }[]
}

/**
 * Decide what the first arg of the rewritten `lookupCss(...)` call
 * should be:
 *  - Static string literal (`"…"` or `{"…"}` or static template): tokenize,
 *    push literal text for the ledger, return a hoisted const reference.
 *  - Dynamic expression: forward the expression unchanged; runtime
 *    tokenizes the string result at render time.
 * @param value Attribute's value node (StringLiteral or JSXExpressionContainer).
 * @param hoister Hoist table.
 * @param literals Output array for static literals.
 * @param rewriteCtx
 * @returns The first-arg expression + interact-eligibility flag, or `null`.
 */
function buildFirstArgument(
  value: t.JSXAttribute['value'],
  hoister: Hoister,
  literals: string[],
  rewriteCtx: RewriteContext,
): FirstArgumentResult | null {
  if (t.isStringLiteral(value)) return literalResult(value.value, hoister, literals, rewriteCtx)
  if (!t.isJSXExpressionContainer(value)) return null
  const { expression } = value
  if (t.isJSXEmptyExpression(expression)) return null
  if (t.isStringLiteral(expression)) return literalResult(expression.value, hoister, literals, rewriteCtx)
  if (t.isTemplateLiteral(expression) && expression.expressions.length === 0 && expression.quasis[0]) {
    const text = expression.quasis[0].value.cooked ?? expression.quasis[0].value.raw
    return literalResult(text, hoister, literals, rewriteCtx)
  }
  // Dynamic expression — can't inspect atoms at build time. Assume safe
  // is possible and pull in `_i` so the runtime can resolve any
  // `*-safe` class a consumer composes at runtime. The runtime fast
  // path is still taken when the dynamic string resolves to a plain
  // non-safe atom list (SAFE_ATOMS index check gates the slow path).
  rewriteCtx.needsInsets = true
  return { expression: expression as t.Expression, mayBeInteractive: true, needsInsets: true }
}

/**
 * Package a literal classname into a hoisted atom-array ref and scan it
 * for interactive prefixes (`active:`, `focus:`) + safe-area patterns.
 * Pre-scanned literals without any interactive tokens skip the (small
 * but measurable) cost of injecting a `useInteract()` hook; literals
 * without any `*-safe` token skip the insets arg, keeping the runtime
 * fast path engaged.
 * @param text Raw classname string.
 * @param hoister Hoist table.
 * @param literals Output array for literal-text sink.
 * @param rewriteCtx Rewrite-wide state; updated when any atom needs insets.
 * @returns The expression + per-rewrite flags.
 */
function literalResult(text: string, hoister: Hoister, literals: string[], rewriteCtx: RewriteContext): FirstArgumentResult {
  literals.push(text)
  const atoms = tokenize(text)
  const { gradientAttrs, remaining: afterGradient } = extractGradientSpec(atoms, rewriteCtx)
  const { truncateAttrs, remaining: afterTruncate } = extractTextTruncateSpec(afterGradient)
  const { mountHaptics, eventHaptics, remaining } = extractHapticSpec(afterTruncate, rewriteCtx)
  const mayBeInteractive = remaining.some((atom) => INTERACTIVE_PREFIXES.some((prefix) => atom.startsWith(prefix)))
  const needsInsets = remaining.some((atom) => SAFE_ATOM_PATTERN.test(atom))
  if (needsInsets) rewriteCtx.needsInsets = true
  return {
    expression: hoister.refFor(remaining),
    mayBeInteractive,
    needsInsets,
    gradientAttrs: gradientAttrs.length > 0 ? gradientAttrs : undefined,
    truncateAttrs: truncateAttrs.length > 0 ? truncateAttrs : undefined,
    mountHaptics: mountHaptics.length > 0 ? mountHaptics : undefined,
    eventHaptics: eventHaptics.length > 0 ? eventHaptics : undefined,
  }
}

/**
 * Scan the atom list for gradient roles (direction + from/via/to
 * colours), strip those atoms out, and produce the JSX attributes the
 * rewrite will splice onto the opening element:
 *   colors={_g_<hash>}  start={_gs_<hash>}  end={_ge_<hash>}
 * When the atom list doesn't contain a complete gradient (no direction
 * OR no colour stops), the gradient atoms pass through untouched —
 * they'd resolve to `{}` in the runtime anyway. This keeps the
 * transform conservative.
 * @param atoms Tokenised atom list from the literal.
 * @param rewriteCtx Rewrite-wide state (for the hoister).
 * @returns The gradient JSX attrs (possibly empty) and the non-gradient remainder.
 */
function extractGradientSpec(
  atoms: readonly string[],
  rewriteCtx: RewriteContext,
): { gradientAttrs: readonly t.JSXAttribute[]; remaining: readonly string[] } {
  const {gradientAtoms} = rewriteCtx
  if (gradientAtoms.size === 0) return { gradientAttrs: [], remaining: atoms }

  let direction: GradientDirection | null = null
  let from: string | null = null
  let via: string | null = null
  let to: string | null = null
  const remaining: string[] = []
  for (const atom of atoms) {
    const info = gradientAtoms.get(atom)
    if (!info) {
      remaining.push(atom)
      continue
    }
    switch (info.role) {
    case 'direction': {
    direction = info.dir
    break;
    }
    case 'from': {
    from = info.color
    break;
    }
    case 'via': {
    via = info.color
    break;
    }
    case 'to': { {
    to = info.color
    // No default
    }
    break;
    }
    }
    // Gradient atoms deliberately drop from `remaining` — they're
    // consumed at build time and don't need a runtime style slot.
  }

  if (direction === null || direction === 'unknown' || (from === null && to === null)) {
    // No recognisable gradient — put atoms back so they at least
    // attempt to resolve through lookupCss.
    return { gradientAttrs: [], remaining: atoms }
  }
  const colors = gradientColors(from, via, to)
  const points = directionToPoints(direction)
  const colorsRef = rewriteCtx.gradientHoister.refForColors(colors)
  const startRef = rewriteCtx.gradientHoister.refForPoint(points.start, 'start')
  const endRef = rewriteCtx.gradientHoister.refForPoint(points.end, 'end')
  const attributes: t.JSXAttribute[] = [
    t.jsxAttribute(t.jsxIdentifier('colors'), t.jsxExpressionContainer(colorsRef)),
    t.jsxAttribute(t.jsxIdentifier('start'), t.jsxExpressionContainer(startRef)),
    t.jsxAttribute(t.jsxIdentifier('end'), t.jsxExpressionContainer(endRef)),
  ]
  return { gradientAttrs: attributes, remaining }
}

/**
 * Scan the atom list for text-truncate utilities (`truncate`,
 * `line-clamp-<N>`, `line-clamp-none`, `text-ellipsis`, `text-clip`),
 * strip them out, and produce the JSX attributes the rewrite will
 * splice onto the opening element: `numberOfLines={N}` and/or
 * `ellipsizeMode="tail"|"clip"`.
 *
 * Merge rule mirrors Tailwind's cascade — later atoms override earlier
 * ones. `numberOfLines: 0` (the `line-clamp-none` reset) suppresses
 * emission entirely; a standalone `text-ellipsis` / `text-clip` with no
 * companion line count also emits nothing because `ellipsizeMode`
 * alone has no effect on RN `<Text>`.
 * @param atoms Tokenised atom list.
 * @returns The truncate JSX attrs (possibly empty) and the non-truncate remainder.
 */
function extractTextTruncateSpec(
  atoms: readonly string[],
): { truncateAttrs: readonly t.JSXAttribute[]; remaining: readonly string[] } {
  if (!mayContainTextTruncate(atoms)) return { truncateAttrs: [], remaining: atoms }
  let numberOfLines: number | undefined
  let ellipsizeMode: 'tail' | 'clip' | undefined
  const remaining: string[] = []
  for (const atom of atoms) {
    const info = detectTextTruncate(atom)
    if (!info) {
      remaining.push(atom)
      continue
    }
    const { numberOfLines: infoLines, ellipsizeMode: infoMode } = info
    if (infoLines !== undefined) numberOfLines = infoLines
    if (infoMode !== undefined) ellipsizeMode = infoMode
  }
  const attributes = buildTruncateAttributes(numberOfLines, ellipsizeMode)
  return { truncateAttrs: attributes, remaining }
}

/**
 * Assemble JSXAttribute nodes for the resolved truncate props. Drops
 * `numberOfLines` when zero (reset) and drops `ellipsizeMode` when not
 * paired with a positive line count — matching RN's behaviour where
 * `ellipsizeMode` needs `numberOfLines` to do anything.
 * @param numberOfLines Resolved clamp count, or undefined.
 * @param ellipsizeMode Resolved ellipsize mode, or undefined.
 * @returns Zero, one, or two JSX attributes.
 */
function buildTruncateAttributes(
  numberOfLines: number | undefined,
  ellipsizeMode: 'tail' | 'clip' | undefined,
): readonly t.JSXAttribute[] {
  const attributes: t.JSXAttribute[] = []
  if (numberOfLines !== undefined && numberOfLines > 0) {
    attributes.push(
      t.jsxAttribute(t.jsxIdentifier('numberOfLines'), t.jsxExpressionContainer(t.numericLiteral(numberOfLines))),
    )
    if (ellipsizeMode !== undefined) {
      attributes.push(t.jsxAttribute(t.jsxIdentifier('ellipsizeMode'), t.stringLiteral(ellipsizeMode)))
    }
  }
  return attributes
}

/**
 * Map of variant-prefix → trigger. Bare atoms (no colon) resolve to
 * `'mount'` through {@link extractHapticSpec}; these entries cover the
 * explicit `active:` / `focus:` / `hover:` cases.
 */
const HAPTIC_VARIANT_TRIGGER: Record<string, Exclude<HapticTrigger, 'mount'>> = {
  active: 'pressIn',
  focus: 'focus',
  hover: 'hover',
}

/** Map a non-mount haptic trigger to the JSX event prop it chains onto. */
const HAPTIC_EVENT_PROP: Record<Exclude<HapticTrigger, 'mount'>, string> = {
  pressIn: 'onPressIn',
  pressOut: 'onPressOut',
  focus: 'onFocus',
  hover: 'onMouseEnter',
}

/**
 * Scan atom list for haptic utilities. Bare `haptic-*` → mount trigger;
 * `active:haptic-*` / `focus:haptic-*` / `hover:haptic-*` → the matching
 * event trigger. Matched atoms are stripped from the remainder so the
 * runtime style resolver never tries to look up `--rnwind-haptic`.
 * @param atoms Post-gradient, post-truncate atom list.
 * @param rewriteCtx Rewrite-wide state (for the haptic-atom map).
 * @returns Mount + event haptic entries, plus the non-haptic remainder.
 */
function extractHapticSpec(
  atoms: readonly string[],
  rewriteCtx: RewriteContext,
): {
  mountHaptics: readonly HapticRequest[]
  eventHaptics: readonly { readonly request: HapticRequest; readonly trigger: Exclude<HapticTrigger, 'mount'> }[]
  remaining: readonly string[]
} {
  const { hapticAtoms } = rewriteCtx
  if (hapticAtoms.size === 0) return { mountHaptics: [], eventHaptics: [], remaining: atoms }
  const mountHaptics: HapticRequest[] = []
  const eventHaptics: { request: HapticRequest; trigger: Exclude<HapticTrigger, 'mount'> }[] = []
  const remaining: string[] = []
  for (const atom of atoms) {
    const resolved = resolveHapticAtom(atom, hapticAtoms)
    if (!resolved) {
      remaining.push(atom)
      continue
    }
    if (resolved.trigger === 'mount') mountHaptics.push(resolved.request)
    else eventHaptics.push({ request: resolved.request, trigger: resolved.trigger })
  }
  return { mountHaptics, eventHaptics, remaining }
}

/**
 * Classify one atom against the parser's haptic map. A colon-free atom
 * maps to `'mount'`; `active:` / `focus:` / `hover:` prefixes map to
 * the matching event trigger. Other prefixes return `null` so they
 * fall through to the regular style path.
 * @param atom Atom name, possibly variant-prefixed.
 * @param hapticAtoms Parser-surfaced haptic metadata.
 * @returns `{request, trigger}` on match, null otherwise.
 */
function resolveHapticAtom(
  atom: string,
  hapticAtoms: ReadonlyMap<string, HapticRequest>,
): { readonly request: HapticRequest; readonly trigger: HapticTrigger } | null {
  // Direct lookup first — Tailwind v4 registers the variant-prefixed
  // class (e.g. `active:haptic-medium`) as its own rule, and the
  // parser's nested-rule walk surfaces the marker under that key.
  const direct = hapticAtoms.get(atom)
  if (direct) {
    const colon = atom.indexOf(':')
    if (colon === -1) return { request: direct, trigger: 'mount' }
    const trigger = HAPTIC_VARIANT_TRIGGER[atom.slice(0, colon)]
    if (trigger) return { request: direct, trigger }
    return null
  }
  // Fallback — try stripping a known variant prefix and looking up
  // the bare class. Handles cases where the parser only registered
  // the base utility (the variant rule may be missing if only the
  // bare class is otherwise used in the theme).
  const colon = atom.indexOf(':')
  if (colon === -1) return null
  const prefix = atom.slice(0, colon)
  const trigger = HAPTIC_VARIANT_TRIGGER[prefix]
  if (!trigger) return null
  const bare = hapticAtoms.get(atom.slice(colon + 1))
  if (!bare) return null
  return { request: bare, trigger }
}

/**
 * Append mount-haptic requests to the aggregate keyed by the JSX site's
 * enclosing component body. Post-traversal the transformer injects one
 * `useMountHaptic(<hoisted>)` call per component.
 * @param attributePath The JSXAttribute path the haptic came from.
 * @param requests Mount requests gathered from this literal.
 * @param rewriteCtx Rewrite-wide state.
 */
function recordMountHaptics(
  attributePath: NodePath<t.JSXAttribute>,
  requests: readonly HapticRequest[],
  rewriteCtx: RewriteContext,
): void {
  const body = findComponentBody(attributePath)
  if (!body) return
  const bucket = rewriteCtx.mountByComponent.get(body.node)
  if (bucket) {
    bucket.push(...requests)
    return
  }
  rewriteCtx.mountByComponent.set(body.node, [...requests])
}

/**
 * Splice one chained event handler per event-haptic entry onto the
 * JSXOpeningElement. Each handler calls `triggerHaptic(_h, <request>,
 * '<trigger>')` and then forwards to any pre-existing user handler.
 * @param attributePath Path of the className attribute being rewritten.
 * @param opening Opening element to mutate.
 * @param entries Event-haptic entries.
 * @param rewriteCtx Rewrite-wide state (for the hoister).
 */
function injectEventHapticHandlers(
  attributePath: NodePath<t.JSXAttribute>,
  opening: t.JSXOpeningElement,
  entries: readonly { readonly request: HapticRequest; readonly trigger: Exclude<HapticTrigger, 'mount'> }[],
  rewriteCtx: RewriteContext,
): void {
  // Make sure `_t = _r()` is in scope — haptic dispatcher reads `_t.onHaptics`.
  injectContextHook(attributePath)
  rewriteCtx.needsHapticsHook = true
  const byTrigger = new Map<Exclude<HapticTrigger, 'mount'>, HapticRequest[]>()
  for (const { request, trigger } of entries) {
    const list = byTrigger.get(trigger)
    if (list) list.push(request)
    else byTrigger.set(trigger, [request])
  }
  for (const [trigger, requests] of byTrigger) {
    const eventProperty = HAPTIC_EVENT_PROP[trigger]
    const existing = extractAndDropSiblingStyle(opening, eventProperty)
    const handler = buildChainedHapticHandler(rewriteCtx, requests, trigger, existing)
    opening.attributes.push(t.jsxAttribute(t.jsxIdentifier(eventProperty), t.jsxExpressionContainer(handler)))
  }
}

/**
 * Build the inline arrow body for one chained handler — dispatch every
 * request in `requests` via `triggerHaptic`, then forward the event to
 * the user-supplied handler (if any) via `existing?.(event)`.
 * @param rewriteCtx Rewrite-wide state.
 * @param requests Requests that share this trigger.
 * @param trigger Lifecycle trigger this handler fires on.
 * @param existing User-supplied event handler expression, or null.
 * @returns ArrowFunctionExpression ready to splice into a JSXAttribute.
 */
function buildChainedHapticHandler(
  rewriteCtx: RewriteContext,
  requests: readonly HapticRequest[],
  trigger: Exclude<HapticTrigger, 'mount'>,
  existing: t.Expression | null,
): t.ArrowFunctionExpression {
  const eventId = t.identifier('_e')
  const body: t.Statement[] = []
  for (const request of requests) {
    const ref = rewriteCtx.hapticHoister.refForRequest(request)
    body.push(
      t.expressionStatement(
        t.callExpression(t.identifier(TRIGGER_HAPTIC), [
          t.memberExpression(t.identifier(CONTEXT_BINDING), t.identifier('onHaptics')),
          ref,
          t.stringLiteral(trigger),
        ]),
      ),
    )
  }
  if (existing) {
    body.push(
      t.expressionStatement(
        t.optionalCallExpression(existing, [eventId], true),
      ),
    )
  }
  return t.arrowFunctionExpression([eventId], t.blockStatement(body))
}

/**
 * Walk the aggregated `mountByComponent` map and inject a single
 * `useMountHaptic(<hoisted requests>)` call per component body.
 * The hoist yields a stable `const _hm_<hash>` referencing a frozen
 * array of request objects.
 * @param rewriteCtx Rewrite-wide state.
 */
function injectMountHapticCalls(rewriteCtx: RewriteContext): void {
  for (const [body, requests] of rewriteCtx.mountByComponent) {
    const ref = rewriteCtx.hapticHoister.refForRequestList(requests)
    const declaration = t.expressionStatement(
      t.callExpression(t.identifier(USE_MOUNT_HAPTIC), [ref]),
    )
    body.body.unshift(declaration)
  }
}

/** One hoisted haptic entry — either a single request or a frozen list. */
type HapticEntry =
  | { readonly kind: 'request'; readonly request: HapticRequest }
  | { readonly kind: 'list'; readonly requests: readonly HapticRequest[] }

/** Hoister for haptic request objects + mount-request arrays. */
interface HapticHoister {
  /** Hoist (or fetch) a single request const (`_hr_<hash>`). */
  refForRequest: (request: HapticRequest) => t.Identifier
  /** Hoist (or fetch) a frozen array of requests (`_hm_<hash>`). */
  refForRequestList: (requests: readonly HapticRequest[]) => t.Identifier
  /** All hoisted entries in insertion order. */
  entries: ReadonlyMap<string, HapticEntry>
}

/**
 * Derive a stable cache key for one {@link HapticRequest}. Keys are
 * used both for hoister interning and mount-list digesting.
 * @param request Haptic request.
 * @returns Canonical key text.
 */
function keyForHapticRequest(request: HapticRequest): string {
  if (request.kind === 'impact') return `impact:${request.style}`
  if (request.kind === 'notification') return `notification:${request.type}`
  return 'selection'
}

/**
 * Build the haptic hoist table. Single requests and mount-request
 * lists each get their own module-scope frozen const so component
 * bodies only reference stable identifiers — no per-render allocation.
 * @returns HapticHoister API.
 */
function createHapticHoister(): HapticHoister {
  const pool = createInternPool<HapticEntry>()
  const refForRequest = (request: HapticRequest): t.Identifier =>
    pool.intern('_hr', `req:${keyForHapticRequest(request)}`, { kind: 'request', request })
  const refForRequestList = (requests: readonly HapticRequest[]): t.Identifier =>
    pool.intern('_hm', `list:${requests.map((request) => keyForHapticRequest(request)).join('|')}`, {
      kind: 'list',
      requests,
    })
  return { refForRequest, refForRequestList, entries: pool.entries }
}

/**
 * Generic intern-pool: one shared cache for module-scope consts keyed
 * by an arbitrary string. Returns a stable `t.Identifier` per key and
 * records `{name → entry}` for the emitter pass.
 * @returns Intern API.
 */
function createInternPool<Entry>(): {
  intern: (prefix: string, key: string, entry: Entry) => t.Identifier
  entries: ReadonlyMap<string, Entry>
} {
  const byKey = new Map<string, t.Identifier>()
  const entries = new Map<string, Entry>()
  const intern = (prefix: string, key: string, entry: Entry): t.Identifier => {
    const existing = byKey.get(key)
    if (existing) return existing
    const hash = createHash('sha256').update(key).digest('hex').slice(0, 12)
    const name = `${prefix}_${hash}`
    const ident = t.identifier(name)
    byKey.set(key, ident)
    entries.set(name, entry)
    return ident
  }
  return { intern, entries }
}

/**
 * Emit `const _hr_<hash> = Object.freeze({...})` and `const _hm_<hash>
 * = Object.freeze([{...}, ...])` statements at module scope — one per
 * hoister entry.
 * @param ast Babel File AST.
 * @param entries Hoister entries.
 */
function injectHapticConsts(ast: File, entries: ReadonlyMap<string, HapticEntry>): void {
  const declarations: t.Statement[] = []
  for (const [name, entry] of entries) {
    if (entry.kind === 'request') {
      declarations.push(
        t.variableDeclaration('const', [
          t.variableDeclarator(t.identifier(name), freezeExpression(requestLiteral(entry.request))),
        ]),
      )
    } else {
      declarations.push(
        t.variableDeclaration('const', [
          t.variableDeclarator(
            t.identifier(name),
            freezeExpression(t.arrayExpression(entry.requests.map((request) => freezeExpression(requestLiteral(request))))),
          ),
        ]),
      )
    }
  }
  ast.program.body.unshift(...declarations)
}

/**
 * Build an `Object.freeze(...)` call around the given expression.
 * @param value Expression to freeze.
 * @returns CallExpression node.
 */
function freezeExpression(value: t.Expression): t.CallExpression {
  return t.callExpression(t.memberExpression(t.identifier('Object'), t.identifier('freeze')), [value])
}

/**
 * Build an object-literal representation of a {@link HapticRequest} —
 * `{kind: 'impact', style: 'Light'}` etc.
 * @param request Haptic request.
 * @returns ObjectExpression node.
 */
function requestLiteral(request: HapticRequest): t.ObjectExpression {
  const properties: t.ObjectProperty[] = [
    t.objectProperty(t.identifier('kind'), t.stringLiteral(request.kind)),
  ]
  if (request.kind === 'impact') properties.push(t.objectProperty(t.identifier('style'), t.stringLiteral(request.style)))
  else if (request.kind === 'notification') properties.push(t.objectProperty(t.identifier('type'), t.stringLiteral(request.type)))
  return t.objectExpression(properties)
}

/**
 * Normalise the `from/via/to` triple into the array
 * `<LinearGradient colors={…}>` expects: drop `null` entries while
 * keeping the source order.
 * @param from Hex colour for `from-*`, or null.
 * @param via Hex colour for `via-*`, or null.
 * @param to Hex colour for `to-*`, or null.
 * @returns Colour array (at least one entry guaranteed by the caller).
 */
function gradientColors(from: string | null, via: string | null, to: string | null): readonly string[] {
  const out: string[] = []
  if (from !== null) out.push(from)
  if (via !== null) out.push(via)
  if (to !== null) out.push(to)
  return out
}

/**
 * Map Tailwind's stock direction tag to the `(start, end)` pair of
 * unit-square points expo-linear-gradient expects. Pure constants —
 * the same as NativeWind and the wider RN-gradient community.
 * @param dir Compact direction tag from the parser.
 * @returns Start + end point records.
 */
function directionToPoints(dir: GradientDirection): {
  start: { x: number; y: number }
  end: { x: number; y: number }
} {
  switch (dir) {
    case 'to-r': {
      return { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } }
    }
    case 'to-l': {
      return { start: { x: 1, y: 0.5 }, end: { x: 0, y: 0.5 } }
    }
    case 'to-t': {
      return { start: { x: 0.5, y: 1 }, end: { x: 0.5, y: 0 } }
    }
    case 'to-b': {
      return { start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 } }
    }
    case 'to-tr': {
      return { start: { x: 0, y: 1 }, end: { x: 1, y: 0 } }
    }
    case 'to-tl': {
      return { start: { x: 1, y: 1 }, end: { x: 0, y: 0 } }
    }
    case 'to-br': {
      return { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } }
    }
    case 'to-bl': {
      return { start: { x: 1, y: 0 }, end: { x: 0, y: 1 } }
    }
    default: {
      return { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } }
    }
  }
}

/**
 * Look for a sibling style attribute on the same JSXOpeningElement, drop
 * it, and return its expression for the caller to pass as the `lookupCss`
 * third arg. The attribute name is parameterised so the prefix path can
 * pull `contentContainerStyle` (et al.) instead of plain `style`.
 * @param parent JSXOpeningElement containing the className we're rewriting.
 * @param styleProp The exact sibling attribute name to look for.
 * @param styleProperty
 * @returns Expression from the dropped attribute, or `null`.
 */
function extractAndDropSiblingStyle(parent: t.JSXOpeningElement, styleProperty: string): t.Expression | null {
  const { attributes } = parent
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]
    if (!t.isJSXAttribute(attribute)) continue
    if (!t.isJSXIdentifier(attribute.name) || attribute.name.name !== styleProperty) continue
    const { value } = attribute
    if (!value || !t.isJSXExpressionContainer(value)) return null
    const { expression } = value
    if (t.isJSXEmptyExpression(expression)) return null
    attributes.splice(index, 1)
    return expression as t.Expression
  }
  return null
}

const INJECTED = new WeakSet<t.BlockStatement>()
/**
 * Walk up from the rewrite site to the nearest enclosing function
 * component and inject `const _t = _r()` at the top of its body. This
 * is the SINGLE rnwind context binding — `_t` carries scheme,
 * fontScale, insets, etc. Idempotent per component.
 * @param path Path of any node inside the component's JSX.
 * @returns The binding name (`_t`).
 */
function injectContextHook(path: NodePath): string {
  const componentBody = findComponentBody(path)
  if (!componentBody) return CONTEXT_BINDING
  if (INJECTED.has(componentBody.node)) return CONTEXT_BINDING
  INJECTED.add(componentBody.node)
  const declaration = t.variableDeclaration('const', [
    t.variableDeclarator(t.identifier(CONTEXT_BINDING), t.callExpression(t.identifier(USE_RNWIND_INTERNAL), [])),
  ])
  componentBody.unshiftContainer('body', declaration)
  return CONTEXT_BINDING
}

/**
 * Walk up from `path` to the nearest recognised function component.
 * Accepts:
 *  - `function Capital() {}` declarations.
 *  - `const Capital = () => …` / `const Capital = function () {}` bindings.
 *  - `forwardRef(…)` / `memo(…)` argument callbacks.
 *  - `export default function () {}`.
 *
 * Arrow components with expression bodies get promoted to block bodies
 * so the hook can be `unshift`ed.
 * @param path Starting path.
 * @returns BlockStatement path of the component's body, or `null`.
 */
function findComponentBody(path: NodePath): NodePath<t.BlockStatement> | null {
  let current: NodePath | null = path
  while (current) {
    const fn = current.findParent((parent) => parent.isFunction())
    if (!fn) return null
    if (isComponentFunction(fn))
      return ensureBlockBody(fn as NodePath<t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression>)
    current = fn
  }
  return null
}

/**
 * Classify a function path as a React component per the three accepted
 * shapes (PascalCase decl, PascalCase var assignment, forwardRef/memo
 * argument, default export).
 * @param fn Function-like path.
 * @returns Whether the path is a React function component.
 */
function isComponentFunction(fn: NodePath): boolean {
  if (fn.isFunctionDeclaration()) {
    const { id } = fn.node
    if (!id) return isExportDefaultValue(fn)
    return isPascalCase(id.name)
  }
  if (fn.isArrowFunctionExpression() || fn.isFunctionExpression()) {
    return isAssignedToPascalCase(fn) || isHocArgument(fn) || isExportDefaultValue(fn)
  }
  return false
}

/**
 * Whether this function is the value of an `export default`.
 * @param fn Babel path pointing at the function node.
 * @returns True when the node is directly the default export value.
 */
function isExportDefaultValue(fn: NodePath): boolean {
  const { parent } = fn
  if (t.isExportDefaultDeclaration(parent)) return parent.declaration === fn.node
  return false
}

/**
 * Whether this arrow/function-expression is the init of `const Capital = …`.
 * @param fn Babel path pointing at the function node.
 * @returns True when the enclosing declarator's id starts with an uppercase letter.
 */
function isAssignedToPascalCase(fn: NodePath): boolean {
  const { parent } = fn
  if (!t.isVariableDeclarator(parent)) return false
  if (!t.isIdentifier(parent.id)) return false
  return isPascalCase(parent.id.name)
}

/**
 * Whether this fn is the first argument to `forwardRef(...)` / `memo(...)`.
 * @param fn Babel path pointing at the function node.
 * @returns True when wrapped by a recognized React HOC call.
 */
function isHocArgument(fn: NodePath): boolean {
  const { parent } = fn
  if (!t.isCallExpression(parent)) return false
  if (parent.arguments[0] !== fn.node) return false
  const { callee } = parent
  if (!t.isIdentifier(callee)) return false
  return callee.name === 'forwardRef' || callee.name === 'memo'
}

/**
 * Identifier-starts-with-uppercase — Conventional React component marker.
 * @param name Identifier text.
 * @returns True when the first character is `A`–`Z`.
 */
function isPascalCase(name: string): boolean {
  const first = name.charAt(0)
  return first >= 'A' && first <= 'Z'
}

/**
 * Promote an expression-bodied arrow to a block so we can unshift statements in.
 * @param fn Babel path at the function / arrow whose body should be a block.
 * @returns The path, mutated in place when the body was an expression.
 */
function ensureBlockBody(
  fn: NodePath<t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression>,
): NodePath<t.BlockStatement> {
  const bodyPath = fn.get('body')
  if (Array.isArray(bodyPath)) throw new Error('rnwind: unexpected multi-body function node')
  if (bodyPath.isBlockStatement()) return bodyPath as NodePath<t.BlockStatement>
  const node = bodyPath.node as t.Expression
  bodyPath.replaceWith(t.blockStatement([t.returnStatement(node)]))
  return bodyPath as NodePath<t.BlockStatement>
}

type Hoister = {
  /** Return an identifier referencing the hoisted const for this atom list. */
  refFor: (atoms: readonly string[]) => t.Identifier
  /** Read-only view of every (const name → atoms) pair the hoister built. */
  entries: ReadonlyMap<string, readonly string[]>
}

/**
 * Build a per-file hoist table. Every unique source-order atom list gets
 * one module-scope `const _c_<hash> = Object.freeze(['a', 'b'])`. Order
 * is part of the hash key — `className="a b"` and `className="b a"`
 * intentionally produce different hoisted consts because RN's style
 * flatten is order-dependent (later atoms override earlier ones for
 * conflicting props). Canonicalizing by sort would collapse
 * `opacity-100 opacity-0` and `opacity-0 opacity-100` to the same atom
 * list and silently break the user's intended last-wins override.
 * @returns Hoister API.
 */
function createHoister(): Hoister {
  const byKey = new Map<string, { name: string; atoms: readonly string[] }>()
  const entries = new Map<string, readonly string[]>()

  const refFor = (atoms: readonly string[]): t.Identifier => {
    const ordered = [...atoms]
    const canonical = ordered.join('\0')
    const hit = byKey.get(canonical)
    if (hit) return t.identifier(hit.name)
    const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 12)
    const name = `_c_${hash}`
    byKey.set(canonical, { name, atoms: ordered })
    entries.set(name, ordered)
    return t.identifier(name)
  }

  return { refFor, entries }
}

/** One gradient-hoist entry — either a colour array or a single {x,y} point. */
type GradientEntry = { readonly kind: 'colors'; readonly colors: readonly string[] } | { readonly kind: 'point'; readonly point: { x: number; y: number } }

type GradientHoister = {
  /** Hoist (or fetch) the colour-array const for a gradient. */
  refForColors: (colors: readonly string[]) => t.Identifier
  /** Hoist (or fetch) a start/end point const — role only affects prefix. */
  refForPoint: (point: { x: number; y: number }, role: 'start' | 'end') => t.Identifier
  /** All hoisted entries in insertion order. */
  entries: ReadonlyMap<string, GradientEntry>
}

/**
 * Build the gradient hoist table. Colour arrays and `(x,y)` point
 * records each get their own module-scope `const _g_<hash>` so the
 * JSX site references a stable identity — `<LinearGradient
 * colors={_g_hash}>`'s prop never changes across renders, which lets
 * React's prop-diff short-circuit and keeps native-side gradient
 * rebuilds off the hot path.
 * @returns GradientHoister API.
 */
function createGradientHoister(): GradientHoister {
  const pool = createInternPool<GradientEntry>()
  const refForColors = (colors: readonly string[]): t.Identifier =>
    pool.intern('_g', `colors:${colors.join('|')}`, { kind: 'colors', colors })
  const refForPoint = (point: { x: number; y: number }, role: 'start' | 'end'): t.Identifier => {
    const prefix = role === 'start' ? '_gs' : '_ge'
    return pool.intern(prefix, `point:${point.x},${point.y}`, { kind: 'point', point })
  }
  return { refForColors, refForPoint, entries: pool.entries }
}

/**
 * Prepend the runtime + style imports to the file's program body.
 * Runtime primitives `{lookupCss, useScheme}` are
 * only added when the rewritten code references them. Side-effect
 * imports go first so the atom registry is populated before any
 * module-init hoist runs.
/** Per-file flags telling the import builder what runtime symbols are in use.
 */
interface RuntimeImportFlags {
  /** Any className rewrite ran — always pulls in `_r` (rnwind context hook). */
  touched: boolean
  /** At least one rewrite emitted an inline `lookupCss(...)` call. */
  usedLookupCss: boolean
  /** At least one rewrite swapped the tag for `<InteractiveBox>`. */
  usedInteractiveBox: boolean
  /** At least one component accumulated bare `haptic-*` mount requests. */
  usedMountHaptic: boolean
  /** At least one event-haptic chain emitted a `triggerHaptic(...)` call. */
  usedTriggerHaptic: boolean
}

/**
 * Prepend the runtime + style imports to the file's program body.
 * Only the specifiers actually used by the rewritten code are added
 * — a file with only interactive rewrites skips `lookupCss` entirely
 * (it lives inside InteractiveBox) and vice versa.
 * @param ast File AST.
 * @param flags Which runtime symbols the rewritten code references.
 * @param styleSpecifiers Side-effect import specifiers (style.js + keyframes.js).
 */
function prependRuntimeImports(ast: File, flags: RuntimeImportFlags, styleSpecifiers: readonly string[]): void {
  const heads: t.Statement[] = []
  for (const specifier of styleSpecifiers) {
    heads.push(t.importDeclaration([], t.stringLiteral(specifier)))
  }
  if (flags.touched) {
    heads.push(t.importDeclaration(buildRuntimeSpecifiers(flags), t.stringLiteral(RUNTIME_MODULE)))
  }
  if (heads.length > 0) ast.program.body.unshift(...heads)
}

/**
 * Build the import specifiers for the `rnwind` runtime module — only
 * symbols the rewritten code actually references. Extracted from
 * {@link prependRuntimeImports} to keep cognitive complexity low.
 * @param flags Per-file usage flags.
 * @returns The import specifiers to splice into the runtime import.
 */
function buildRuntimeSpecifiers(flags: RuntimeImportFlags): t.ImportSpecifier[] {
  const specifiers: t.ImportSpecifier[] = []
  const named = (name: string): void => {
    specifiers.push(t.importSpecifier(t.identifier(name), t.identifier(name)))
  }
  if (flags.usedLookupCss) named(LOOKUP_CSS)
  named(USE_RNWIND_INTERNAL)
  if (flags.usedMountHaptic) named(USE_MOUNT_HAPTIC)
  if (flags.usedTriggerHaptic) named(TRIGGER_HAPTIC)
  if (flags.usedInteractiveBox) named(INTERACTIVE_BOX)
  return specifiers
}

/**
 * Splice hoisted `const _c_<hash> = ['flex-1', 'bg-primary', ...]`
 * atom-list declarations into the file right after the imports so
 * every JSX rewrite site sees them in scope.
 *
 * The JSX site references the const as `lookupCss(_c0, _s, userStyle,
 * …)`. The runtime caches its resolved style array per
 * (hoist, scheme, stateIndex) against a global version counter, so
 * subsequent renders return the SAME array reference — zero
 * allocation on the hot path.
 * @param ast File AST.
 * @param entries Hoist table (const name → atom names).
 */
function injectHoistedConsts(ast: File, entries: ReadonlyMap<string, readonly string[]>): void {
  const decls: t.Statement[] = []
  for (const [name, atoms] of entries) {
    const array = t.arrayExpression(atoms.map((atom) => t.stringLiteral(atom)))
    decls.push(t.variableDeclaration('const', [t.variableDeclarator(t.identifier(name), array)]))
  }
  spliceAfterImports(ast, decls)
}

/**
 * Splice gradient const declarations after the imports. Each entry is
 * either `colors` (frozen string array) or a `point` ({x, y} object
 * literal) so `<LinearGradient>` gets a stable ref for every gradient
 * shape.
 * @param ast File AST to mutate.
 * @param entries Gradient-hoister entries.
 */
function injectGradientConsts(ast: File, entries: ReadonlyMap<string, GradientEntry>): void {
  const decls: t.Statement[] = []
  for (const [name, entry] of entries) {
    const init =
      entry.kind === 'colors'
        ? t.callExpression(t.memberExpression(t.identifier('Object'), t.identifier('freeze')), [
            t.arrayExpression(entry.colors.map((c) => t.stringLiteral(c))),
          ])
        : t.callExpression(t.memberExpression(t.identifier('Object'), t.identifier('freeze')), [
            t.objectExpression([
              t.objectProperty(t.identifier('x'), t.numericLiteral(entry.point.x)),
              t.objectProperty(t.identifier('y'), t.numericLiteral(entry.point.y)),
            ]),
          ])
    decls.push(t.variableDeclaration('const', [t.variableDeclarator(t.identifier(name), init)]))
  }
  spliceAfterImports(ast, decls)
}

/**
 * Insert a block of declarations right after the last import in the
 * program body. Shared helper for atom-hoist and gradient-hoist.
 * @param ast File AST.
 * @param decls Declarations to splice in (already-built statements).
 */
function spliceAfterImports(ast: File, decls: readonly t.Statement[]): void {
  if (decls.length === 0) return
  const { body } = ast.program
  let index = 0
  while (index < body.length && t.isImportDeclaration(body[index])) index += 1
  body.splice(index, 0, ...decls)
}

/**
 * Tokenize a classname literal — split on whitespace, drop empties.
 * Mirrors what Tailwind + the runtime tokenizer expect.
 * @param literal Raw classname text.
 * @returns Atom names in document order.
 */
function tokenize(literal: string): string[] {
  const out: string[] = []
  for (const piece of literal.split(/\s+/)) {
    if (piece.length > 0) out.push(piece)
  }
  return out
}
