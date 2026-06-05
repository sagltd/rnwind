import { breakpointTier, getStyleVersion, lookupCss, type InteractState } from './lookup-css'
import type { RnwindState } from './components/rnwind-provider'
import { normalizeClassName } from '../core/normalize-classname'
import type { GradientAtomInfo, GradientDirection } from '../core/parser/gradient'
import type { HapticRequest, HapticTrigger } from '../core/parser/haptics'

/**
 * Rich className resolver — the runtime heart of the wrap / `useCss`.
 *
 * Resolution order, per className string:
 *  1. **Molecule** — a build-time PRE-MERGED single style object for the
 *     whole literal className (per scheme). One map lookup returns it by
 *     reference: no array, no merge, no per-atom loop. The common case.
 *  2. **Atom fallback** — for a className the scanner never saw (a
 *     runtime-built string like `` `${className} px-2` ``) OR one that
 *     carries context-dependent atoms (`pt-safe`, `text-base`, `md:*`),
 *     fall back to per-atom resolution via `lookupCss`, which folds in
 *     insets / fontScale / breakpoint / scheme.
 *
 * Results are cached by `(normalized className, scheme, insets, fontScale,
 * breakpoint)` so repeated renders return the SAME reference until the
 * reactive context changes. Atoms / molecules / features all live in
 * build-time registries the generated `.rnwind/*.js` modules populate.
 */

/** Always-loaded fallback scheme key. */
const COMMON_SCHEME = 'common'

/** Empty style sentinel. */
const EMPTY: readonly unknown[] = []

/** scheme → normalized className → pre-merged style object. */
let molecules: Record<string, Record<string, unknown>> = Object.create(null)
/** atom name → gradient role + resolved colour. */
let gradients: Record<string, GradientAtomInfo> = Object.create(null)
/** atom name (incl. `active:`/`focus:` prefix) → haptic request. */
let haptics: Record<string, HapticRequest> = Object.create(null)
/** Bumps on any molecule/gradient/haptic registration. */
let registryVersion = 0

/** Per-(className·state) resolved cache — strong references between context changes. */
const resolvedCache = new Map<string, ResolvedCss>()
/** Version the cache was last valid for (`getStyleVersion()` + {@link registryVersion}). */
let cachedFor = -1

/**
 * Hard ceiling on the resolved cache. The cache is pure memoisation, so
 * eviction only costs a re-resolve (sub-µs) — never correctness. Build
 * molecules are NOT in here; they live permanently in `molecules`.
 */
const MAX_RESOLVED_CACHE = 2048

/**
 * Store a resolved result, bulk-evicting the OLDEST half when the cache
 * hits {@link MAX_RESOLVED_CACHE}. `Map` preserves insertion order, so the
 * first keys are the oldest. Bulk eviction keeps the hot (cache-hit) path
 * free of per-access LRU bookkeeping at the cost of an occasional small
 * recompute burst under sustained pressure (web / long sessions).
 * @param key Cache key.
 * @param value Resolved result to store.
 */
function cacheResolved(key: string, value: ResolvedCss): void {
  if (resolvedCache.size >= MAX_RESOLVED_CACHE) {
    let drop = resolvedCache.size >> 1
    for (const oldKey of resolvedCache.keys()) {
      resolvedCache.delete(oldKey)
      if (--drop <= 0) break
    }
  }
  resolvedCache.set(key, value)
}

/** A unit-square gradient endpoint. */
interface GradientPoint {
  readonly x: number
  readonly y: number
}

/** Rich resolution: the RN `style` plus any className-derived props. */
export interface ResolvedCss {
  /** RN `style` value — a single molecule object (by ref) or an atom array. */
  readonly style: unknown
  /** Gradient stop colours (when the className is a complete gradient). */
  readonly colors?: readonly string[]
  /** Gradient start point. */
  readonly start?: GradientPoint
  /** Gradient end point. */
  readonly end?: GradientPoint
  /** Text truncation line count. */
  readonly numberOfLines?: number
  /** Text ellipsize mode. */
  readonly ellipsizeMode?: 'tail' | 'clip'
  /** Haptic requests present on the className, for the wrap to dispatch. */
  readonly haptics?: readonly { readonly request: HapticRequest; readonly trigger: HapticTrigger }[]
}

/** `GradientDirection` → expo-linear-gradient start/end points. */
const DIRECTION_POINTS: Record<GradientDirection, { start: GradientPoint; end: GradientPoint }> = {
  'to-t': { start: { x: 0.5, y: 1 }, end: { x: 0.5, y: 0 } },
  'to-b': { start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 } },
  'to-l': { start: { x: 1, y: 0.5 }, end: { x: 0, y: 0.5 } },
  'to-r': { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } },
  'to-tl': { start: { x: 1, y: 1 }, end: { x: 0, y: 0 } },
  'to-tr': { start: { x: 0, y: 1 }, end: { x: 1, y: 0 } },
  'to-bl': { start: { x: 1, y: 0 }, end: { x: 0, y: 1 } },
  'to-br': { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
  unknown: { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } },
}

/**
 * Register one scheme's pre-merged molecules (atom-merged literal
 * classNames). Merges onto any existing entries for the scheme.
 * @param scheme Scheme name (or `'common'`).
 * @param entries Normalized className → merged style object.
 */
export function registerMolecules(scheme: string, entries: Record<string, unknown>): void {
  molecules[scheme] = { ...molecules[scheme], ...entries }
  registryVersion += 1
}

/**
 * Register the gradient atom map (atom name → role + resolved colour).
 * @param map Atom name → gradient info.
 */
export function registerGradients(map: Record<string, GradientAtomInfo>): void {
  gradients = map
  registryVersion += 1
}

/**
 * Register the haptic atom map (atom name → request).
 * @param map Atom name → haptic request.
 */
export function registerHaptics(map: Record<string, HapticRequest>): void {
  haptics = map
  registryVersion += 1
}



/**
 * Per-state-object signature memo. `RnwindState` is created fresh (via the
 * provider's `useMemo`) whenever any field changes, so its identity is a
 * sound key — a new object means a new signature. Keyed weakly so states
 * GC with their provider.
 */
const stateSignatureCache = new WeakMap<RnwindState, string>()

/**
 * Cache key dimension for the reactive context — everything that can
 * change a resolved style. Uses the numeric breakpoint TIER (count of
 * thresholds reached) from `breakpointTier(windowWidth)`, NOT the
 * `activeBreakpoint` NAME: the name clamps tier-0 into the smallest
 * breakpoint, so widths straddling that threshold (e.g. 320 vs 700 with
 * `sm=640`) would collide on one cache key and serve a stale style. The
 * tier is exact AND bounded — two widths in the same tier gate every
 * `sm:`/`md:`/… atom identically, so they resolve the same.
 * @param state Rnwind context.
 * @returns Compact signature string.
 */
function stateSignature(state: RnwindState): string {
  const { insets } = state
  return `${state.scheme}|${insets.top},${insets.right},${insets.bottom},${insets.left}|${state.fontScale}|${breakpointTier(state.windowWidth)}`
}

/**
 * Memoised {@link stateSignature} — one `WeakMap.get` on the hot path
 * instead of rebuilding the template string every resolve.
 * @param state Rnwind context.
 * @returns Cached compact signature.
 */
function stateSignatureCached(state: RnwindState): string {
  let signature = stateSignatureCache.get(state)
  if (signature === undefined) {
    signature = stateSignature(state)
    stateSignatureCache.set(state, signature)
  }
  return signature
}

/**
 * Compact signature of the live interactive state for the cache key.
 * @param interactState Active/focus flags, or undefined for the plain path.
 * @returns Two-bit signature (`''` when no interactive state).
 */
function interactSignature(interactState?: InteractState): string {
  if (!interactState) return ''
  const active = interactState.active ? 1 : 0
  const focus = interactState.focus ? 1 : 0
  return `${active}${focus}`
}

/**
 * Whether a token is a feature-ONLY utility (gradient stop/direction,
 * haptic request, or text-truncate) that contributes NO RN `style`. These
 * are folded in via {@link attachFeatures}, so they must be kept OUT of
 * the `lookupCss` input — otherwise the atom resolver treats them as
 * unknown style atoms and emits a spurious "unknown class" dev warning
 * (e.g. for `active:haptic-rigid`).
 * @param token Atom name.
 * @returns True when the token carries no style.
 */
function isFeatureOnlyToken(token: string): boolean {
  return Boolean(gradients[token]) || Boolean(haptics[token]) || truncateForToken(token) !== null
}

/**
 * Lifecycle trigger for a haptic atom from its variant prefix.
 * @param token Atom name (maybe `active:`/`focus:`/`hover:` prefixed).
 * @returns The trigger.
 */
function hapticTriggerForToken(token: string): HapticTrigger {
  const colon = token.indexOf(':')
  if (colon === -1) return 'mount'
  const prefix = token.slice(0, colon)
  if (prefix === 'active') return 'pressIn'
  if (prefix === 'focus') return 'focus'
  if (prefix === 'hover') return 'hover'
  return 'mount'
}

/**
 * Syntactic text-truncate directive for one atom.
 * @param token Atom name.
 * @returns Partial truncate props, or null.
 */
function truncateForToken(token: string): { numberOfLines?: number; ellipsizeMode?: 'tail' | 'clip' } | null {
  if (token === 'truncate') return { numberOfLines: 1, ellipsizeMode: 'tail' }
  if (token === 'text-ellipsis') return { ellipsizeMode: 'tail' }
  if (token === 'text-clip') return { ellipsizeMode: 'clip' }
  if (token === 'line-clamp-none') return { numberOfLines: 0 }
  if (token.startsWith('line-clamp-')) {
    const count = Number(token.slice('line-clamp-'.length))
    if (Number.isInteger(count) && count >= 0) return { numberOfLines: count }
  }
  return null
}

/**
 * Assemble gradient props from gradient roles present in the atom list.
 * @param tokens Atom names.
 * @returns `{colors, start, end}` or null when not a complete gradient.
 */
function assembleGradient(tokens: readonly string[]): { colors: string[]; start: GradientPoint; end: GradientPoint } | null {
  let from: string | undefined
  let via: string | undefined
  let to: string | undefined
  let dir: GradientDirection | undefined
  for (const token of tokens) {
    const info = gradients[token]
    if (!info) continue
    switch (info.role) {
      case 'from': {
        from = info.color
        break
      }
      case 'via': {
        via = info.color
        break
      }
      case 'to': {
        to = info.color
        break
      }
      default: {
        ;({ dir } = info)
      }
    }
  }
  if (dir === undefined) return null
  const colors = [from, via, to].filter((color): color is string => color !== undefined)
  if (colors.length < 2) return null
  const points = DIRECTION_POINTS[dir]
  return { colors, start: points.start, end: points.end }
}

/**
 * Fold every truncate directive across the atom list into one result —
 * last token wins per prop (matches Tailwind last-wins).
 * @param tokens Atom names.
 * @returns Merged truncate props (empty when none apply).
 */
function collectTruncate(tokens: readonly string[]): { numberOfLines?: number; ellipsizeMode?: 'tail' | 'clip' } {
  const out: { numberOfLines?: number; ellipsizeMode?: 'tail' | 'clip' } = {}
  for (const token of tokens) {
    const truncate = truncateForToken(token)
    if (!truncate) continue
    if (truncate.numberOfLines !== undefined) out.numberOfLines = truncate.numberOfLines
    if (truncate.ellipsizeMode !== undefined) out.ellipsizeMode = truncate.ellipsizeMode
  }
  return out
}

/**
 * Collect every haptic request present in the atom list, tagged with the
 * lifecycle trigger its variant prefix implies.
 * @param tokens Atom names.
 * @returns Haptic request list, or undefined when none apply.
 */
function collectHaptics(tokens: readonly string[]): { request: HapticRequest; trigger: HapticTrigger }[] | undefined {
  let collected: { request: HapticRequest; trigger: HapticTrigger }[] | undefined
  for (const token of tokens) {
    const request = haptics[token]
    if (!request) continue
    collected ??= []
    collected.push({ request, trigger: hapticTriggerForToken(token) })
  }
  return collected
}

/**
 * Scan tokens for the className-derived feature props (gradient,
 * truncate, haptics) and fold them onto the base result.
 * @param base Result carrying the resolved `style`.
 * @param tokens Atom names.
 * @returns The result with any feature props attached.
 */
function attachFeatures(base: ResolvedCss, tokens: readonly string[]): ResolvedCss {
  const { numberOfLines, ellipsizeMode } = collectTruncate(tokens)
  const collected = collectHaptics(tokens)
  const gradient = assembleGradient(tokens)
  const result: Mutable<ResolvedCss> = { style: base.style }
  if (gradient) {
    result.colors = gradient.colors
    result.start = gradient.start
    result.end = gradient.end
  }
  // `numberOfLines: 0` is kept (RN reads it as "unlimited"): `line-clamp-none`
  // must be able to explicitly reset an earlier `line-clamp-N` on the same
  // element — dropping the 0 would silently leave the prior limit in place.
  if (numberOfLines !== undefined) {
    result.numberOfLines = numberOfLines
    if (ellipsizeMode !== undefined) result.ellipsizeMode = ellipsizeMode
  }
  if (collected) result.haptics = collected
  return result
}

/**
 * Flatten the per-atom style array into ONE object — a *runtime molecule*.
 * RN flattens a style array left-to-right (later wins), which is exactly
 * `Object.assign` semantics, so the merged object renders identically
 * while giving dynamic (cva / clsx) classNames the same single-object
 * shape a build-time molecule has. The caller caches the result per
 * `(className · state)`, so the merge runs once per unique context.
 * @param array Per-atom style array from `lookupCss`.
 * @returns Single merged style object.
 */
function mergeStyleArray(array: readonly unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const entry of array) if (entry && typeof entry === 'object') Object.assign(out, entry)
  return out
}

/**
 * Compose a resolved style with a caller-supplied inline style (user wins).
 * @param style
 * @param userStyle
 */
function withUserStyle(style: unknown, userStyle: unknown): unknown {
  return Array.isArray(style) ? [...style, userStyle] : [style, userStyle]
}

/**
 * Resolve a className against the reactive context into a style plus any
 * className-derived props. Molecule-first (one lookup, by reference),
 * atom-fallback for unseen / context-dependent strings, cached per
 * `(className, state)`.
 * @param className Raw className string.
 * @param state Rnwind context from `useRnwind()`.
 * @param userStyle Optional inline style appended last (wins).
 * @param interactState Live active/focus flags (for `active:`/`focus:` atoms).
 * @returns The resolved style + feature props.
 */
export function resolve(
  className: string | null | undefined,
  state: RnwindState,
  userStyle?: unknown,
  interactState?: InteractState,
): ResolvedCss {
  const version = getStyleVersion() + registryVersion
  if (version !== cachedFor) {
    resolvedCache.clear()
    cachedFor = version
  }
  if (className == null) {
    return { style: userStyle === undefined || userStyle === null ? EMPTY : [userStyle] }
  }
  // Key on the RAW className so the hot (cache-hit) path skips normalize
  // entirely — normalization only runs on a miss. The state signature is
  // memoised per state object, so the hit path is one WeakMap.get + one
  // string concat + one Map.get.
  const key = `${className}@${stateSignatureCached(state)}@${interactSignature(interactState)}`
  const cached = resolvedCache.get(key)
  if (cached !== undefined) {
    return userStyle === undefined || userStyle === null ? cached : { ...cached, style: withUserStyle(cached.style, userStyle) }
  }
  const normalized = normalizeClassName(className)
  if (normalized.length === 0) {
    const empty: ResolvedCss = { style: EMPTY }
    cacheResolved(key, empty)
    return userStyle === undefined || userStyle === null ? empty : { style: [userStyle] }
  }
  // Molecules are static pre-merges; anything carrying `active:`/`focus:`
  // is never registered as one, so the atom path handles interactive state.
  const tokens = normalized.split(' ')
  const molecule = interactState ? undefined : molecules[state.scheme]?.[normalized] ?? molecules[COMMON_SCHEME]?.[normalized]
  // Feature-only tokens (gradient / haptic / truncate) carry no style — keep
  // them out of the atom lookup so they don't warn as "unknown class". The
  // atom array is merged into ONE object (a runtime molecule) so dynamic
  // (cva / clsx) classNames get the same single-object shape as a build
  // molecule; the cache below pins the context, so the merge is correct.
  const style =
    molecule === undefined
      ? mergeStyleArray(lookupCss(tokens.filter((token) => !isFeatureOnlyToken(token)).join(' '), state, undefined, interactState))
      : molecule
  const base = attachFeatures({ style }, tokens)
  cacheResolved(key, base)
  return userStyle === undefined || userStyle === null ? base : { ...base, style: withUserStyle(base.style, userStyle) }
}

/** Local mutable view for building the frozen-shaped result. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/** Test-only — clear the molecule / gradient / haptic registries + cache. */
export function __resetResolveState(): void {
  molecules = Object.create(null)
  gradients = Object.create(null)
  haptics = Object.create(null)
  resolvedCache.clear()
  registryVersion += 1
  cachedFor = -1
}

/** Test-only — current resolved-cache entry count + its hard ceiling. */
export function __resolveCacheStats(): { size: number; max: number } {
  return { size: resolvedCache.size, max: MAX_RESOLVED_CACHE }
}

export {normalizeClassName} from '../core/normalize-classname'