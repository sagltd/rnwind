import { compile } from '@tailwindcss/node'
import * as tailwindNode from '@tailwindcss/node'
import { Scanner, type SourceEntry } from '@tailwindcss/oxide'
import { formatHex as culoriFormatHex } from 'culori'
import { Features, transform, type TransformOptions } from 'lightningcss'
import { declarationToRnEntries } from './declaration'
import { detectGradientAtom, type GradientAtomInfo } from './gradient'
import { detectHapticAtom, type HapticRequest } from './haptics'
import { keyframeSelectorOffsets, keyframesName, pickAnimationName } from './keyframes'
import { serializeInitialValue } from './property'
import { classNameFromSelector } from './selector'
import {
  BASE_SCHEME,
  compileReadyTheme,
  extractCustomVariantSchemes,
  extractSchemeAliases,
  extractThemeVars,
  type ThemeSchemeTable,
} from './theme-vars'
import { coerceUnparsedValue, serializeTokens, substituteThemeVars } from './tokens'
import { normalizeColorString } from './color'
import type { RNStyle } from './types'
import type { ThemeTable, ThemeTables } from '../types'
import type { Declaration as LcDeclaration, TokenOrValue } from 'lightningcss'

/**
 * Inferred compiler type. `@tailwindcss/node` doesn't export its
 * compiler shape as a named type, so we pull it off the `compile()`
 * return to stay resilient to minor upstream shape shifts.
 */
type TailwindCompiler = Awaited<ReturnType<typeof compile>>

/**
 * Default LightningCSS transform options for TailwindParser's visitor.
 * Its taken from official Tailwind source:
 * https://github.com/tailwindlabs/tailwindcss/blob/main/packages/%40tailwindcss-node/src/optimize.ts
 */
const DEFAULT_TRANSFORM_OPTIONS: Partial<TransformOptions<never>> = {
  drafts: {
    customMedia: true,
  },
  nonStandard: {
    deepSelectorCombinator: true,
  },
  include: Features.Nesting | Features.MediaQueries,
  exclude: Features.LogicalProperties | Features.DirSelector | Features.LightDark,
  // NOTE: deliberately no `targets`. With targets that include
  // color-mix-supporting browsers (Safari 16.4+, Chrome 111+, …),
  // lightningcss EVALUATES `color-mix(in oklab, var(--theme-color)
  // <pct>%, transparent)` at parse time using whichever value of
  // `--theme-color` it sees first in the cascade. Tailwind v4 emits
  // exactly this shape for `<prop>-<themed>/<N>` utilities (e.g.
  // `border-text/20`), so the resulting RGB color is locked to ONE
  // scheme — every variant gets the same value. By dropping targets,
  // lightningcss leaves color-mix as an unparsed function and our
  // per-scheme `unparsedToEntries` substitution path runs instead,
  // producing the right rgba(...) for each scheme. Targets in this
  // pipeline are otherwise unused — we never re-emit CSS from the AST.
}
/** Parser configuration — one instance per Metro session, theme CSS fixed. */
export interface TailwindParserConfig {
  /**
   * Theme CSS passed to `@tailwindcss/node`'s compiler. Typically the
   * user's `global.css`. We append `theme(inline)` to the tailwindcss
   * import so Tailwind resolves every `var(--theme-token)` at compile
   * time — that gives lightningcss fully-typed values (integers / rems /
   * colors) instead of unresolved `var()` references.
   */
  themeCss: string
  /**
   * Glob sources the oxide Scanner walks at project-scan time
   * (`parseProject()`). Typically
   * `[{ base: projectRoot, pattern: '**\/*.{ts,tsx,js,jsx}', negated: false }]`
   * plus negated globs for `node_modules` and the rnwind cache dir.
   *
   * When omitted, the scanner has no sources and `parseProject()`
   * returns an empty result — `parseAtoms()` (per-file, content-driven)
   * still works without sources.
   */
  sources?: readonly SourceEntry[]
}

/** Per-call inputs — Metro hands us file content + filename; we derive the extension. */
export interface ParseOptions {
  content: string
  extension: string
}

/** One parsed keyframe step — offset plus the RN style at that offset. */
export interface KeyframeStep {
  offset: string
  style: RNStyle
}

/** One parsed `@keyframes` animation block. */
export interface KeyframeBlock {
  name: string
  steps: KeyframeStep[]
}

/** Interactive variant ('active' / 'focus') an `active:`/`focus:` atom carries. */
export type InteractiveStateTag = 'active' | 'focus'

/**
 * Per-scheme resolved style for a single utility class. Keys are scheme
 * names declared via `@variant <name>` in the theme CSS (or the synthetic
 * `'base'` scheme for themes without variants). Values are the RN style
 * object under that scheme.
 *
 * The reserved `__state` key is set on `active:` / `focus:` atoms so
 * the build-side style-builder can tag the atom for `precomputeHoist`
 * — which routes interactive atoms into the stated-hoist's 4-state
 * precompute. Standard atoms have no `__state`.
 */
export type SchemedStyle = Readonly<Record<string, RNStyle>> & {
  /** Interactive-state gate set by `active:` / `focus:` variants. */
  readonly __state?: InteractiveStateTag
}

/** Full result of one `parseAtoms` call. */
export interface ParsedOutput {
  /** Resolved RN style per utility class, per declared scheme. */
  atoms: Map<string, SchemedStyle>
  /** `@keyframes <name> { ... }` blocks the candidates pulled in. */
  keyframes: Map<string, KeyframeBlock>
  /** `@property --x { initial-value: y }` declared custom-property defaults. */
  propertyDefaults: Map<string, string>
  /**
   * Gradient metadata per atom, for atoms that play a role in a
   * Tailwind v4 gradient (`from-*`, `via-*`, `to-*`, `bg-gradient-to-*`,
   * `bg-linear-to-*`). The transformer reads this map to extract
   * `colors / start / end` props at JSX-rewrite time. Regular non-
   * gradient atoms don't appear here.
   */
  gradientAtoms: Map<string, GradientAtomInfo>
  /**
   * Haptic metadata per atom for classes that emit a
   * `--rnwind-haptic` marker. The transformer reads this map to
   * strip the atom from the className and wire a mount-time or
   * press-time call into the `onHaptics` callback registered on
   * `<SchemeProvider>`.
   */
  hapticAtoms: Map<string, HapticRequest>
  /** Candidates oxide surfaced, in document order. */
  candidates: readonly string[]
  /** Every scheme the theme declares (or `['base']` when there are no `@variant` blocks). */
  schemes: readonly string[]
  /**
   * Responsive breakpoint name → minimum-width threshold (px). Pulled from
   * `--breakpoint-*` tokens in the compiled `:root` block, so both
   * Tailwind defaults (`sm`, `md`, `lg`, `xl`, `2xl`) and any user
   * override (e.g. `--breakpoint-3xl: 120rem`) land here. Used by the
   * style-builder to emit `registerBreakpoints({...})` in the manifest
   * so the runtime can filter `md:*` / `lg:*` atoms based on the
   * provider's `windowWidth`.
   */
  breakpoints: ReadonlyMap<string, number>
  /**
   * Per-scheme user theme token tables (`--color-*`, `--spacing-*`, …) with
   * `--color-*` values lowered to sRGB. The style-builder emits these as
   * `registerThemeTokens({...})` in the manifest so `useColor` / `useToken` /
   * `useSize` resolve out of the box, without the user threading a `tables`
   * prop on the provider. Keyed by scheme (`base` + each declared variant).
   */
  themeTokens: ThemeTables
}

/**
 * Parses one source file's Tailwind usage into RN-ready style objects.
 *
 * Pipeline:
 *  1. `@tailwindcss/oxide` Scanner finds every Tailwind candidate.
 *  2. `@tailwindcss/node` compiler emits CSS for those candidates with
 *     theme tokens inlined.
 *  3. lightningcss `transform` + typed visitor walks the emitted CSS:
 *     - `style` rules → per-class RN-style object.
 *     - `@keyframes` rules → per-name step map (Reanimated-ready).
 *     - `@property` rules → custom-property initial values.
 *
 * One instance holds one Scanner + one lazily-built compiler so repeated
 * calls share upstream state. Theme CSS is fixed at construction — theme
 * edits require a new parser.
 */
export class TailwindParser {
  private readonly scanner: Scanner
  private compiler: TailwindCompiler | undefined
  /** Full resolved base theme (built-in palette + user `@theme`), colors lowered to sRGB. Source for `useColor` / `useToken`. */
  private baseThemeTokens: ThemeTable | null = null
  private readonly themeSchemes: ThemeSchemeTable
  private readonly schemeAliases: ReadonlyMap<string, string>
  /**
   * Scheme names declared via `@custom-variant <name> …;`. A scheme
   * listed here but absent from {@link themeSchemes} (no `@variant`
   * override block) draws its values from the base `@theme` — the
   * standard Tailwind v4 "light defaults + dark override" shape.
   */
  private readonly customVariantSchemes: readonly string[]
  /**
   * Memoise `resolveCandidates` results by candidate-list fingerprint.
   * Fast Refresh hits this on every save: oxide's scan is cheap, but
   * the LightningCSS visitor walk over the compiled CSS is ~2ms per
   * file. A file whose `className` literals didn't change returns the
   * SAME candidate set, so the second `parseAtoms` call returns the
   * cached `ParsedOutput` — zero compile, zero visitor walk.
   *
   * Theme CSS changes build a new `TailwindParser` (from
   * `getRnwindState` detecting the hash shift), so this cache is
   * naturally invalidated — no stale-theme values leak through.
   */
  private readonly parseCache = new Map<string, ParsedOutput>()

  /**
   * Build a parser bound to a theme CSS source. `@theme` and
   * `@variant` blocks are extracted eagerly into a scheme table the
   * visitor consults when resolving `var(--x)` references.
   * @param config Parser configuration.
   */
  constructor(private readonly config: TailwindParserConfig) {
    this.themeSchemes = extractThemeVars(config.themeCss)
    this.schemeAliases = extractSchemeAliases(config.themeCss)
    this.customVariantSchemes = extractCustomVariantSchemes(config.themeCss)
    this.scanner = new Scanner({ sources: config.sources ? [...config.sources] : [] })
  }

  /**
   * Schemes declared by the user — the union of every `@custom-variant
   * <name>` declaration and every `@variant <name>` block, or just
   * `['base']` for themes without any. Used to decide how many
   * per-scheme buckets the per-atom resolver fills. Exposed publicly so
   * Metro integration can hand the names to the `.d.ts` generator
   * without a full parse.
   *
   * Both sources matter. `@variant` blocks alone miss the common
   * Tailwind v4 shape where the light palette sits in the base `@theme`
   * and only `@variant dark` overrides it: there `light` exists solely
   * as a `@custom-variant` and would otherwise be dropped, collapsing
   * every themed atom to a single bucket that can't switch.
   * `@custom-variant` order wins (it's where users enumerate their
   * schemes); any `@variant`-only scheme is appended after.
   * @returns Scheme names.
   */
  public get declaredSchemes(): readonly string[] {
    const ordered: string[] = []
    const seen = new Set<string>()
    for (const name of this.customVariantSchemes) {
      if (seen.has(name)) continue
      seen.add(name)
      ordered.push(name)
    }
    for (const name of this.themeSchemes.keys()) {
      if (name === BASE_SCHEME || seen.has(name)) continue
      seen.add(name)
      ordered.push(name)
    }
    return ordered.length > 0 ? ordered : [BASE_SCHEME]
  }

  /**
   * Build an effective var table for one scheme — base vars overridden by
   * variant vars. When the scheme IS `'base'` (no variants declared), the
   * base table is returned unchanged.
   * @param scheme Scheme name.
   * @returns Effective var name → value lookup for the scheme.
   */
  private effectiveVars(scheme: string): ReadonlyMap<string, string> {
    const base = this.themeSchemes.get(BASE_SCHEME)
    const variant = scheme === BASE_SCHEME ? undefined : this.themeSchemes.get(scheme)
    if (!variant) return base ?? new Map()
    // eslint-disable-next-line unicorn/no-useless-collection-argument
    const merged = new Map(base ?? [])
    for (const [k, v] of variant) merged.set(k, v)
    return merged
  }

  /**
   * Build the per-scheme theme token tables for `registerThemeTokens` —
   * the data source for `useColor` / `useToken` / `useSize`. Emits one table
   * per scheme the user wrote tokens under (`base` + each variant block /
   * `.dark` override). `--color-*` values are lowered to sRGB (matching the
   * className path) using `resolver` so a wide-gamut or `var()`-referencing
   * token resolves to an RN-renderable string; other tokens pass through.
   * @param resolver Full compiled `:root` table, for resolving `var()` refs.
   * @returns Scheme → (token name → value) map.
   */
  private buildThemeTokens(resolver: ReadonlyMap<string, string>): ThemeTables {
    const out: ThemeTables = {}
    // BASE: the full resolved theme (built-in palette + user `@theme`). The
    // runtime merges this under the active scheme, so `useColor('pink-500')`
    // and `useColor('<your-token>')` both resolve in every scheme.
    if (this.baseThemeTokens) out[BASE_SCHEME] = this.baseThemeTokens
    // VARIANTS: only the per-scheme overrides the user wrote (`.dark { … }` /
    // `@variant dark { … }`) — they layer on top of base at runtime.
    for (const scheme of this.themeSchemes.keys()) {
      if (scheme === BASE_SCHEME) continue
      const userTable = this.themeSchemes.get(scheme)
      if (!userTable || userTable.size === 0) continue
      const schemeResolver = new Map(resolver)
      for (const [k, v] of this.effectiveVars(scheme)) schemeResolver.set(k, v)
      const table: ThemeTable = {}
      for (const [name, raw] of userTable) {
        table[name] = name.startsWith('--color-') ? lowerColorToken(raw, schemeResolver) : raw
      }
      out[scheme] = table
    }
    return out
  }

  /**
   * Build the Tailwind compiler on first use and cache it. The theme CSS
   * gets a `theme(inline)` modifier on its `@import 'tailwindcss'` so
   * lightningcss sees resolved colors/lengths instead of `var()` refs.
   * @returns Cached compiler instance.
   */
  private async ensureCompiler(): Promise<TailwindCompiler> {
    if (this.compiler) return this.compiler
    const ready = compileReadyTheme(this.config.themeCss, this.themeSchemes)
    try {
      this.compiler = await compile(withInlineTheme(ready), {
        base: process.cwd(),
        onDependency: () => {},
      })
    } catch (error) {
      throw wrapThemeError(error)
    }
    // Load the resolved design system ONCE to capture the FULL theme — the
    // built-in palette (`pink-500`, …) plus the user's `@theme` tokens — so
    // `useColor` / `useToken` resolve any theme value, not just the utilities
    // a class happened to use (Tailwind tree-shakes `:root`, so the compiled
    // CSS alone never carries the full palette). Best-effort: a load failure
    // just narrows the hooks to the user's own tokens.
    this.baseThemeTokens = await loadBaseThemeTokens(ready)
    return this.compiler
  }

  /**
   * Parse one file's Tailwind usage into the full typed result.
   * @param options Source content + extension.
   * @param options.content Raw source text to scan for Tailwind candidates.
   * @param options.extension File extension (`tsx`, `ts`, `jsx`, `js`) — feeds oxide's tokenizer.
   * @returns RN atoms, keyframes, property defaults, candidates list.
   */
  public async parseAtoms({ content, extension }: ParseOptions): Promise<ParsedOutput> {
    const candidates = this.scanner.getCandidatesWithPositions({ content, extension }).map((c) => c.candidate)
    const fingerprint = fingerprintCandidates(candidates)
    const cached = this.parseCache.get(fingerprint)
    if (cached) return cached
    const result = await this.resolveCandidates(candidates)
    this.parseCache.set(fingerprint, result)
    return result
  }

  /**
   * Scan every source file the Scanner was configured to watch via
   * `sources` and resolve the union of candidates in one pass. Used by
   * `UnionBuilder` at Metro startup (and on first worker access) to
   * populate the complete atom registry before ANY per-file transform
   * has run — so scheme files never ship a partial view of the theme.
   *
   * Hot-reload path uses `parseAtoms` for the per-file delta; this one
   * only runs once per parser instance (and whenever the parser is
   * rebuilt due to a theme CSS change).
   * @returns Full RN atoms, keyframes, property defaults for every
   *   candidate discovered across the configured sources.
   */
  public async parseProject(): Promise<ParsedOutput> {
    const candidates = this.scanner.scan()
    return this.resolveCandidates(candidates)
  }

  /**
   * Compile + typed-visit the given candidate class names. Shared
   * implementation for both `parseAtoms` (single file) and
   * `parseProject` (whole project).
   * @param candidates Class-name candidates the oxide Scanner produced.
   * @returns Fully-typed parser result.
   */
  private async resolveCandidates(candidates: readonly string[]): Promise<ParsedOutput> {
    if (candidates.length === 0) return emptyOutput()
    const compiler = await this.ensureCompiler()
    let css: string
    try {
      css = compiler.build([...candidates])
    } catch (error) {
      throw wrapThemeError(error)
    }
    // Tailwind v4 emits opacity-suffixed themed colors as a pre-resolved
    // sRGB fallback PLUS a `@supports`-gated var()-based override:
    //   border-color: color-mix(in srgb, #0A0A0A 20%, transparent);
    //   @supports (color: color-mix(in lab, red, red)) {
    //     border-color: color-mix(in oklab, var(--color-text) 20%, transparent);
    //   }
    // Lightningcss takes the OUTER fallback (locked to whichever scheme
    // the compiler resolved first), and our per-scheme substitution
    // never gets a chance. Unwrap the @supports so the var()-based
    // declaration overrides the fallback in the same rule — lightningcss
    // emits the override as `unparsed` and the parser's themeVars-aware
    // path produces correct rgba per scheme.
    css = unwrapColorMixSupports(css)
    // `compiler.build(candidates)` memoizes across calls — it returns CSS for
    // every candidate the compiler has EVER seen in this process. To keep
    // parser output pure per-call we restrict outputs to this call's
    // candidates:
    //  - atoms: match class selectors against `wanted`.
    //  - keyframes: collect `animation-name` references during the style
    //    walk, then filter the visited keyframes to referenced names.
    const wanted = new Set(candidates)
    const schemes = this.declaredSchemes
    // Tailwind's compiled CSS contains every theme token — including
    // ones imported from secondary CSS files (e.g. `@import
    // 'rnwind/css'`). Pull them out of the `:root` block so
    // `var(--duration-normal)` style references in unparsed declarations
    // resolve to literal values (`220ms`) instead of being passed through
    // to RN, which can't read CSS custom properties.
    const compiledTheme = extractRootCustomProperties(css)
    const schemeTables = new Map<string, ReadonlyMap<string, string>>()
    for (const scheme of schemes) {
      const merged = new Map(compiledTheme)
      for (const [k, v] of this.effectiveVars(scheme)) merged.set(k, v)
      schemeTables.set(scheme, merged)
    }

    const atoms = new Map<string, Record<string, RNStyle>>()
    const keyframes: ParsedOutput['keyframes'] = new Map()
    const referencedKeyframes = new Set<string>()
    const propertyDefaults: ParsedOutput['propertyDefaults'] = new Map()
    const gradientAtoms: ParsedOutput['gradientAtoms'] = new Map()
    const hapticAtoms: ParsedOutput['hapticAtoms'] = new Map()
    const breakpoints = new Map<string, number>()
    const { schemeAliases } = this

    try {
      transform({
        ...DEFAULT_TRANSFORM_OPTIONS,
        filename: 'rnwind-virtual.css',
        code: Buffer.from(css),
        visitor: {
          Rule: {
            style(rule) {
              for (const selector of rule.value.selectors) {
                const className = classNameFromSelector(selector)
                if (!className || !wanted.has(className)) continue
                processStyleRule(
                  rule.value.declarations.declarations,
                  className,
                  { schemes, schemeTables, atoms, referencedKeyframes, schemeAliases, breakpoints },
                  rule.value.rules ?? [],
                )
                // Gradient atoms are detected per rule: the parser's main
                // RN-style path drops the `--tw-gradient-*` customs as
                // unsupported, but for gradient utilities we want to
                // surface their role + resolved colour so the transformer
                // can rewrite `<LinearGradient className="...">` into
                // `colors={...}` / `start={...}` / `end={...}` props.
                const gradientTable = schemeTables.get(BASE_SCHEME) ?? schemeTables.get(schemes[0] ?? BASE_SCHEME)
                const gradient = detectGradientAtom(rule.value.declarations.declarations, gradientTable)
                if (gradient) gradientAtoms.set(className, gradient)
                // Haptics may live on the rule directly OR inside a
                // nested pseudo (e.g. `&:active` for `active:haptic-*`).
                // Inspect both so `active:haptic-medium` registers.
                const hapticDecls: LcDeclaration[] = [...rule.value.declarations.declarations]
                for (const nested of rule.value.rules ?? []) hapticDecls.push(...collectNestedDecls(nested))
                const haptic = detectHapticAtom(hapticDecls)
                if (haptic) hapticAtoms.set(className, haptic)
              }
            },
            keyframes(rule) {
              const name = keyframesName(rule.value.name)
              if (!name) return
              const steps: KeyframeStep[] = []
              const baseTable = schemeTables.get(BASE_SCHEME) ?? schemeTables.get(schemes[0] ?? BASE_SCHEME)
              for (const frame of rule.value.keyframes) {
                const offsets = keyframeSelectorOffsets(frame.selectors)
                if (offsets.length === 0) continue
                const style: RNStyle = {}
                const frameDecls = frame.declarations.declarations ?? []
                for (const decl of frameDecls) {
                  for (const [key, value] of declarationToRnEntries(decl, baseTable)) style[key] = value
                }
                // One frame can carry several offsets (`0%, 100% { … }`); emit a
                // step for each so the terminal frame isn't lost.
                for (const offset of offsets) steps.push({ offset, style })
              }
              keyframes.set(name, { name, steps })
            },
            property(rule) {
              const initial = serializeInitialValue(rule.value.initialValue)
              if (initial !== null) propertyDefaults.set(rule.value.name, initial)
            },
          },
        },
      })
    } catch (error) {
      throw wrapThemeError(error)
    }

    // Prune keyframes to those actually referenced by this call's atoms.
    for (const name of keyframes.keys()) {
      if (!referencedKeyframes.has(name)) keyframes.delete(name)
    }

    const themeTokens = this.buildThemeTokens(compiledTheme)
    return { atoms, keyframes, propertyDefaults, gradientAtoms, hapticAtoms, candidates: [...candidates], schemes, breakpoints, themeTokens }
  }
}

/**
 * Lower a `--color-*` token value to an RN-renderable sRGB string, matching
 * the className path: resolve any `var()` ref via `resolver`, then lower a
 * wide-gamut form (`oklch(…)`, `lab(…)`, `color(p3 …)`) to sRGB. Hex / rgb /
 * named colors pass through unchanged.
 * @param raw Raw token value.
 * @param resolver Var name → value table for resolving `var()` references.
 * @returns RN-safe color string.
 */
function lowerColorToken(raw: string, resolver: ReadonlyMap<string, string>): string {
  const substituted = substituteThemeVars(raw, resolver)
  return normalizeColorString(substituted) ?? substituted
}

/** Theme token families excluded from the registered base table — pure Tailwind internals with no `useColor`/`useToken` value. */
const INTERNAL_TOKEN_PREFIXES: readonly string[] = ['--tw-', '--default-']

/** Shape of a resolved design-system theme entry from `@tailwindcss/node`'s unstable loader. */
interface DesignSystemTheme {
  theme?: { entries?: () => Iterable<[string, { value?: unknown }]> }
}

/**
 * `@tailwindcss/node`'s `__unstable__loadDesignSystem` — exists at runtime but
 * isn't in the package's published types, so it's accessed through a narrowed
 * cast rather than a named import. Returns `undefined` when the (unstable) API
 * isn't present, so {@link loadBaseThemeTokens} degrades gracefully.
 */
const loadDesignSystem = (tailwindNode as unknown as {
  __unstable__loadDesignSystem?: (css: string, options: { base: string }) => Promise<DesignSystemTheme>
}).__unstable__loadDesignSystem

/**
 * Load the FULL resolved Tailwind theme (built-in palette + the user's
 * `@theme`) via the design-system API and flatten it to an RN-safe token
 * table — `--color-*` values lowered to sRGB, everything else passed through.
 * This is what lets `useColor` / `useToken` resolve ANY theme token, including
 * built-ins a class never used (Tailwind tree-shakes the compiled `:root`, so
 * the compiled CSS alone can't supply the full palette). Internal `--tw-*` /
 * `--default-*` families are dropped. Returns `null` on any failure so the
 * caller degrades to the user's own `@theme` tokens.
 * @param themeCss Compile-ready theme CSS (variants stripped, custom-variants added).
 * @returns Flattened base token table, or null.
 */
async function loadBaseThemeTokens(themeCss: string): Promise<ThemeTable | null> {
  if (typeof loadDesignSystem !== 'function') return null
  try {
    const design = await loadDesignSystem(themeCss, { base: process.cwd() })
    const entries = design.theme?.entries?.()
    if (!entries) return null
    const table: ThemeTable = {}
    for (const [name, entry] of entries) {
      const raw = entry?.value
      if (typeof raw !== 'string') continue
      if (INTERNAL_TOKEN_PREFIXES.some((prefix) => name.startsWith(prefix))) continue
      table[name] = name.startsWith('--color-') ? (normalizeColorString(raw) ?? raw) : raw
    }
    return table
  } catch {
    return null
  }
}

/**
 * Wrap an error from `@tailwindcss/node`'s compiler or `lightningcss`'s
 * transform with a `rnwind:` prefix so the user sees a clear "this came
 * from your theme CSS" signal in Metro's stack trace. Preserves the
 * original error as `cause` so downstream tooling (Sentry, Metro
 * symbolication) can still inspect it.
 * @param error Underlying error from the compiler or transform.
 * @returns Prefixed Error with the original attached as `cause`.
 */
function wrapThemeError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  const wrapped = new Error(
    `rnwind: failed to compile theme CSS — ${message}\n` +
      `Check your global.css for unbalanced braces, unknown @utility / @variant declarations, ` +
      `or unsupported color functions. Run \`bun run --cwd packages/rnwind code-check\` if this is the rnwind repo itself.`,
  )
  if (error instanceof Error) (wrapped as { cause?: unknown }).cause = error
  return wrapped
}

/**
 * Fingerprint a candidate list for `parseCache` lookup. Sorting gives
 * the same key regardless of source order (the set of candidates is
 * what drives `resolveCandidates`'s output, not their order).
 * @param candidates Raw oxide-scanner output for one file.
 * @returns Canonical string key.
 */
function fingerprintCandidates(candidates: readonly string[]): string {
  if (candidates.length === 0) return ''
  if (candidates.length === 1) return candidates[0]!
  return [...candidates].toSorted((a, b) => a.localeCompare(b)).join('\0')
}

/**
 * Empty sentinel returned when oxide finds no candidates in the file.
 * @returns Zero-atom result with only the `base` scheme declared.
 */
function emptyOutput(): ParsedOutput {
  return {
    atoms: new Map(),
    keyframes: new Map(),
    propertyDefaults: new Map(),
    gradientAtoms: new Map(),
    hapticAtoms: new Map(),
    candidates: [],
    schemes: [BASE_SCHEME],
    breakpoints: new Map(),
    themeTokens: {},
  }
}

/**
 * Upgrade `@import 'tailwindcss'` (single- or double-quoted, with or
 * without an existing `theme(...)` clause) to `@import 'tailwindcss'
 * theme(inline)`. User-authored `theme(...)` clauses are preserved so
 * overrides win.
 * @param css Theme CSS source.
 * @returns CSS with the Tailwind import upgraded.
 */
function withInlineTheme(css: string): string {
  return css.replaceAll(/(@import\s+['"]tailwindcss['"])(?!\s*theme\()/g, '$1 theme(inline)')
}

/**
 * Collect rule-local custom-property writes (`--tw-translate-x`,
 * `--tw-scale-x`, `--tw-skew-y`, …). Tailwind v4 uses these as
 * composable transform tokens that `translate: var(--tw-translate-x)
 * var(--tw-translate-y)` then references. Surfacing them as theme vars
 * lets the declaration converter resolve the references as if they
 * were declared in `@theme`.
 * @param decls All declarations from one lightningcss style rule.
 * @returns Map from custom-property name (with leading `--`) to its raw value.
 */
function collectRuleLocalVars(decls: readonly { property: string; value: unknown }[]): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  for (const decl of decls) {
    if (decl.property !== 'custom') continue
    const custom = decl.value as { name: { name: string } | string; value?: readonly TokenOrValue[] }
    const rawName = typeof custom.name === 'string' ? custom.name : custom.name.name
    if (!rawName.startsWith('--tw-')) continue
    if (!custom.value) continue
    const text = serializeTokens(custom.value).trim()
    if (text.length > 0) out.set(rawName, text)
  }
  return out
}

interface StyleRuleContext {
  schemes: readonly string[]
  schemeTables: ReadonlyMap<string, ReadonlyMap<string, string>>
  atoms: Map<string, Record<string, RNStyle>>
  referencedKeyframes: Set<string>
  schemeAliases: ReadonlyMap<string, string>
  /**
   * Mutable breakpoint registry — `applyMediaRule` populates this as it
   * walks responsive variant atoms. The driving signal is the `@media
   * (width >= Xrem)` condition on the nested rule. Result lives on
   * {@link ParsedOutput.breakpoints}.
   */
  breakpoints: Map<string, number>
}

/**
 * Process one matched style rule for a given class name: fold its
 * declarations into the per-scheme buckets, detect referenced keyframes,
 * then apply Tailwind's composable transform post-pass.
 * @param declarations Declarations from one lightningcss style rule.
 * @param className Class name this rule's selectors matched.
 * @param ctx Parser-call-wide context (schemes, tables, output maps).
 * @param nestedRules Nested style rules (Tailwind variant prefixes like `dark:`
 *   wrap their decls in `&:where(.<scheme>, .<scheme> *)` nested rules).
 */
function processStyleRule(
  declarations: readonly LcDeclaration[],
  className: string,
  ctx: StyleRuleContext,
  nestedRules: readonly unknown[] = [],
): void {
  const bucket = ctx.atoms.get(className) ?? {}
  const ruleLocalVars = collectRuleLocalVars(declarations)
  const ruleSchemeTables = mergeRuleVars(ctx.schemeTables, ruleLocalVars)
  // Detect active:/focus: prefix on the class name. Tailwind emits the
  // actual decls inside `&:active { … }` / `&:focus { … }`, and the
  // OUTER rule has zero direct decls — so the existing per-scheme phase
  // below produces an empty bucket. We collect the inner decls into the
  // base scheme and tag the bucket with `__state` so the style-builder
  // can route the atom into `precomputeHoist`'s state buckets when the
  // interactive state.
  const interactiveState = classNameStateOf(className)
  // Phase 1: outer declarations apply to EVERY scheme (unconditional
  // utilities like `opacity-50`).
  for (const decl of declarations) {
    applyDeclarationToBucket(decl, bucket, ctx.schemes, ruleSchemeTables)
    const animationRef = pickAnimationName(decl)
    if (animationRef) ctx.referencedKeyframes.add(animationRef)
  }
  applyComposedTransform(bucket, ctx.schemes, ruleLocalVars)
  applyComposedShadow(bucket, ctx.schemes, ruleLocalVars, ruleSchemeTables)
  applyComposedRing(bucket, ctx.schemes, ruleLocalVars, ruleSchemeTables)
  // Phase 2: nested rules — three orthogonal flavours, dispatched on
  // the lightningcss node `type`:
  //  - `media`: Tailwind v4 responsive variants (`sm:`, `md:`, …) wrap
  //    declarations in `@media (width >= Xrem)`. Decls fold into every
  //    scheme; the atom's name carries the breakpoint association so
  //    the runtime can gate it on `windowWidth`.
  //  - `style` + `interactiveState`: `&:active` / `&:focus` pseudo
  //    decls (every scheme — interaction is theme-orthogonal).
  //  - `style` (default): Tailwind v4 scheme variants
  //    (`&:where(.<scheme>, .<scheme> *)`).
  for (const scheme of ctx.schemes) bucket[scheme] = bucket[scheme] ?? {}
  for (const nested of nestedRules) {
    const node = nested as { type?: string }
    if (node?.type === 'media') {
      applyMediaRule(nested, className, bucket, ctx, ruleSchemeTables, ruleLocalVars)
      continue
    }
    if (interactiveState) {
      applyInteractiveNestedRule(nested, bucket, ctx, ruleSchemeTables, ruleLocalVars)
    } else {
      applyNestedSchemeRule(nested, bucket, ctx, ruleSchemeTables, ruleLocalVars)
    }
  }
  normalizeLineHeightToPx(bucket, ctx.schemes)
  if (interactiveState) (bucket as Record<string, unknown>).__state = interactiveState
  ctx.atoms.set(className, bucket)
}

/** Recognised interactive variant prefixes. RN can drive both at runtime. */
const INTERACTIVE_PREFIXES = new Set(['active', 'focus'])

/**
 * Inspect a class name for a leading interactive variant prefix. The
 * Tailwind compiler emits `active:bg-sky-700` literally (backslash-
 * escaped for CSS), and that name is the same string the parser sees.
 * So a cheap `split(':')` on the head is enough — no need to parse the
 * pseudo-class out of the selector itself.
 * @param className Tailwind utility class (e.g. `active:bg-sky-700`).
 * @returns The interactive state prefix (`'active'` / `'focus'`), or null when none.
 */
function classNameStateOf(className: string): 'active' | 'focus' | null {
  const colon = className.indexOf(':')
  if (colon === -1) return null
  const prefix = className.slice(0, colon)
  if (!INTERACTIVE_PREFIXES.has(prefix)) return null
  return prefix as 'active' | 'focus'
}

/**
 * Pull the `min-width` threshold (px) out of a `@media (width >= Xrem)`
 * lightningcss node. Tailwind v4 emits exactly this shape for every
 * responsive variant — `>= 40rem` for `sm`, `>= 48rem` for `md`, etc.
 * Returns null for any other media condition (`hover`, `prefers-*`,
 * range bounds we don't model) so the caller can skip non-responsive
 * media wrappers without breaking.
 * @param nested A lightningcss `media` rule node.
 * @returns Threshold in px, or null when the condition isn't a simple
 *   width-min check.
 */
function readMediaMinWidthPx(nested: unknown): number | null {
  if (typeof nested !== 'object' || nested === null) return null
  const node = nested as { type?: string; value?: { query?: { mediaQueries?: readonly unknown[] } } }
  if (node.type !== 'media') return null
  const queries = node.value?.query?.mediaQueries
  if (queries?.length !== 1) return null
  const query = queries[0] as {
    condition?: {
      type?: string
      value?: {
        type?: string
        name?: string
        operator?: string
        value?: { type?: string; value?: { type?: string; value?: { unit?: string; value?: number } } }
      }
    }
  }
  const {condition} = query
  if (condition?.type !== 'feature') return null
  const feature = condition.value
  if (feature?.type !== 'range' || feature.name !== 'width') return null
  if (feature.operator !== 'greater-than-equal') return null
  const length = feature.value
  if (length?.type !== 'length') return null
  const inner = length.value?.value
  if (!inner || typeof inner.value !== 'number') return null
  if (inner.unit === 'rem') return inner.value * 16
  if (inner.unit === 'px') return inner.value
  return null
}

/**
 * Pull the leading `prefix:` segment off a className. `md:bg-red-500`
 * → `'md'`. Returns null for atoms without a colon (the common case)
 * or for empty prefixes.
 * @param className Atom name.
 * @returns Prefix or null.
 */
function leadingPrefix(className: string): string | null {
  const colon = className.indexOf(':')
  if (colon <= 0) return null
  return className.slice(0, colon)
}

/**
 * Fold a Tailwind v4 responsive `@media (width >= Xrem)` nested rule
 * into every scheme's bucket and record the breakpoint threshold
 * (`md` → 768) on the parser-call context. The runtime later gates the
 * atom on `windowWidth` against this threshold via the prefix on the
 * atom's class name.
 *
 * Read directly from the media condition rather than from compiled
 * `--breakpoint-*` `:root` tokens because Tailwind's `theme(inline)`
 * mode strips those — the only authoritative source for the actual
 * thresholds Tailwind generated is the `@media` query itself.
 * @param nested One nested `media` node from `rule.value.rules`.
 * @param className Outer rule's class name (carries the breakpoint prefix).
 * @param bucket Per-scheme style map for the atom.
 * @param ctx Parser-call-wide context.
 * @param ruleSchemeTables Per-scheme var tables (outer rule's merged table).
 * @param ruleLocalVars Outer rule's `--tw-*` vars (inherited for inner decls).
 */
function applyMediaRule(
  nested: unknown,
  className: string,
  bucket: Record<string, RNStyle>,
  ctx: StyleRuleContext,
  ruleSchemeTables: ReadonlyMap<string, ReadonlyMap<string, string>>,
  ruleLocalVars: ReadonlyMap<string, string>,
): void {
  const decls = collectNestedDecls(nested)
  if (decls.length === 0) return
  const minWidth = readMediaMinWidthPx(nested)
  const prefix = leadingPrefix(className)
  if (minWidth !== null && prefix !== null) ctx.breakpoints.set(prefix, minWidth)
  for (const scheme of ctx.schemes) {
    const table = ruleSchemeTables.get(scheme)
    const schemeBucket = bucket[scheme] ?? {}
    for (const decl of decls) {
      for (const [key, value] of declarationToRnEntries(decl, table)) schemeBucket[key] = value
      const animationRef = pickAnimationName(decl)
      if (animationRef) ctx.referencedKeyframes.add(animationRef)
    }
    const nestedLocalVars = new Map(ruleLocalVars)
    for (const [k, v] of collectRuleLocalVars(decls)) nestedLocalVars.set(k, v)
    applyComposedTransformToScheme(schemeBucket, nestedLocalVars)
    applyComposedShadowToScheme(schemeBucket, nestedLocalVars, table)
    bucket[scheme] = schemeBucket
  }
}

/**
 * Fold one nested rule from an interactive (`active:` / `focus:`) atom
 * into every scheme's bucket. The Tailwind output for `active:bg-sky-700`
 * is `.active\:bg-sky-700 { &:active { background-color: oklch(...) } }`
 * — the outer rule has zero
 * decls; the leaf lives three levels deep through pseudo + media. We
 * unwrap the pseudo and the media shell, take the inner decls, and
 * apply them across every scheme — interactivity is orthogonal to
 * theme. The bucket gets `__state: 'active' | 'focus'` set elsewhere.
 * @param nested One nested-rule node from `rule.value.rules`.
 * @param bucket Per-scheme style map for the atom.
 * @param ctx Parser-call-wide context.
 * @param ruleSchemeTables Per-scheme var tables (outer rule's merged table).
 * @param ruleLocalVars Outer rule's `--tw-*` vars (inherited for inner decls).
 */
function applyInteractiveNestedRule(
  nested: unknown,
  bucket: Record<string, RNStyle>,
  ctx: StyleRuleContext,
  ruleSchemeTables: ReadonlyMap<string, ReadonlyMap<string, string>>,
  ruleLocalVars: ReadonlyMap<string, string>,
): void {
  const decls = collectNestedDecls(nested)
  if (decls.length === 0) return
  for (const scheme of ctx.schemes) {
    const table = ruleSchemeTables.get(scheme)
    const schemeBucket = bucket[scheme] ?? {}
    for (const decl of decls) {
      for (const [key, value] of declarationToRnEntries(decl, table)) schemeBucket[key] = value
      const animationRef = pickAnimationName(decl)
      if (animationRef) ctx.referencedKeyframes.add(animationRef)
    }
    const nestedLocalVars = new Map(ruleLocalVars)
    for (const [k, v] of collectRuleLocalVars(decls)) nestedLocalVars.set(k, v)
    applyComposedTransformToScheme(schemeBucket, nestedLocalVars)
    applyComposedShadowToScheme(schemeBucket, nestedLocalVars, table)
    bucket[scheme] = schemeBucket
  }
}

/**
 * Recursively flatten a nested style/media rule into its leaf
 * declarations. Tailwind wraps interactive pseudo decls in `style`
 * nodes (`&:active`, `&:focus`); the walk unwraps them and any
 * `@media` shell around them.
 * @param nested A nested rule node.
 * @returns Every declaration found in the nested subtree.
 */
function collectNestedDecls(nested: unknown): readonly LcDeclaration[] {
  if (typeof nested !== 'object' || nested === null) return []
  const node = nested as { type?: string; value?: NestedStyleRule & { rules?: readonly unknown[] } }
  if (!node.value) return []
  // `style` (with `&:active`) and `media` wrappers both surface the
  // actual decls. lightningcss surfaces inner-only declarations as a
  // `nested-declarations` node — flatten that too.
  if (node.type === 'nested-declarations') return [...(node.value.declarations?.declarations ?? [])]
  if (node.type !== 'style' && node.type !== 'media') return []
  const out: LcDeclaration[] = [...(node.value.declarations?.declarations ?? [])]
  for (const child of node.value.rules ?? []) out.push(...collectNestedDecls(child))
  return out
}

/**
 * Fold one nested style rule (Tailwind's `&:where(.<scheme>, .<scheme> *)`
 * pattern) into the scheme bucket its selector targets. Rules we can't
 * attribute to a single scheme are skipped — they'd only ever reach the
 * bucket via CSS cascading in a browser, which doesn't translate to RN.
 * @param nested One nested-rule node from `rule.value.rules`.
 * @param bucket Per-scheme style map for the atom.
 * @param ctx Parser-call-wide context.
 * @param ruleSchemeTables Per-scheme var tables (outer rule's merged table).
 * @param ruleLocalVars Outer rule's `--tw-*` vars (inherited for inner decls).
 */
function applyNestedSchemeRule(
  nested: unknown,
  bucket: Record<string, RNStyle>,
  ctx: StyleRuleContext,
  ruleSchemeTables: ReadonlyMap<string, ReadonlyMap<string, string>>,
  ruleLocalVars: ReadonlyMap<string, string>,
): void {
  if (typeof nested !== 'object' || nested === null) return
  const node = nested as { type?: string; value?: NestedStyleRule }
  if (node.type !== 'style' || !node.value) return
  const targetScheme = detectNestedScheme(node.value.selectors, ctx.schemes, ctx.schemeAliases)
  if (!targetScheme) return
  const innerDecls = node.value.declarations?.declarations ?? []
  const table = ruleSchemeTables.get(targetScheme)
  const schemeBucket = bucket[targetScheme] ?? {}
  for (const decl of innerDecls) {
    for (const [key, value] of declarationToRnEntries(decl, table)) schemeBucket[key] = value
    const animationRef = pickAnimationName(decl)
    if (animationRef) ctx.referencedKeyframes.add(animationRef)
  }
  // Apply the composed-transform + shadow post-passes to just this one
  // scheme, so nested `--tw-*` custom prop writes compose correctly.
  const nestedLocalVars = new Map(ruleLocalVars)
  for (const [k, v] of collectRuleLocalVars(innerDecls)) nestedLocalVars.set(k, v)
  applyComposedTransformToScheme(schemeBucket, nestedLocalVars)
  applyComposedShadowToScheme(schemeBucket, nestedLocalVars, table)
  bucket[targetScheme] = schemeBucket
}

/**
 * Shape of a lightningcss style rule as it appears inside `rule.value.rules`.
 * Loose typing because the full type is a sprawling discriminated union
 * we only need one shape from.
 */
interface NestedStyleRule {
  selectors: readonly (readonly unknown[])[]
  declarations?: { declarations: readonly LcDeclaration[] }
}

/**
 * Detect which scheme a nested `&:where(.<scheme>, .<scheme> *)`
 * selector targets. Recognises both the rnwind-default literal class
 * (`.dark`) and any user-declared `@custom-variant` selector class
 * (`.scheme-dark`), via the `aliases` map built from the theme CSS.
 * @param selectors Nested rule's selector lists.
 * @param schemes Declared scheme names.
 * @param aliases Class-name → scheme-name map from `@custom-variant` decls.
 * @returns Matching scheme name, or null when the selector isn't scheme-scoped.
 */
function detectNestedScheme(
  selectors: readonly (readonly unknown[])[],
  schemes: readonly string[],
  aliases: ReadonlyMap<string, string>,
): string | null {
  const known = new Set(schemes)
  for (const selector of selectors) {
    const found = findSchemeInSelector(selector, schemes, known, aliases)
    if (found) return found
  }
  return null
}

/**
 * Inner half of {@link detectNestedScheme} — extracted so each function
 * stays under the cognitive-complexity cap.
 * @param selector One compound selector (sequence of simple parts).
 * @param schemes Declared scheme names (for recursion).
 * @param known Set form of `schemes` for O(1) lookups.
 * @param aliases Class-name → scheme-name map from `@custom-variant` decls.
 * @returns Matching scheme name, or null.
 */
function findSchemeInSelector(
  selector: readonly unknown[],
  schemes: readonly string[],
  known: ReadonlySet<string>,
  aliases: ReadonlyMap<string, string>,
): string | null {
  for (const part of selector) {
    const direct = matchSchemeClass(part, known, aliases)
    if (direct) return direct
    const nested = matchSchemeInWhere(part, schemes, aliases)
    if (nested) return nested
  }
  return null
}

/**
 * Match a `.scheme` class part against the declared schemes (literal
 * match) or against the `@custom-variant` alias map (e.g. `.scheme-dark`
 * → `dark`).
 * @param part One simple selector part.
 * @param known Declared scheme names.
 * @param aliases Class-name → scheme-name map from `@custom-variant` decls.
 * @returns Matching scheme name, or null.
 */
function matchSchemeClass(part: unknown, known: ReadonlySet<string>, aliases: ReadonlyMap<string, string>): string | null {
  if (typeof part !== 'object' || part === null) return null
  const node = part as { type?: string; name?: string }
  if (node.type !== 'class') return null
  if (typeof node.name !== 'string') return null
  if (known.has(node.name)) return node.name
  return aliases.get(node.name) ?? null
}

/**
 * Match a `:where(.scheme, …)` pseudo-class wrapper and recurse into
 * its inner selectors.
 * @param part One simple selector part.
 * @param schemes Declared scheme names.
 * @param aliases Class-name → scheme-name map from `@custom-variant` decls.
 * @returns Matching scheme name from inside the `where`, or null.
 */
function matchSchemeInWhere(part: unknown, schemes: readonly string[], aliases: ReadonlyMap<string, string>): string | null {
  if (typeof part !== 'object' || part === null) return null
  const node = part as { type?: string; kind?: string; selectors?: readonly (readonly unknown[])[] }
  if (node.type !== 'pseudo-class' || node.kind !== 'where' || !node.selectors) return null
  return detectNestedScheme(node.selectors, schemes, aliases)
}

/**
 * Per-scheme version of `applyComposedTransform` — synthesize a
 * `transform` array into a SINGLE scheme's style from its rule-local
 * `--tw-*` vars.
 * @param style Scheme-specific style map.
 * @param ruleLocalVars Combined outer+nested `--tw-*` vars.
 */
function applyComposedTransformToScheme(style: RNStyle, ruleLocalVars: ReadonlyMap<string, string>): void {
  const composed = composeTransformFromVars(ruleLocalVars)
  if (composed.length === 0) return
  delete style.translate
  delete style.scale
  delete style.rotate
  style.transform = composed
}

/**
 * Per-scheme version of `applyComposedShadow` — synthesize RN shadow
 * longhands into a SINGLE scheme's style from its `--tw-shadow` custom
 * prop.
 * @param style Scheme-specific style map.
 * @param ruleLocalVars Combined outer+nested `--tw-*` vars.
 * @param table Per-scheme var table for resolving `var(--color-x)` in colors.
 */
function applyComposedShadowToScheme(
  style: RNStyle,
  ruleLocalVars: ReadonlyMap<string, string>,
  table?: ReadonlyMap<string, string>,
): void {
  const rawShadow = ruleLocalVars.get('--tw-shadow')
  const rawShadowColor = ruleLocalVars.get('--tw-shadow-color')
  if (!rawShadow && rawShadowColor) {
    const color = resolveCustomColorString(rawShadowColor, table)
    if (!color) return
    delete style.boxShadow
    style.shadowColor = color
    return
  }
  if (!rawShadow) return
  const shadow = parseFirstShadow(rawShadow)
  if (!shadow) return
  delete style.boxShadow
  style.shadowColor = shadow.color
  style.shadowOffset = { width: shadow.x, height: shadow.y }
  style.shadowOpacity = shadow.opacity
  style.shadowRadius = shadow.blur
  style.elevation = Math.max(1, Math.min(24, Math.round(Math.max(shadow.y, shadow.blur / 2))))
}

/**
 * Tailwind v4's `shadow-*` utilities write a `--tw-shadow` custom prop
 * holding the actual `<x> <y> <blur> <spread> <color>` shadow values,
 * then a `box-shadow: var(--tw-shadow)` declaration RN can't use. This
 * post-pass parses `--tw-shadow` and emits the RN shadow longhands —
 * `shadowColor` / `shadowOffset` / `shadowOpacity` / `shadowRadius` /
 * `elevation` — so iOS and Android both render the shadow.
 * @param bucket Per-scheme style map for the atom.
 * @param schemes Scheme names active for this parse.
 * @param ruleLocalVars Rule-local `--tw-*` vars.
 * @param schemeTables Per-scheme var tables for resolving `var(--color-x)`.
 */
function applyComposedShadow(
  bucket: Record<string, RNStyle>,
  schemes: readonly string[],
  ruleLocalVars: ReadonlyMap<string, string>,
  schemeTables: ReadonlyMap<string, ReadonlyMap<string, string>>,
): void {
  const rawShadow = ruleLocalVars.get('--tw-shadow')
  const rawShadowColor = ruleLocalVars.get('--tw-shadow-color')
  // Color-only utility (`shadow-red-50`, `shadow-gray-200`, …): emit
  // `shadowColor` + `shadowOpacity: 1` so the explicit color overrides
  // the size utility's 0.1 alpha fallback (matches Tailwind v4 web,
  // where setting `--tw-shadow-color` swaps in a solid color). Offset /
  // blur / elevation come from the partner size utility's atom.
  if (!rawShadow && rawShadowColor) {
    for (const scheme of schemes) {
      // Resolve per scheme — a custom token may differ between light/dark.
      const color = resolveCustomColorString(rawShadowColor, schemeTables.get(scheme))
      if (!color) continue
      const style = bucket[scheme] ?? {}
      delete style.boxShadow
      style.shadowColor = color
      bucket[scheme] = style
    }
    return
  }
  if (!rawShadow) return
  const shadow = parseFirstShadow(rawShadow)
  if (!shadow) return
  for (const scheme of schemes) {
    const style = bucket[scheme] ?? {}
    delete style.boxShadow
    style.shadowColor = shadow.color
    style.shadowOffset = { width: shadow.x, height: shadow.y }
    style.shadowOpacity = shadow.opacity
    style.shadowRadius = shadow.blur
    style.elevation = Math.max(1, Math.min(24, Math.round(Math.max(shadow.y, shadow.blur / 2))))
    bucket[scheme] = style
  }
}

/**
 * Synthesize RN ring styles from Tailwind's `--tw-ring-color` /
 * `--tw-ring-shadow` composable custom props. RN has no native ring;
 * we approximate by writing `borderColor` + `borderWidth` so the
 * outline is visible. Atoms that ALREADY set borderColor (e.g. paired
 * with `border-2`) keep their value — the ring just won't override.
 * @param bucket Per-scheme style map for the atom.
 * @param schemes Scheme names active for this parse.
 * @param ruleLocalVars Rule-local `--tw-*` vars.
 * @param schemeTables Per-scheme var tables for resolving `var(--color-x)`.
 */
function applyComposedRing(
  bucket: Record<string, RNStyle>,
  schemes: readonly string[],
  ruleLocalVars: ReadonlyMap<string, string>,
  schemeTables: ReadonlyMap<string, ReadonlyMap<string, string>>,
): void {
  const ringColor = ruleLocalVars.get('--tw-ring-color')
  if (!ringColor) return
  for (const scheme of schemes) {
    // Resolve per scheme — a custom token may differ between light/dark.
    const color = resolveCustomColorString(ringColor, schemeTables.get(scheme))
    if (!color) continue
    const style = bucket[scheme] ?? {}
    if (!('borderColor' in style)) style.borderColor = color
    bucket[scheme] = style
  }
}

/**
 * Tailwind composable shadow/inset-shadow alpha defaults. Their `100%` lives
 * in an `@property` initial-value (not the rule's local vars), so after the
 * `@supports` color-mix is unwrapped, `var(--tw-shadow-alpha)` is left dangling
 * and the shadow color fails to resolve. Seed the default; a `/<opacity>`
 * modifier still wins because the in-rule table value overrides it.
 */
const COMPOSABLE_ALPHA_DEFAULTS: ReadonlyMap<string, string> = new Map([
  ['--tw-shadow-alpha', '100%'],
  ['--tw-inset-shadow-alpha', '100%'],
])

/**
 * Resolve a CSS color string (`oklch(0.971 0.013 17.38)`, `#ff0000`,
 * `rgb(0 0 0 / 0.1)`) to the hex string RN's `shadowColor` accepts.
 * Wraps culori's parser via {@link parseCssColorToHex}.
 *
 * Custom `@theme` color tokens arrive as `var(--color-x)` (only the default
 * palette is `theme(inline)`-d), so `table` is substituted FIRST — without it
 * `shadow-<token>` / `ring-<token>` silently drop the color (culori can't
 * parse a bare `var()`). The table is per-scheme so a token that differs
 * between light/dark resolves to the right value for each.
 * @param raw Raw color text from a `--tw-shadow-color` / `--tw-ring-color` prop.
 * @param table Per-scheme var table for resolving `var(--color-x)` references.
 * @returns `#rrggbb` string, or null when culori can't parse it.
 */
function resolveCustomColorString(raw: string, table?: ReadonlyMap<string, string>): string | null {
  const seeded = new Map([...COMPOSABLE_ALPHA_DEFAULTS, ...(table ?? [])])
  const substituted = substituteThemeVars(raw, seeded)
  // `coerceUnparsedValue` collapses Tailwind's opacity shape
  // `color-mix(in oklab, <color> <pct>%, transparent)` (emitted by
  // `shadow-<token>` / `ring-<token>`) to a flat rgba/hex and unwraps
  // `var(…, fallback)`. Modern spaces (`oklch(…)`) then lower via
  // `normalizeColorString`; anything still un-RN-safe falls to culori.
  const coerced = coerceUnparsedValue(unwrapVariableFallback(substituted).trim())
  if (typeof coerced !== 'string' || coerced.length === 0 || coerced.startsWith('var(')) return null
  if (coerced.startsWith('#') || coerced.startsWith('rgb') || coerced.startsWith('hsl')) return coerced
  return normalizeColorString(coerced) ?? parseCssColorToHex(coerced)
}

/**
 * Parse any CSS color expression into an `#rrggbb` string via culori.
 * Falls back to null when culori doesn't recognize the format.
 * @param text CSS color value.
 * @returns Hex string, or null.
 */
function parseCssColorToHex(text: string): string | null {
  return formatHexSafe(text)
}

/**
 * Format a CSS color via culori.
 * @param text CSS color value.
 * @returns `#rrggbb` string when culori succeeds, else null.
 */
function formatHexSafe(text: string): string | null {
  try {
    const hex = culoriFormatHex(text)
    return typeof hex === 'string' ? hex : null
  } catch {
    return null
  }
}

interface ParsedShadow {
  x: number
  y: number
  blur: number
  spread: number
  color: string
  opacity: number
}

/**
 * Parse the first shadow from a `--tw-shadow` custom-property value.
 * The value is a comma-separated list of shadows; each shadow is
 * `<x> <y> <blur> <spread> <color>`. RN renders only one shadow per
 * view, so we keep the first.
 * @param raw Raw `--tw-shadow` text (post-substitution).
 * @returns Parsed shadow, or null when the shape is unrecognized.
 */
function parseFirstShadow(raw: string): ParsedShadow | null {
  // Split on top-level commas (parens-aware) so colors like `rgba(0,0,0,0.5)`
  // don't fragment the list.
  const head = topLevelSplit(raw, ',')[0]?.trim()
  if (!head) return null
  const { lengths, remainder } = extractShadowLengths(head)
  const [x = 0, y = 0, blur = 0, spread = 0] = lengths
  const { color, opacity } = parseShadowColor(remainder.trim())
  return { x, y, blur, spread, color, opacity }
}

/**
 * Pull the first 4 numeric tokens out of a shadow expression and return
 * them alongside the remaining text (which is the color expression).
 * Shadow shape: `<x> <y> <blur> <spread> <color>` — tokens may be bare
 * (`0`), px-dimensioned (`1px`), or rem/em/%.
 * @param head Single shadow expression (one comma-separated entry).
 * @returns Pixel lengths + the remainder text (color expression).
 */
function extractShadowLengths(head: string): { lengths: number[]; remainder: string } {
  // Take ONLY the leading run of length tokens, stopping at the first
  // non-length token (the color). A previous global digit-regex scanned
  // the whole string, so a <4-length shadow like `0 1px 1px rgb(0 0 0 /
  // 0.05)` stole a digit out of the color expression — corrupting the
  // alpha (opacity) or a digit-leading hex. Whitespace-splitting can't
  // reach inside the color because we break as soon as a token isn't a
  // bare/`px`/`rem`/`em`/`%` length.
  // Unambiguous integer-or-decimal (no `\d*\.?\d+` overlap) so there's no
  // super-linear backtracking on long digit runs.
  const isLength = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%)?$/
  const parts = head.split(/\s+/)
  const lengths: number[] = []
  let index = 0
  while (index < parts.length && lengths.length < 4 && isLength.test(parts[index]!)) {
    lengths.push(parseLengthToken(parts[index]!))
    index += 1
  }
  return { lengths, remainder: parts.slice(index).join(' ') }
}

/**
 * Coerce one shadow length token into a pixel number. Accepts bare
 * integers (`0`), `Npx`, and `Nrem` — every shape Tailwind's
 * `--tw-shadow` value uses.
 * @param token Token text.
 * @returns Pixel number.
 */
function parseLengthToken(token: string): number {
  if (token.endsWith('rem')) return Number(token.slice(0, -3)) * 16
  if (token.endsWith('em')) return Number(token.slice(0, -2)) * 16
  if (token.endsWith('px')) return Number(token.slice(0, -2))
  if (token.endsWith('%')) return Number(token.slice(0, -1))
  return Number(token)
}

/**
 * Extract a color string + extracted alpha from a shadow's color
 * expression. Supports `rgb(...)` / `rgba(...)` / `#rrggbb` / hex with
 * alpha / theme-resolved CSS color strings.
 * @param expr Color expression text.
 * @returns Color string for `shadowColor` + alpha for `shadowOpacity`.
 */
function parseShadowColor(expr: string): { color: string; opacity: number } {
  const working = unwrapVariableFallback(expr).trim()
  if (working.length === 0) return { color: '#000', opacity: 0.1 }
  const rgba = parseRgbaExpression(working)
  if (rgba) return rgba
  if (working.startsWith('#')) return { color: working, opacity: 1 }
  // Named (`red`) / modern (`hsl(…)`, `oklch(…)`) colors — culori → sRGB hex.
  // Without this they fell to the default black at 0.1 alpha, silently losing
  // the user's `shadow-[0_2px_4px_red]` color.
  const hex = formatHexSafe(working)
  if (hex) return { color: hex, opacity: 1 }
  return { color: '#000', opacity: 0.1 }
}

/**
 * Strip the `var(--name, fallback)` wrapper from a CSS value. Tailwind
 * wraps shadow colors as `var(--tw-shadow-color, rgb(0 0 0 / 0.1))`,
 * and when the var is unresolved we want the fallback.
 * @param expr Raw CSS value.
 * @returns Inner fallback when wrapped, otherwise the input unchanged.
 */
function unwrapVariableFallback(expr: string): string {
  const trimmed = expr.trim()
  if (!trimmed.startsWith('var(') || !trimmed.endsWith(')')) return trimmed
  const inner = trimmed.slice(4, -1)
  let depth = 0
  for (let index = 0; index < inner.length; index += 1) {
    const ch = inner[index]
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ',' && depth === 0) return inner.slice(index + 1)
  }
  return trimmed
}

/**
 * Parse an `rgb(r g b)` / `rgba(r,g,b,a)` / `rgb(r g b / a)` color
 * expression into a hex + alpha pair. Returns `null` when the shape
 * doesn't match.
 * @param text Expression text (already trimmed and unwrapped).
 * @returns Hex color + alpha, or null.
 */
function parseRgbaExpression(text: string): { color: string; opacity: number } | null {
  const head = /^rgba?\(([^)]+)\)$/i.exec(text)
  if (!head) return null
  const inner = head[1]!.replaceAll(',', ' ').replaceAll('/', ' ')
  const tokens = inner.split(/\s+/).filter((part) => part.length > 0)
  if (tokens.length < 3) return null
  const [r, g, b, alphaText] = tokens
  let opacity = 1
  if (typeof alphaText === 'string') {
    opacity = alphaText.endsWith('%') ? Number(alphaText.slice(0, -1)) / 100 : Number(alphaText)
  }
  // CSS Color 4: a `none` (or otherwise non-numeric) alpha parses to NaN here.
  // Its used value when compositing is 0 (fully transparent) — and crucially
  // RN throws on a NaN `shadowOpacity`, so collapse any non-finite alpha to 0
  // before it can reach a numeric style prop.
  if (!Number.isFinite(opacity)) opacity = 0
  const hex = `#${[r!, g!, b!]
    .map((n) =>
      Math.max(0, Math.min(255, Math.round(Number(n))))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
  return { color: hex, opacity }
}

/**
 * Split `text` at top-level occurrences of `delimiter`, treating
 * parentheses as nesting. Used to safely split shadow lists without
 * fragmenting `rgb(0, 0, 0, 0.5)` on its commas.
 * @param text Source text.
 * @param delimiter Single-character delimiter to split on.
 * @returns Parts of the text between top-level delimiters.
 */
function topLevelSplit(text: string, delimiter: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === delimiter && depth === 0) {
      parts.push(text.slice(start, index))
      start = index + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/**
 * Tailwind v4's `text-*` utilities emit `line-height` as a unitless
 * multiplier (`calc(2.5 / 2.25)` for `text-4xl`) that the browser
 * resolves against the element's `font-size`. RN's `lineHeight` is
 * always pixels — so when both `fontSize` and a multiplier-shaped
 * `lineHeight` (less than 10) land on the same atom, multiply through
 * to a pixel value. Atoms with only one of the two are left alone.
 * @param bucket Per-scheme style map for the atom.
 * @param schemes Scheme names active for this parse.
 */
function normalizeLineHeightToPx(bucket: Record<string, RNStyle>, schemes: readonly string[]): void {
  for (const scheme of schemes) {
    const style = bucket[scheme]
    if (!style) continue
    const { fontSize } = style
    const { lineHeight } = style
    if (typeof fontSize !== 'number' || typeof lineHeight !== 'number') continue
    if (lineHeight >= 10) continue
    style.lineHeight = Math.round(fontSize * lineHeight * 10_000) / 10_000
  }
}

/**
 * Fold one declaration's resolved entries into every scheme's bucket on
 * the target atom.
 * @param decl Lightningcss declaration to convert.
 * @param bucket Per-scheme style map for the atom.
 * @param schemes Scheme names active for this parse.
 * @param ruleSchemeTables Per-scheme var tables (with rule-local overrides folded in).
 */
function applyDeclarationToBucket(
  decl: LcDeclaration,
  bucket: Record<string, RNStyle>,
  schemes: readonly string[],
  ruleSchemeTables: ReadonlyMap<string, ReadonlyMap<string, string>>,
): void {
  for (const scheme of schemes) {
    const schemeBucket = bucket[scheme] ?? {}
    for (const [key, value] of declarationToRnEntries(decl, ruleSchemeTables.get(scheme))) {
      schemeBucket[key] = value
    }
    bucket[scheme] = schemeBucket
  }
}

/**
 * Apply the composed-transform post-pass for a single atom: if any of
 * Tailwind's `--tw-translate-*` / `--tw-scale-*` / `--tw-skew-*` vars
 * were written, synthesize a single `transform` array and drop the
 * intermediate `translate`/`scale`/`rotate` shorthand entries.
 * @param bucket Per-scheme style map for the atom.
 * @param schemes Scheme names active for this parse.
 * @param ruleLocalVars Rule-local `--tw-*` vars.
 */
function applyComposedTransform(
  bucket: Record<string, RNStyle>,
  schemes: readonly string[],
  ruleLocalVars: ReadonlyMap<string, string>,
): void {
  const composed = composeTransformFromVars(ruleLocalVars)
  if (composed.length === 0) return
  for (const scheme of schemes) {
    const schemeBucket = bucket[scheme] ?? {}
    delete schemeBucket.translate
    delete schemeBucket.scale
    delete schemeBucket.rotate
    schemeBucket.transform = composed
    bucket[scheme] = schemeBucket
  }
}

/**
 * Synthesize an RN `transform` array from Tailwind v4's composable
 * `--tw-translate-x/y`, `--tw-scale-x/y`, `--tw-skew-x/y`, and
 * `--tw-rotate-x/y/z` custom properties. Returns an empty array when
 * none of those props were written, letting the caller skip the
 * post-pass.
 * @param ruleVars Rule-local `--tw-*` vars collected from the style rule.
 * @returns RN transform operations (possibly empty).
 */
function composeTransformFromVars(ruleVars: ReadonlyMap<string, string>): readonly Record<string, string | number>[] {
  const ops: Record<string, string | number>[] = []
  addAxisOp(ops, 'translateX', ruleVars.get('--tw-translate-x'), resolveLengthExpression)
  addAxisOp(ops, 'translateY', ruleVars.get('--tw-translate-y'), resolveLengthExpression)
  addAxisOp(ops, 'scaleX', ruleVars.get('--tw-scale-x'), resolveNumberOrPercent)
  addAxisOp(ops, 'scaleY', ruleVars.get('--tw-scale-y'), resolveNumberOrPercent)
  addAxisOp(ops, 'skewX', ruleVars.get('--tw-skew-x'), extractAngleFromSkewFunction)
  addAxisOp(ops, 'skewY', ruleVars.get('--tw-skew-y'), extractAngleFromSkewFunction)
  return ops
}

/**
 * Push `{<key>: resolved(raw)}` into `ops` when `raw` is present and the
 * resolver returns non-null. Keeps {@link composeTransformFromVars}
 * below the cognitive complexity threshold.
 * @param ops Target array to mutate.
 * @param key RN transform op key (e.g. `'translateX'`).
 * @param raw Rule-local var value (possibly undefined).
 * @param resolve Value-resolver for this axis type.
 */
function addAxisOp<T extends string | number>(
  ops: Record<string, string | number>[],
  key: string,
  raw: string | undefined,
  resolve: (text: string) => T | null,
): void {
  if (!raw) return
  const value = resolve(raw)
  if (value !== null) ops.push({ [key]: value })
}

/**
 * Resolve a CSS length expression into the value a RN transform op
 * accepts — pixels as a number, or a percentage string preserved
 * verbatim. Supports the shapes Tailwind v4 emits into `--tw-translate-*`:
 *
 *  - Direct lengths: `16px`, `1rem`, bare `42`.
 *  - Percentages: `100%`, `-100%`.
 *  - Flat calc: `calc(0.25rem * 52)`.
 *  - Fractional calc: `calc(1 / 2 * 100%)` (→ `translate-x-1/2`).
 *  - Nested calc with sign flip: `calc(calc(1 / 3 * 100%) * -1)` (→ `-translate-x-1/3`).
 *
 * Returns null when the expression mixes units (`calc(100% - 10px)` —
 * RN can't express those) or contains a token the evaluator can't
 * interpret; the transform op is simply skipped in that case.
 * @param text Length expression text.
 * @returns Pixel number, percentage string, or null when unrepresentable.
 */
function resolveLengthExpression(text: string): number | string | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  const evaluated = evaluateLengthExpr(trimmed)
  if (!evaluated) return null
  if (evaluated.unit === '%') return `${stripTrailingZeros(evaluated.value)}%`
  if (evaluated.unit === 'rem') return roundTransformValue(evaluated.value * 16)
  return roundTransformValue(evaluated.value)
}

/** Evaluated length + its unit. `''` means px or bare number. */
interface EvaluatedLength {
  value: number
  unit: '%' | 'rem' | ''
}

/**
 * Evaluate a CSS length expression to a `{value, unit}` pair.
 *
 * Strategy: detect the (at most one) unit suffix present in the text,
 * strip every `calc(` to `(`, strip the unit suffix from numeric tokens,
 * and run a small arithmetic evaluator. Mixed-unit expressions are
 * rejected because RN has no way to express `calc(100% - 10px)` in a
 * flat transform op.
 * @param text Raw CSS length expression (already trimmed).
 * @returns Evaluated length with its unit, or `null` when invalid.
 */
function evaluateLengthExpr(text: string): EvaluatedLength | null {
  const units = detectUnits(text)
  if (units.length > 1) return null
  const unit = (units[0] ?? '') as EvaluatedLength['unit']
  const arithmetic = stripCalcAndUnits(text)
  const value = evaluateArithmetic(arithmetic)
  if (value === null || !Number.isFinite(value)) return null
  return { value, unit }
}

/**
 * Detect which length units appear in the expression. Multi-unit
 * expressions (e.g. `calc(100% - 1rem)`) aren't representable in one RN
 * transform op, so we reject them.
 * @param text Length expression.
 * @returns Sorted, deduped unit list found in the text.
 */
function detectUnits(text: string): readonly string[] {
  const found = new Set<string>()
  if (/\d%/.test(text)) found.add('%')
  if (/[\d.]rem\b/.test(text)) found.add('rem')
  if (/[\d.]px\b/.test(text)) found.add('px')
  return [...found]
}

/**
 * Strip every `calc(` wrapper to a plain `(`, and strip `%` / `rem` /
 * `px` unit suffixes from numeric tokens. Result is a plain arithmetic
 * expression the evaluator can consume.
 * @param text Length expression.
 * @returns Arithmetic text suitable for {@link evaluateArithmetic}.
 */
function stripCalcAndUnits(text: string): string {
  // Input is Tailwind's compiled CSS, not user-controlled — no ReDoS risk.
  // eslint-disable-next-line sonarjs/slow-regex
  return text.replaceAll(/\bcalc\s*\(/g, '(').replaceAll(/([\d.]+)(?:rem|px|%)/g, '$1')
}

/**
 * Format a percentage number so `50` stays `"50%"` (not `"50.00000001%"`)
 * when float drift is in the low bits. Strips trailing-zero decimals.
 * @param value Percentage magnitude.
 * @returns Integer-ish string.
 */
function stripTrailingZeros(value: number): string {
  const rounded = Math.round(value * 1_000_000) / 1_000_000
  return String(rounded)
}

/**
 * Tiny recursive-descent evaluator for CSS arithmetic. Accepts `+`, `-`,
 * `*`, `/`, parens, and decimal numbers. Returns `null` on malformed
 * input — rejects anything the tokenizer can't classify.
 * @param text Arithmetic text (post {@link stripCalcAndUnits}).
 * @returns Evaluated number, or `null`.
 */
function evaluateArithmetic(text: string): number | null {
  const tokens = tokenizeArithmetic(text)
  if (!tokens) return null
  const cursor = { index: 0 }
  const result = parseArithmeticExpr(tokens, cursor)
  if (cursor.index !== tokens.length) return null
  return result
}

/**
 * Split arithmetic text into numeric and operator tokens. Returns null
 * when the text contains any character outside the allowed set.
 * @param text Arithmetic text.
 * @returns Token list, or null on unexpected character.
 */
function tokenizeArithmetic(text: string): readonly string[] | null {
  const tokens: string[] = []
  let index = 0
  while (index < text.length) {
    const ch = text[index]!
    if (isArithmeticWhitespace(ch)) {
      index += 1
    } else if (isArithmeticOperator(ch)) {
      tokens.push(ch)
      index += 1
    } else if (isDigitOrDot(ch)) {
      const next = consumeNumber(text, index)
      tokens.push(text.slice(index, next))
      index = next
    } else {
      return null
    }
  }
  return tokens
}

/**
 * Check whether `ch` is a whitespace character the arithmetic tokenizer
 * may skip.
 * @param ch Single-character string.
 * @returns True for space / tab / newline.
 */
function isArithmeticWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n'
}

/**
 * Check whether `ch` is one of the arithmetic operator tokens.
 * @param ch Single-character string.
 * @returns True for `(`, `)`, `+`, `-`, `*`, `/`.
 */
function isArithmeticOperator(ch: string): boolean {
  return ch === '(' || ch === ')' || ch === '+' || ch === '-' || ch === '*' || ch === '/'
}

/**
 * Check whether `ch` belongs to a numeric token.
 * @param ch Single-character string.
 * @returns True for a digit `0`–`9` or `.`.
 */
function isDigitOrDot(ch: string): boolean {
  return (ch >= '0' && ch <= '9') || ch === '.'
}

/**
 * Advance past a numeric token starting at `start`.
 * @param text Source text.
 * @param start Index of the first digit or dot.
 * @returns Index just past the last digit-or-dot.
 */
function consumeNumber(text: string, start: number): number {
  let index = start
  while (index < text.length && isDigitOrDot(text[index]!)) index += 1
  return index
}

/**
 * Parse an additive expression: `term (('+'|'-') term)*`.
 * @param tokens Token list.
 * @param cursor Mutable cursor.
 * @param cursor.index Current token index; advanced past consumed tokens.
 * @returns Evaluated number, or `null` on parse failure.
 */
function parseArithmeticExpr(tokens: readonly string[], cursor: { index: number }): number | null {
  let left = parseArithmeticTerm(tokens, cursor)
  if (left === null) return null
  while (cursor.index < tokens.length) {
    const op = tokens[cursor.index]
    if (op !== '+' && op !== '-') break
    cursor.index += 1
    const right = parseArithmeticTerm(tokens, cursor)
    if (right === null) return null
    left = op === '+' ? left + right : left - right
  }
  return left
}

/**
 * Parse a multiplicative expression: `factor (('*'|'/') factor)*`.
 * @param tokens Token list.
 * @param cursor Mutable cursor.
 * @param cursor.index Current token index; advanced past consumed tokens.
 * @returns Evaluated number, or `null`.
 */
function parseArithmeticTerm(tokens: readonly string[], cursor: { index: number }): number | null {
  let left = parseArithmeticFactor(tokens, cursor)
  if (left === null) return null
  while (cursor.index < tokens.length) {
    const op = tokens[cursor.index]
    if (op !== '*' && op !== '/') break
    cursor.index += 1
    const right = parseArithmeticFactor(tokens, cursor)
    if (right === null) return null
    left = op === '*' ? left * right : left / right
  }
  return left
}

/**
 * Parse a factor: unary minus, parenthesised expression, or number.
 * @param tokens Token list.
 * @param cursor Mutable cursor.
 * @param cursor.index Current token index; advanced past consumed tokens.
 * @returns Evaluated number, or `null`.
 */
function parseArithmeticFactor(tokens: readonly string[], cursor: { index: number }): number | null {
  if (cursor.index >= tokens.length) return null
  const tok = tokens[cursor.index]!
  if (tok === '-') {
    cursor.index += 1
    const right = parseArithmeticFactor(tokens, cursor)
    return right === null ? null : -right
  }
  if (tok === '+') {
    cursor.index += 1
    return parseArithmeticFactor(tokens, cursor)
  }
  if (tok === '(') {
    cursor.index += 1
    const inner = parseArithmeticExpr(tokens, cursor)
    if (cursor.index >= tokens.length || tokens[cursor.index] !== ')') return null
    cursor.index += 1
    return inner
  }
  const number_ = Number(tok)
  if (!Number.isFinite(number_)) return null
  cursor.index += 1
  return number_
}

/**
 * Resolve a scale factor expressed as a percentage (`150%`), number (`1.5`),
 * or a `calc()` expression. Tailwind emits NEGATIVE scale utilities as a calc
 * (`-scale-x-100` → `calc(100% * -1)`), so a plain percent/number regex
 * silently dropped them — `-scale-*` (the horizontal-flip idiom) rendered
 * nothing. Fall back to the shared arithmetic evaluator, reading `%` as a
 * fraction (`100%` → 1) and rounding off f32 noise.
 * @param text Raw value.
 * @returns Scale number (e.g. 1.5 for 150%, -1 for `calc(100% * -1)`), or null.
 */
function resolveNumberOrPercent(text: string): number | null {
  const trimmed = text.trim()
  const percent = /^(-?\d+(?:\.\d+)?)%$/.exec(trimmed)
  if (percent) return roundTransformValue(Number(percent[1]) / 100)
  const bare = /^-?\d+(?:\.\d+)?$/.exec(trimmed)
  if (bare) return roundTransformValue(Number(trimmed))
  const evaluated = evaluateLengthExpr(trimmed)
  if (!evaluated || evaluated.unit === 'rem') return null
  return roundTransformValue(evaluated.unit === '%' ? evaluated.value / 100 : evaluated.value)
}

/**
 * Round a composed-transform numeric value to 4 decimals. lightningcss
 * serializes arbitrary literals (`scale-x-[0.333]`) back as noisy f32 text
 * (`0.3330000042915344`), and the resolvers `Number()` that verbatim — round
 * so the RN `transform` array stays clean.
 * @param value Raw number.
 * @returns Rounded number.
 */
function roundTransformValue(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/**
 * Extract the angle from Tailwind's `skewX(12deg)` / `skewY(-5deg)` /
 * `skewX(calc(6deg * -1))` custom-property value shape. Returns null
 * when the inner expression doesn't reduce to a degree value.
 *
 * Tailwind v4 emits negative skew utilities as a nested `calc()`
 * (`-skew-x-6` → `skewX(calc(6deg * -1))`), so the inner body has to be
 * evaluated as arithmetic — a bare-angle regex silently drops those.
 * @param text Raw value.
 * @returns `<N>deg` string, or null.
 */
function extractAngleFromSkewFunction(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed.endsWith(')')) return null
  const openIdx = trimmed.indexOf('(')
  if (openIdx < 5) return null
  const head = trimmed.slice(0, openIdx)
  if (head !== 'skewX' && head !== 'skewY') return null
  const inner = trimmed.slice(openIdx + 1, -1).trim()
  return resolveAngleExpression(inner)
}

/**
 * Evaluate an expression whose single unit is `deg`. Strips `calc(`
 * wrappers and `deg` suffixes, runs the arithmetic evaluator, reapplies
 * `deg`. Returns null for unit mismatches or unparseable text.
 * @param text Angle expression (e.g. `6deg`, `calc(6deg * -1)`).
 * @returns `<N>deg`, or null when not representable.
 */
function resolveAngleExpression(text: string): string | null {
  if (!/[\d.]deg\b/.test(text)) return null
  // Input is Tailwind's compiled CSS, not user-controlled — no ReDoS risk.
  // eslint-disable-next-line sonarjs/slow-regex
  const arithmetic = text.replaceAll(/\bcalc\s*\(/g, '(').replaceAll(/([\d.]+)deg/g, '$1')
  const value = evaluateArithmetic(arithmetic)
  if (value === null || !Number.isFinite(value)) return null
  return `${stripTrailingZeros(value)}deg`
}

/**
 * Scan Tailwind's compiled CSS for `:root, :host { --x: y; … }` blocks
 * and pull the custom-property declarations out. This captures every
 * theme token Tailwind resolved — including tokens imported from the
 * user's secondary `@import` files (e.g. `rnwind/css`'s
 * `--duration-normal: 220ms`) — without rnwind having to re-implement
 * `@import` resolution.
 *
 * Regex-free scanner: finds `:root` prefixes, walks forward with
 * brace-depth tracking to find the matching block close, then extracts
 * every `--name: value;` pair with a paren-balanced walker so commas
 * inside `rgb(0, 0, 0)` don't confuse the split.
 * @param css Tailwind's compiled CSS.
 * @returns Map of custom-property name → resolved value.
 */
/**
 * Strip `\@supports (color: color-mix(in lab, red, red)) { … }` wrappers
 * from Tailwind v4's compiled CSS, hoisting their inner declarations up
 * to the parent rule.
 *
 * Tailwind emits opacity-suffixed themed colors with both a pre-resolved
 * sRGB fallback AND a var()-based override gated behind the color-mix
 * `\@supports` clause. The OUTER fallback hard-codes a single scheme's
 * value of the theme token; the inner override is var()-based and
 * substitutes correctly per scheme. By unwrapping the gate, the inner
 * declaration becomes a sibling of the fallback in the same rule body —
 * lightningcss takes the LATER one (the var()-based unparsed form), and
 * the parser's themeVars-aware path produces correct rgba per scheme.
 * Modern RN-targeted browsers all support color-mix anyway, so dropping
 * the gating is safe.
 * @param css Tailwind-compiled CSS.
 * @returns CSS with the color-mix support gates unwrapped.
 */
function unwrapColorMixSupports(css: string): string {
  const guard = '@supports (color: color-mix(in lab, red, red))'
  let out = ''
  let cursor = 0
  while (cursor < css.length) {
    const head = css.indexOf(guard, cursor)
    if (head === -1) {
      out += css.slice(cursor)
      break
    }
    out += css.slice(cursor, head)
    const brace = css.indexOf('{', head)
    if (brace === -1) {
      out += css.slice(head)
      break
    }
    const blockEnd = findMatchingClose(css, brace + 1)
    if (blockEnd === -1) {
      out += css.slice(head)
      break
    }
    const inner = css.slice(brace + 1, blockEnd)
    // Only unwrap when the gated declaration substitutes a USER theme
    // token (`var(--color-…)`). Tailwind also gates `--tw-*` internal
    // composers (shadow color, ring color, …) on the same supports
    // clause; their outer fallback is the optimized hex/oklch value
    // the parser's own composed-prop pass needs (`applyComposedShadow`
    // reads `--tw-shadow-color` from the rule's local vars). Unwrapping
    // them would replace the resolvable color with an unresolvable
    // `color-mix(... var(--tw-shadow-alpha), transparent)` text and
    // break the composed-shadow path.
    // Keep the gate intact for non-themed colors — the outer fallback
    // wins, which is what Tailwind intended.
    out += inner.includes('var(--color-') ? inner : css.slice(head, blockEnd + 1)
    cursor = blockEnd + 1
  }
  return out
}

/**
 * Extract every `--name: value` declaration from the `:root` blocks in
 * Tailwind's compiled CSS into a flat map.
 * @param css Tailwind-compiled CSS.
 * @returns Map of custom-property name → resolved value.
 */
function extractRootCustomProperties(css: string): Map<string, string> {
  const out = new Map<string, string>()
  let cursor = 0
  while (cursor < css.length) {
    const blockEnd = consumeNextRootBlock(css, cursor, out)
    if (blockEnd === -1) break
    cursor = blockEnd + 1
  }
  return out
}

/**
 * Locate the next `:root` block from `cursor`, extract its custom
 * properties into `out`, and return the index of its closing brace.
 * Split out from {@link extractRootCustomProperties} to keep complexity
 * below the cap.
 * @param css Source CSS.
 * @param cursor Start index for the search.
 * @param out Destination map, mutated.
 * @returns Index of the closing brace, or -1 when no block remains.
 */
function consumeNextRootBlock(css: string, cursor: number, out: Map<string, string>): number {
  const head = css.indexOf(':root', cursor)
  if (head === -1) return -1
  const brace = css.indexOf('{', head)
  if (brace === -1) return -1
  const blockEnd = findMatchingClose(css, brace + 1)
  if (blockEnd === -1) return -1
  collectCustomDeclarations(css.slice(brace + 1, blockEnd), out)
  return blockEnd
}

/**
 * Parse the body of a `:root` block — a `;`-separated list of `--name:
 * value` declarations — into the output map. Top-level `;` split is
 * paren-aware so `rgb(0, 0, 0)` doesn't fragment the list.
 * @param body Block body text (between braces).
 * @param out Destination map, mutated.
 */
function collectCustomDeclarations(body: string, out: Map<string, string>): void {
  for (const declaration of topLevelSplit(body, ';')) {
    const colon = declaration.indexOf(':')
    if (colon === -1) continue
    const name = declaration.slice(0, colon).trim()
    const value = declaration.slice(colon + 1).trim()
    if (name.startsWith('--') && value.length > 0) out.set(name, value)
  }
}

/**
 * Walk forward from `start` tracking brace depth; return the index of
 * the matching `}` for the opener just before `start`.
 * @param source Source text.
 * @param start Index just past the opening `{`.
 * @returns Index of matching `}`, or `-1` on imbalance.
 */
function findMatchingClose(source: string, start: number): number {
  let depth = 1
  for (let index = start; index < source.length; index += 1) {
    const ch = source[index]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

/**
 * Merge rule-local custom vars into every scheme's var table. Creates
 * fresh maps so the rule pass doesn't mutate the shared parser state.
 * @param schemeTables Base per-scheme var tables.
 * @param ruleVars Rule-local `--tw-*` overrides.
 * @returns Merged per-scheme tables.
 */
function mergeRuleVars(
  schemeTables: ReadonlyMap<string, ReadonlyMap<string, string>>,
  ruleVars: ReadonlyMap<string, string>,
): Map<string, ReadonlyMap<string, string>> {
  if (ruleVars.size === 0) return new Map(schemeTables)
  const out = new Map<string, ReadonlyMap<string, string>>()
  for (const [scheme, table] of schemeTables) {
    const merged = new Map(table)
    for (const [k, v] of ruleVars) merged.set(k, v)
    out.set(scheme, merged)
  }
  return out
}
