/**
 * Runtime resolver for rnwind-transformed files.
 *
 * Hot path is ONE WeakMap.get + cached-array return for stable atoms
 * (no `active:`/`focus:`/`*-safe` variance beyond what the cache key
 * captures). First call per (hoist, scheme, stateIndex) walks the
 * atoms once, looks each up as
 *
 *   `cache.atoms[scheme]?.[atom] ?? cache.atoms.common?.[atom]`
 *
 * and caches the result. `registerAtoms(scheme, record)` bumps a
 * version counter; the next lookup notices the mismatch and rebuilds.
 *
 * Keyframes are inlined directly into atom values via `animationName`
 * at build time — no separate registry.
 */

import type { RnwindState } from './components/rnwind-provider'

/** Empty sentinel returned when the input is null / undefined / empty. */
const EMPTY_STYLES: readonly unknown[] = []

/** Registry key for the always-loaded fallback scheme. */
const COMMON_SCHEME = 'common'

/** Atom name prefix marking a press-state-gated atom. */
const ACTIVE_PREFIX = 'active:'

/** Atom name prefix marking a focus-state-gated atom. */
const FOCUS_PREFIX = 'focus:'

/** Partial record — missing keys resolve to undefined, which the fallback handles. */
type SchemeAtomsRecord = Partial<Record<string, unknown>>

/** 0 = idle, 1 = active, 2 = focus, 3 = both. */
type StateIndex = 0 | 1 | 2 | 3

/**
 * One entry in the sorted-by-threshold breakpoints array. The runtime
 * derives an atom's threshold by matching its `<prefix>:` against
 * `name`; the array form is preferred over a Map so the hot-path
 * `tierFor(width)` walk is a tight numeric loop.
 */
interface BreakpointEntry {
  readonly name: string
  readonly minWidth: number
}

/**
 * Process-global style cache. Replaced key-by-key by {@link registerAtoms}.
 * Plain record-of-records: `scheme → atom → style`. Active scheme
 * lookup is `cache.atoms[scheme]?.[atom]` — two property reads with
 * an `?? cache.atoms.common[atom]` fallback. No loops over the
 * registry, ever.
 *
 * `breakpoints` mirrors the build-time table the manifest module
 * registers via {@link registerBreakpoints} — `name → px-threshold` for
 * fast prefix-based atom filtering plus the sorted-by-threshold list
 * for cheap tier-index computation in `lookupCss`.
 */
const cache = {
  atoms: Object.create(null) as Partial<Record<string, SchemeAtomsRecord>>,
  breakpoints: Object.create(null) as Partial<Record<string, number>>,
  breakpointList: [] as readonly BreakpointEntry[],
}

/**
 * Bumps on every {@link registerAtoms} call. {@link HoistCache} entries
 * stamp themselves with the current version; a mismatch on read
 * triggers a rebuild so HMR-reloaded atoms propagate without manual
 * invalidation.
 */
let atomVersion = 0

/** Optional window-height provider for the `screen-minus-y` marker. */
type WindowHeightProvider = () => number
let windowHeightProvider: WindowHeightProvider | null = null

/**
 * Optional scheme loader. Registered by the generated manifest module
 * (`rnwind/__generated/schemes`) once at import time. SchemeProvider
 * calls it synchronously on every render with the active scheme name;
 * first call per scheme pulls the scheme's style module in via an
 * inline `require()` — subsequent calls are a no-op through Metro's
 * module cache.
 */
type SchemeLoader = (scheme: string) => void
let schemeLoader: SchemeLoader | null = null

/** Module-scope flag so the missing-insets warning fires at most once. */
let WARNED_MISSING_INSETS = false

/** Atoms we've already dev-warned about — keeps the noise to ONE line per typo per session. */
const WARNED_UNKNOWN_ATOMS = new Set<string>()

/**
 * Compute the state-array index from the live interactState. Bit-or
 * encoding: 0 = idle, 1 = active, 2 = focus, 3 = both.
 * @param interactState Snapshot from `useInteract()` (or undefined).
 * @returns 0 / 1 / 2 / 3.
 */
function stateIndexFor(interactState: InteractState | undefined): StateIndex {
  if (!interactState) return 0
  return (((interactState.active ? 1 : 0) | (interactState.focus ? 2 : 0)) as StateIndex)
}

/**
 * Fetch the px inset for one side. Falls back to 0 when insets is undefined.
 * @param side Compact side tag (`t` / `r` / `b` / `l`).
 * @param insets Active insets.
 * @returns Px value for that side.
 */
function insetOf(side: string, insets: LookupInsets | undefined): number {
  if (!insets) return 0
  if (side === 't') return insets.top
  if (side === 'r') return insets.right
  if (side === 'b') return insets.bottom
  if (side === 'l') return insets.left
  return 0
}

/**
 * Collapse one safe-area marker into a concrete px number using the
 * active insets.
 * @param spec Marker spec tuple `[cssKey, sideTag, or, offset]`.
 * @param insets Active insets (or undefined → 0).
 * @returns Resolved px number.
 */
function resolveMarker(spec: SafeMarkerSpec, insets: LookupInsets | undefined): number {
  const [, side, or_, offset] = spec
  if (side === 'screen-minus-y') {
    const h = windowHeightProvider ? windowHeightProvider() : 0
    return Math.max(0, h - insetOf('t', insets) - insetOf('b', insets))
  }
  let base = insetOf(side, insets)
  if (or_ !== undefined) base = Math.max(base, or_)
  if (offset !== undefined) base += offset
  return base
}

/**
 * Emit a one-shot dev warning when a safe-area atom resolves without
 * real insets in scope.
 * @param insets Insets received by the resolver.
 */
function warnMissingInsetsOnce(insets: LookupInsets | undefined): void {
  if (WARNED_MISSING_INSETS) return
  const isDevelopment = typeof __DEV__ === 'undefined' || __DEV__
  if (!isDevelopment) return
  if (insets && (insets.top !== 0 || insets.right !== 0 || insets.bottom !== 0 || insets.left !== 0)) return
  WARNED_MISSING_INSETS = true
  // eslint-disable-next-line no-console
  console.warn(
    'rnwind: a `*-safe` utility resolved with zero insets. Wire `insets` on <SchemeProvider> ' +
      '(e.g. `insets={useSafeAreaInsets()}` from react-native-safe-area-context).',
  )
}

/**
 * Resolve precomputed safe-area marker specs into a fresh RN style
 * object. Cannot be cached — insets vary per render with rotation /
 * keyboard.
 * @param specs Array of spec tuples.
 * @param insets Live safe-area insets.
 * @returns Fresh RN style object with concrete numbers.
 */
function resolveSafe(specs: readonly SafeMarkerSpec[], insets: LookupInsets | undefined): Record<string, number> {
  warnMissingInsetsOnce(insets)
  const out: Record<string, number> = {}
  for (const spec of specs) out[spec[0]] = resolveMarker(spec, insets)
  return out
}

/**
 * Multiply `fontSize` / `lineHeight` in a resolved atom value by the
 * active font scale. Early-returns the original reference for any atom
 * that doesn't carry either property (most of them) — zero allocation
 * on the hot path for non-text atoms.
 * @param value Atom value as registered in the global table.
 * @param fontScale Multiplier from `useWindowDimensions().fontScale`.
 * @returns Scaled style object, or the original when no scaling applied.
 */
function applyFontScale(value: unknown, fontScale: number): unknown {
  if (fontScale === 1) return value
  if (typeof value !== 'object' || value === null) return value
  const record = value as Record<string, unknown>
  const fs = record.fontSize
  const lh = record.lineHeight
  if (typeof fs !== 'number' && typeof lh !== 'number') return value
  const scaled: Record<string, unknown> = { ...record }
  if (typeof fs === 'number') scaled.fontSize = fs * fontScale
  if (typeof lh === 'number') scaled.lineHeight = lh * fontScale
  return scaled
}

/**
 * Read the precomputed safe-area marker spec list off an atom value.
 * Build-side `envelopeSafeMarkers` wraps safe atoms in
 * `{__safeStyle: [...]}`; this is a single property access.
 * @param value Atom value as registered in the global table.
 * @returns Spec array when the atom is safe-area, else null.
 */
function readSafeSpecs(value: unknown): readonly SafeMarkerSpec[] | null {
  if (typeof value !== 'object' || value === null) return null
  const safe = (value as { __safeStyle?: readonly SafeMarkerSpec[] }).__safeStyle
  return safe ?? null
}

/**
 * Per-atom lookup. Two property reads: scheme's own table then the
 * common fallback. Returns `undefined` for unknown atoms — the caller
 * skips them.
 * @param scheme Active scheme.
 * @param atom Atom name.
 * @returns Resolved value, or undefined.
 */
function lookupAtom(scheme: string, atom: string): unknown {
  const schemeTable = cache.atoms[scheme]
  if (schemeTable !== undefined) {
    const own = schemeTable[atom]
    if (own !== undefined) return own
  }
  const common = cache.atoms[COMMON_SCHEME]
  return common === undefined ? undefined : common[atom]
}

/**
 * Whether an atom should participate in a given interact-state index.
 *  - idle (0): no `active:` / `focus:` atoms.
 *  - active (1): base + `active:`.
 *  - focus (2): base + `focus:`.
 *  - both (3): base + `active:` + `focus:`.
 * @param atom Atom name.
 * @param stateIndex Encoded state (0/1/2/3).
 * @returns True when the atom should be emitted for this state.
 */
function atomMatchesState(atom: string, stateIndex: StateIndex): boolean {
  // Cheap prefix check — check the first code point before the full
  // `startsWith` so we skip it for any atom whose first letter isn't
  // `a` / `f`.
  const code = atom.codePointAt(0)
  if (code === 97 /* a */ && atom.startsWith(ACTIVE_PREFIX)) return (stateIndex & 1) !== 0
  if (code === 102 /* f */ && atom.startsWith(FOCUS_PREFIX)) return (stateIndex & 2) !== 0
  return true
}

/**
 * Whether an atom passes the responsive-breakpoint gate for the
 * current `windowWidth`. Atoms without a registered `<prefix>:` are
 * always-on (the common case — `bg-red-500`, `active:bg-blue-700`).
 * Atoms whose first prefix matches a registered breakpoint name pass
 * only when `windowWidth >= threshold`.
 * @param atom Atom name.
 * @param windowWidth Live `useWindowDimensions().width` snapshot.
 * @returns True when the atom should be emitted for this width.
 */
function atomMatchesBreakpoint(atom: string, windowWidth: number): boolean {
  const colon = atom.indexOf(':')
  if (colon === -1) return true
  const prefix = atom.slice(0, colon)
  const threshold = cache.breakpoints[prefix]
  if (threshold === undefined) return true
  return windowWidth >= threshold
}

/**
 * Tier index — count of registered breakpoints whose threshold is
 * `<= windowWidth`. Bounded by the breakpoint count, so it's a stable
 * cache-key dimension instead of the unbounded raw width. Crossings
 * happen ~5 times across the device-width spectrum, not per-pixel.
 * @param windowWidth Live width.
 * @returns Tier 0..N where N = `cache.breakpointList.length`.
 */
function tierFor(windowWidth: number): number {
  let tier = 0
  for (const entry of cache.breakpointList) {
    if (windowWidth >= entry.minWidth) tier += 1
    else break
  }
  return tier
}

/**
 * Build the style array for a (hoist, scheme, state, width) tuple.
 * Walks the atom list, applies the interact-state and breakpoint
 * filters, resolves each atom via scheme→common fallback, and
 * envelopes safe values via {@link resolveSafe}.
 * @param atoms Atom name list (build-time constant).
 * @param scheme Active scheme.
 * @param stateIndex Encoded active/focus state.
 * @param insets Live safe-area insets.
 * @param fontScale Font scale multiplier.
 * @param windowWidth Live window width — gates `md:*` / `lg:*` atoms.
 * @returns Fresh style array.
 */
function buildStyleArray(
  atoms: readonly string[],
  scheme: string,
  stateIndex: StateIndex,
  insets: LookupInsets | undefined,
  fontScale: number,
  windowWidth: number,
): readonly unknown[] {
  const out: unknown[] = []
  for (const atom of atoms) {
    if (!atomMatchesState(atom, stateIndex)) continue
    if (!atomMatchesBreakpoint(atom, windowWidth)) continue
    const value = lookupAtom(scheme, atom)
    if (value === undefined) {
      warnUnknownAtomOnce(atom)
      continue
    }
    const safe = readSafeSpecs(value)
    const resolved = safe === null ? value : resolveSafe(safe, insets)
    out.push(applyFontScale(resolved, fontScale))
  }
  return out
}

/**
 * Emit a one-shot dev warning when an atom name doesn't resolve in the
 * registry. The two real causes are a typo (`bg-red-501`) or a class
 * the build-time scanner never saw because it lives in a string the
 * oxide tokeniser can't see (e.g. computed at runtime). Either way, a
 * silent empty style is the worst possible UX — surface it.
 *
 * Filters cosmetic non-issues: empty strings, build-time `__safeStyle`
 * envelopes that wandered in, etc.
 * @param atom Class name that didn't resolve.
 */
function warnUnknownAtomOnce(atom: string): void {
  if (atom.length === 0) return
  const isDevelopment = typeof __DEV__ === 'undefined' || __DEV__
  if (!isDevelopment) return
  if (WARNED_UNKNOWN_ATOMS.has(atom)) return
  WARNED_UNKNOWN_ATOMS.add(atom)
  // eslint-disable-next-line no-console
  console.warn(
    `rnwind: unknown class "${atom}" — typo, or the class is built dynamically and the build-time ` +
      `scanner never saw it. Static literals + ternaries are scanned automatically; runtime-built ` +
      `strings need to appear somewhere as a literal so oxide can pick them up.`,
  )
}

/**
 * Per-hoist cache entry. `version` stamps `atomVersion` at build time
 * so HMR reloads (which bump the counter) invalidate cleanly on next
 * read. `hasSafe` prevents caching results whose values depend on
 * per-render insets. `byKey` maps `"${scheme}|${stateIndex}"` to the
 * cached result.
 */
interface HoistCache {
  version: number
  hasSafe: boolean
  byKey: Partial<Record<string, readonly unknown[]>>
}

/**
 * Per-atom-list cache keyed on the hoist reference. WeakMap so
 * hoists GC with their host module on HMR.
 */
const resultCache = new WeakMap<readonly string[], HoistCache>()

/**
 * Walk the atom list once to detect safe-area atoms — results that
 * vary per render with `insets`. When any atom envelopes safe specs
 * we skip the cache and rebuild every call.
 * @param atoms Hoist atom list.
 * @param scheme Active scheme.
 * @returns Whether the hoist resolves a safe atom under this scheme.
 */
function detectHasSafe(atoms: readonly string[], scheme: string): boolean {
  for (const atom of atoms) {
    const value = lookupAtom(scheme, atom)
    if (readSafeSpecs(value) !== null) return true
  }
  return false
}

/**
 * Cache-keyed resolution for the common static-schema case. Returns a
 * stable array reference across renders until `atomVersion` bumps.
 * For hoists containing safe atoms — which depend on per-render
 * insets — rebuilds every call.
 *
 * The `tier` dimension keeps the cache bounded under responsive
 * variants: instead of keying on raw `windowWidth` (which would explode
 * the cache to one entry per pixel), we key on the count of registered
 * breakpoints whose threshold is reached. That gives at most
 * `breakpointCount + 1` cache rows per (scheme, state, fontScale).
 * @param atoms Hoist atom list.
 * @param scheme Active scheme.
 * @param stateIndex Encoded interact state.
 * @param insets Live safe-area insets.
 * @param fontScale Font scale multiplier.
 * @param windowWidth Live window width.
 * @returns Style array.
 */
function lookupCached(
  atoms: readonly string[],
  scheme: string,
  stateIndex: StateIndex,
  insets: LookupInsets | undefined,
  fontScale: number,
  windowWidth: number,
): readonly unknown[] {
  let entry = resultCache.get(atoms)
  if (entry?.version !== atomVersion) {
    entry = { version: atomVersion, hasSafe: detectHasSafe(atoms, scheme), byKey: Object.create(null) }
    resultCache.set(atoms, entry)
  }
  if (entry.hasSafe) return buildStyleArray(atoms, scheme, stateIndex, insets, fontScale, windowWidth)
  const tier = tierFor(windowWidth)
  const key = `${scheme}|${stateIndex}|${fontScale}|${tier}`
  const cached = entry.byKey[key]
  if (cached !== undefined) return cached
  const fresh = buildStyleArray(atoms, scheme, stateIndex, insets, fontScale, windowWidth)
  entry.byKey[key] = fresh
  return fresh
}

/**
 * Per-render snapshot of which interactive states (active, focus) are
 * currently engaged. Forwarded from the `useInteract()` hook the
 * transformer injects.
 */
export interface InteractState {
  active?: boolean
  focus?: boolean
}

/**
 * Safe-area insets bundle the transformer passes to `lookupCss` when a
 * file uses any `*-safe` utility.
 */
export interface LookupInsets {
  top: number
  right: number
  bottom: number
  left: number
}


/**
 * Precomputed safe-area marker spec emitted by the build-side
 * `envelopeSafeMarkers`. Tuple form: `[cssKey, sideTag, or, offset]`.
 */
export type SafeMarkerSpec = readonly [string, string, number | undefined, number | undefined]

/** Type alias: the atom-list build output the transformer emits. */
export type HoistedClassName = readonly string[]

/**
 * Register a window-height provider used by the `screen-minus-y`
 * safe-area variant. When not wired, `h-screen-safe` resolves to `0`.
 * @param provider Callback returning the current window height in px.
 */
export function setWindowHeightProvider(provider: WindowHeightProvider | null): void {
  windowHeightProvider = provider
}

/**
 * Register the scheme-loader function exported by the generated
 * manifest module. Called once at manifest-module evaluation time —
 * subsequent registrations override the previous loader (useful for
 * tests).
 * @param loader Manifest's `ensureSchemeLoaded` function, or null to
 *   detach (tests).
 */
export function registerSchemeLoader(loader: SchemeLoader | null): void {
  schemeLoader = loader
}

/**
 * Ensure the given scheme's style module is loaded. Safe to call in
 * render — zero-cost after the first call per scheme thanks to
 * Metro's module cache, and a no-op when no loader is registered
 * (tests, or a bundle without rnwind-transformed sources).
 * @param scheme Active scheme name.
 */
export function loadScheme(scheme: string): void {
  if (schemeLoader) schemeLoader(scheme)
}

/**
 * Register (or re-register) one scheme's atoms in the global registry.
 * Pure property assignment — no iteration, no allocation. The version
 * counter bump invalidates every hoist-level result cache lazily on
 * next read.
 * @param scheme Registry key — `'common'` for the always-loaded
 *   fallback, or a variant name (`'dark'`, `'light'`, `'brand'`, ...).
 * @param atoms Plain record keyed by atom name.
 */
export function registerAtoms(scheme: string, atoms: Record<string, unknown>): void {
  cache.atoms[scheme] = atoms
  atomVersion += 1
}

/**
 * Current registry version — bumps on every `registerAtoms` /
 * `registerBreakpoints`. The molecule resolver folds it into its cache
 * key so an HMR atom reload invalidates derived results.
 * @returns Monotonic version counter.
 */
export function getStyleVersion(): number {
  return atomVersion
}

/**
 * Register the responsive-breakpoint table the manifest module emits at
 * load time. Replaces the prior table — calling with `{}` clears it.
 * Bumps `atomVersion` so any cached lookup invalidates on next read,
 * which matters during a theme HMR cycle that adds/removes breakpoints.
 * @param breakpoints Breakpoint name → minimum-width threshold (px).
 */
export function registerBreakpoints(breakpoints: Record<string, number>): void {
  const fresh: Partial<Record<string, number>> = Object.create(null)
  const list: BreakpointEntry[] = []
  for (const name of Object.keys(breakpoints)) {
    const minWidth = breakpoints[name]
    if (!Number.isFinite(minWidth) || minWidth <= 0) continue
    fresh[name] = minWidth
    list.push({ name, minWidth })
  }
  list.sort((a, b) => a.minWidth - b.minWidth || a.name.localeCompare(b.name))
  cache.breakpoints = fresh
  cache.breakpointList = list
  atomVersion += 1
}

/**
 * Snapshot of the registered breakpoints, for callers that want to
 * compute their own derivations (e.g. the provider deriving the active
 * breakpoint name). Returns a fresh array — callers can iterate without
 * worrying about concurrent mutation from a manifest reload.
 * @returns Breakpoints sorted by ascending min-width threshold.
 */
export function getBreakpoints(): readonly BreakpointEntry[] {
  return cache.breakpointList
}

/**
 * Sentinel name returned by {@link activeBreakpointFor} ONLY when no
 * breakpoints are registered at all (bundle without rnwind-transformed
 * sources, fresh test setup). When at least one breakpoint is
 * registered, the function falls back to the smallest registered name
 * instead — so phone-width devices (402 dp on a stock iPhone, well
 * below `sm = 640`) report `activeBreakpoint === 'sm'` rather than the
 * abstract `'base'`. This matches the user expectation that the value
 * is always a real Tailwind breakpoint label they can branch on.
 *
 * Note: this is decoupled from the className filter. `sm:*` atoms
 * still only fire at `windowWidth >= 640` per Tailwind's mobile-first
 * spec — `activeBreakpoint === 'sm'` at 402 means "I'm in the smallest
 * tier", not "`sm:` classes are firing".
 */
export const BASE_BREAKPOINT = 'base'

/**
 * Resolve the currently-active breakpoint name for a width:
 *  - `windowWidth >= some threshold` → the highest matching breakpoint name.
 *  - below every registered threshold → the smallest registered name.
 *  - no breakpoints registered → {@link BASE_BREAKPOINT}.
 * Always returns a string so consumers can branch on it without
 * null-handling.
 * @param windowWidth Live window width in px.
 * @returns Active breakpoint name (never null).
 */
export function activeBreakpointFor(windowWidth: number): string {
  const list = cache.breakpointList
  if (list.length === 0) return BASE_BREAKPOINT
  let active: string = list[0]!.name
  for (const entry of list) {
    if (windowWidth >= entry.minWidth) active = entry.name
    else break
  }
  return active
}

/**
 * Resolve a className input against the active rnwind context. Hot
 * path:
 *  - Array input (build hoist): ONE WeakMap.get + ONE record-access
 *    + cached array return. No per-render allocation when there's no
 *    userStyle and the hoist has no safe atoms.
 *  - String input (dynamic `className={expr}`): tokenise + walk.
 * @param input Hoisted atom list or raw className string.
 * @param ctx Rnwind context — `{scheme, fontScale, insets}` (extra
 *   fields ignored). Pass the result of `useRnwind()` directly.
 * @param userStyle Optional caller-supplied style appended last.
 * @param interactState Live active/focus flags from `useInteract()`.
 * @returns Style array for React Native's `style` prop.
 */
export function lookupCss(
  input: HoistedClassName | string | null | undefined,
  ctx: RnwindState,
  userStyle?: unknown,
  interactState?: InteractState,
): readonly unknown[] {
  if (input === null || input === undefined) {
    return userStyle === undefined || userStyle === null ? EMPTY_STYLES : [userStyle]
  }
  const { scheme, insets, fontScale, windowWidth } = ctx
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (trimmed.length === 0) {
      return userStyle === undefined || userStyle === null ? EMPTY_STYLES : [userStyle]
    }
    const atoms = trimmed.split(/\s+/)
    const out = buildStyleArray(atoms, scheme, stateIndexFor(interactState), insets, fontScale, windowWidth)
    if (userStyle === undefined || userStyle === null) return out
    return [...out, userStyle]
  }
  const base = lookupCached(input, scheme, stateIndexFor(interactState), insets, fontScale, windowWidth)
  if (userStyle === undefined || userStyle === null) return base
  return [...base, userStyle]
}

/** Test-only — clear the global registry between suites. */
export function __resetLookupCssState(): void {
  for (const key of Object.keys(cache.atoms)) delete cache.atoms[key]
  for (const key of Object.keys(cache.breakpoints)) delete cache.breakpoints[key]
  cache.breakpointList = []
  windowHeightProvider = null
  schemeLoader = null
  WARNED_MISSING_INSETS = false
  WARNED_UNKNOWN_ATOMS.clear()
  atomVersion += 1
}

/**
 * Test-only sugar: accept a single-scheme record and register it as the
 * `common` table.
 * @param record Atom name → value record (registered under `common`).
 */
export function __registerAtomsFromRecord(record: Record<string, unknown>): void {
  registerAtoms(COMMON_SCHEME, record)
}
