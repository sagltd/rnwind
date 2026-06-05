import * as tailwindNode from '@tailwindcss/node'
import { TailwindParser, type RNStyle } from '../../src/core/parser'

/**
 * Shared coverage foundation. Enumerates EVERY Tailwind v4 utility from the
 * compiled design system (the same `getClassList()` IntelliSense uses) and
 * resolves each through the real {@link TailwindParser}, so coverage tests
 * assert against the actual utility surface instead of a hand-curated list —
 * a class can never silently go untested, and a new Tailwind release surfaces
 * automatically.
 */

/** Default theme: stock Tailwind, no custom `@theme`. */
export const DEFAULT_THEME = `@import 'tailwindcss';`

/** Narrowed view of the unstable design-system loader — just class enumeration. */
interface DesignSystem {
  getClassList: () => ReadonlyArray<readonly [string, unknown] | string>
}

const loadDesignSystem = (tailwindNode as unknown as {
  __unstable__loadDesignSystem?: (css: string, options: { base: string }) => Promise<DesignSystem>
}).__unstable__loadDesignSystem

/** Substrings that must NEVER appear in a serialized RN value — each is a parser leak. */
const FORBIDDEN_FRAGMENTS: readonly string[] = ['var(', 'calc(', 'infinity', 'nan', 'undefined']

/**
 * CSS-wide cascade keywords. RN has no cascade, so any of these reaching a
 * style value (e.g. `color: 'currentColor'`, `color: 'inherit'`) is invalid —
 * RN can't resolve them. Exact-match (lowercased), never substring.
 */
const CASCADE_KEYWORDS: ReadonlySet<string> = new Set(['currentcolor', 'inherit', 'initial', 'unset', 'revert', 'revert-layer'])

/** Bare CSS-grammar placeholders that leak when Tailwind emits a syntax-doc stand-in (`bg-[color]`). */
const PLACEHOLDER_KEYWORDS: ReadonlySet<string> = new Set([
  'color',
  'color/width',
  'color/position/size',
  'angle',
  'length',
  'position',
  'image',
  'family-name',
  'url',
])

/**
 * RN keys whose VALUE is legitimately a CSS keyword/identifier, so the
 * placeholder-keyword check must be skipped for them. `transitionProperty:
 * "color"` means "animate the color property" — `"color"` is the real value,
 * not a leaked grammar stand-in. var()/calc()/NaN checks still apply.
 */
const KEYWORD_VALUE_KEYS: ReadonlySet<string> = new Set(['transitionProperty', 'willChange', 'pointerEvents'])

/**
 * Valid value sets for RN enum style props. A class that resolves to a value
 * outside its prop's set (e.g. `position: 'fixed'`, `display: 'contents'`,
 * `justifyContent: 'stretch'`, `textDecorationLine: 'overline'`) is RN-invalid
 * even though the string itself looks clean — RN ignores or warns on it. This
 * is the dimension the leak-shape check alone misses. Sets mirror RN's
 * documented ViewStyle / TextStyle enums.
 */
const RN_ENUM_VALUES: Readonly<Record<string, ReadonlySet<string>>> = {
  position: new Set(['absolute', 'relative', 'static']),
  display: new Set(['flex', 'none']),
  flexDirection: new Set(['row', 'row-reverse', 'column', 'column-reverse']),
  flexWrap: new Set(['wrap', 'nowrap', 'wrap-reverse']),
  justifyContent: new Set(['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly']),
  alignItems: new Set(['flex-start', 'flex-end', 'center', 'stretch', 'baseline']),
  alignContent: new Set(['flex-start', 'flex-end', 'center', 'stretch', 'space-between', 'space-around', 'space-evenly']),
  alignSelf: new Set(['auto', 'flex-start', 'flex-end', 'center', 'stretch', 'baseline']),
  overflow: new Set(['visible', 'hidden', 'scroll']),
  textAlign: new Set(['auto', 'left', 'right', 'center', 'justify']),
  textAlignVertical: new Set(['auto', 'top', 'bottom', 'center']),
  textTransform: new Set(['none', 'uppercase', 'lowercase', 'capitalize']),
  textDecorationLine: new Set(['none', 'underline', 'line-through', 'underline line-through']),
  textDecorationStyle: new Set(['solid', 'double', 'dotted', 'dashed']),
  fontStyle: new Set(['normal', 'italic']),
  // RN's borderStyle TYPE is solid/dotted/dashed, but the runtime tolerates
  // `none` (renders no border — the intent of `border-none`); harmless, not a leak.
  borderStyle: new Set(['solid', 'dotted', 'dashed', 'none']),
  backfaceVisibility: new Set(['visible', 'hidden']),
}

/**
 * Cleanliness check for a scalar (number / string / null) value.
 * @param value Scalar RN style value.
 * @param allowKeyword Skip the placeholder-keyword check (value is a real CSS identifier).
 * @returns Failure reason string, or null when clean.
 */
function scalarUncleanReason(value: unknown, allowKeyword: boolean): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? null : `non-finite number ${value}`
  if (value === null || value === undefined) return 'null/undefined value'
  if (typeof value !== 'string') return null
  if (value.length === 0) return 'empty string'
  if (!allowKeyword && PLACEHOLDER_KEYWORDS.has(value)) return `placeholder keyword "${value}"`
  const lower = value.toLowerCase()
  if (CASCADE_KEYWORDS.has(lower)) return `CSS cascade keyword "${value}" (no RN equivalent)`
  for (const fragment of FORBIDDEN_FRAGMENTS) if (lower.includes(fragment)) return `contains "${fragment}" (${value})`
  return null
}

/**
 * Per-value cleanliness check — recurses RN composites (transform arrays,
 * fontVariant arrays, animationName keyframe records).
 * @param value RN style value at any depth.
 * @param allowKeyword Skip the placeholder-keyword check (value is a real CSS identifier).
 * @returns Failure reason string, or null when clean.
 */
function uncleanReason(value: unknown, allowKeyword: boolean): string | null {
  if (Array.isArray(value)) return firstMemberUncleanReason(value, allowKeyword)
  if (value !== null && typeof value === 'object') return firstMemberUncleanReason(Object.values(value), allowKeyword)
  return scalarUncleanReason(value, allowKeyword)
}

/**
 * First unclean member of a composite (array entries / object values).
 * @param members Child values to scan.
 * @param allowKeyword Forwarded to {@link uncleanReason}.
 * @returns Failure reason, or null when all members are clean.
 */
function firstMemberUncleanReason(members: readonly unknown[], allowKeyword: boolean): string | null {
  for (const item of members) {
    const reason = uncleanReason(item, allowKeyword)
    if (reason) return reason
  }
  return null
}

/**
 * First unclean `prop: reason` in a resolved style, or null when the whole
 * style is RN-renderable.
 * @param style Resolved RN style.
 * @returns `"prop → reason"` for the first leak, or null.
 */
export function styleUncleanReason(style: RNStyle): string | null {
  for (const [key, value] of Object.entries(style)) {
    const reason = uncleanReason(value, KEYWORD_VALUE_KEYS.has(key))
    if (reason) return `${key} → ${reason}`
    const enumValues = RN_ENUM_VALUES[key]
    if (enumValues && typeof value === 'string' && !enumValues.has(value)) {
      return `${key} → invalid RN enum value "${value}"`
    }
  }
  return null
}

/** Memoized class-list per theme — loading the design system is expensive; do it once. */
const classListByTheme = new Map<string, Promise<string[]>>()

/**
 * Enumerate every utility class name from the compiled design system.
 * Memoized per theme so repeated calls (across test files / family sweeps)
 * don't re-load the design system.
 * @param themeCss Theme CSS to compile (defaults to stock Tailwind).
 * @returns Deduped, sorted list of utility class names.
 */
export function loadAllUtilityClasses(themeCss: string = DEFAULT_THEME): Promise<string[]> {
  let pending = classListByTheme.get(themeCss)
  if (!pending) {
    pending = loadClassList(themeCss)
    classListByTheme.set(themeCss, pending)
  }
  return pending
}

/**
 * Load + dedupe the design system's full class list (the memoized worker).
 * @param themeCss Theme CSS to compile.
 * @returns Deduped, sorted utility class names.
 */
async function loadClassList(themeCss: string): Promise<string[]> {
  if (typeof loadDesignSystem !== 'function') throw new Error('rnwind tests: __unstable__loadDesignSystem unavailable')
  const design = await loadDesignSystem(themeCss, { base: process.cwd() })
  const seen = new Set<string>()
  for (const entry of design.getClassList()) {
    const name = Array.isArray(entry) ? entry[0] : (entry as string)
    if (typeof name === 'string' && name.length > 0) seen.add(name)
  }
  return [...seen].toSorted((a, b) => a.localeCompare(b))
}

/** A theme's resolved base-scheme atom map plus the names that were in it. */
interface ThemeResolution {
  readonly scheme: string | undefined
  readonly atoms: Map<string, Record<string, RNStyle | undefined>>
  readonly names: ReadonlySet<string>
  readonly parser: TailwindParser
}

/**
 * One-compile-per-theme cache. CRITICAL for speed: `parseAtoms` keys its cache
 * by the exact candidate SET, so resolving classes one at a time recompiles all
 * of Tailwind per call (~700ms × hundreds of fixtures = minutes). Instead we
 * resolve the ENTIRE `getClassList()` surface in a single pass once per theme
 * (~750ms total), then every named-class lookup is O(1). Stored as a Promise so
 * concurrent first-callers share the one compile.
 */
const resolutionByTheme = new Map<string, Promise<ThemeResolution>>()

/** Per-call cache for ARBITRARY classes (`bg-[#abc]`, `w-[37px]`) absent from getClassList. */
const arbitraryStyleCache = new Map<string, RNStyle | undefined>()

/**
 * Resolve the full utility surface for a theme in one parser pass.
 * @param themeCss Theme CSS to compile against.
 * @returns The theme's resolved atom map + name set.
 */
async function resolveTheme(themeCss: string): Promise<ThemeResolution> {
  const parser = new TailwindParser({ themeCss })
  const names = await loadAllUtilityClasses(themeCss)
  const result = await parser.parseAtoms({ content: `<V className="${names.join(' ')}" />`, extension: 'tsx' })
  const [scheme] = result.schemes
  return { scheme, atoms: result.atoms as ThemeResolution['atoms'], names: new Set(names), parser }
}

/**
 * Lazily get (and cache) a theme's full resolution.
 * @param themeCss Theme CSS to compile against.
 * @returns The cached resolution promise.
 */
function themeResolution(themeCss: string): Promise<ThemeResolution> {
  let pending = resolutionByTheme.get(themeCss)
  if (!pending) {
    pending = resolveTheme(themeCss)
    resolutionByTheme.set(themeCss, pending)
  }
  return pending
}

/**
 * Resolve ONE class to its base-scheme RN style — the precision-layer
 * equivalent of Tailwind's `run([candidate])`. Named utilities resolve from the
 * pre-compiled full set (O(1)); only genuinely arbitrary classes (`[…]` values
 * not in `getClassList`) pay a one-off parse, itself cached.
 * @param className Utility class to resolve.
 * @param themeCss Theme CSS the parser compiles against.
 * @returns Base-scheme RN style, or undefined when the class drops.
 */
export async function resolveStyle(className: string, themeCss: string = DEFAULT_THEME): Promise<RNStyle | undefined> {
  const { scheme, atoms, names, parser } = await themeResolution(themeCss)
  // Named utility (supported OR cleanly dropped) → instant lookup, no recompile.
  if (names.has(className)) return scheme ? atoms.get(className)?.[scheme] : undefined
  // Arbitrary class outside getClassList → resolve once, cache.
  const key = `${themeCss} ${className}`
  const cached = arbitraryStyleCache.get(key)
  if (cached !== undefined || arbitraryStyleCache.has(key)) return cached
  const result = await parser.parseAtoms({ content: `<V className="${className}" />`, extension: 'tsx' })
  const [ownScheme] = result.schemes
  const style = ownScheme ? result.atoms.get(className)?.[ownScheme] : undefined
  arbitraryStyleCache.set(key, style)
  return style
}

/** One class's coverage verdict. */
export interface ClassVerdict {
  /** Class resolves to ≥1 RN style entry, all RN-renderable. */
  readonly supported: string[]
  /** Class produces no atom — intentionally unsupported (cursor, grid, …) or value-less functional stub. */
  readonly dropped: string[]
  /** Class resolves but leaks an unrenderable value — a real bug. `cls → reason`. */
  readonly dirty: string[]
}

/**
 * Resolve every class through one parser pass and bucket each into
 * supported / dropped / dirty. Single resolution pass (the parser resolves
 * the whole candidate set at once) keeps this cheap despite the 20k+ surface.
 * @param classes Utility class names to classify.
 * @param themeCss Theme CSS the parser compiles against.
 * @returns Bucketed verdict across all classes.
 */
export async function classifyAllClasses(classes: readonly string[], themeCss: string = DEFAULT_THEME): Promise<ClassVerdict> {
  const { scheme, atoms, names } = await themeResolution(themeCss)
  const supported: string[] = []
  const dropped: string[] = []
  const dirty: string[] = []
  for (const cls of classes) {
    // Reuse the one cached full-surface compile for named classes; only an
    // arbitrary class outside getClassList needs its own (cached) resolve.
    const style = names.has(cls) ? (scheme ? atoms.get(cls)?.[scheme] : undefined) : await resolveStyle(cls, themeCss)
    if (!style || Object.keys(style).length === 0) {
      dropped.push(cls)
      continue
    }
    const reason = styleUncleanReason(style)
    if (reason) dirty.push(`${cls} → ${reason}`)
    else supported.push(cls)
  }
  return { supported, dropped, dirty }
}
