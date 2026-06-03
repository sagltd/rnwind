import type { KeyframeBlock, RNStyle, SchemedStyle } from '../parser'
import { normalizeClassName } from '../normalize-classname'

/** Match atom names like `border-hairline`, `h-hairline`, `border-t-hairline`, etc. */
const HAIRLINE_ATOM = /-hairline$/

/** Parser's synthetic "no variant" scheme — provides the canonical fallback. */
const BASE_SCHEME = 'base'

/** Runtime registry key for the always-loaded fallback scheme. */
const COMMON_SCHEME = 'common'

/** Sentinel key the parser sets on interactive (`active:`/`focus:`) atoms. */
const STATE_KEY = '__state'

/**
 * Whether an atom is a `*-hairline` utility — its numeric value must be
 * rewritten as `StyleSheet.hairlineWidth` at runtime.
 * @param atomName Class name.
 * @returns True when the atom is a hairline utility.
 */
function isHairlineAtom(atomName: string): boolean {
  return HAIRLINE_ATOM.test(atomName)
}

/**
 * Whether an RN style object carries any own key. The parser emits
 * empty `{}` for schemes an atom doesn't apply to; we treat those as
 * "inherit canonical" and don't emit an entry for that scheme.
 * @param style RN style object.
 * @returns Whether the style has content.
 */
function isNonEmptyStyle(style: RNStyle | undefined): style is RNStyle {
  if (!style) return false
  return Object.keys(style).length > 0
}

/**
 * Iterate per-scheme entries from a parser-produced schemed bucket,
 * skipping the reserved `__state` metadata key.
 * @param schemed Parser output for one atom.
 * @yields `[scheme, style]` pairs in object-key order.
 */
function* iterScheme(schemed: SchemedStyle): IterableIterator<[string, RNStyle]> {
  const raw = schemed as Readonly<Record<string, RNStyle | string>>
  for (const key in raw) {
    if (key === STATE_KEY) continue
    yield [key, raw[key] as RNStyle]
  }
}

/**
 * Pick the canonical style for an atom — the value that goes into
 * `common.style.js`. Prefers the parser's `base` entry (the "default
 * when no variant matches"); falls back to the first non-empty per-
 * scheme entry when the atom has no explicit base.
 * @param schemed Parser-produced per-scheme bucket.
 * @returns Canonical style, or undefined when every scheme is empty.
 */
function canonicalValue(schemed: SchemedStyle): RNStyle | undefined {
  const baseEntry = (schemed as Readonly<Record<string, RNStyle>>)[BASE_SCHEME]
  if (isNonEmptyStyle(baseEntry)) return baseEntry
  for (const [, style] of iterScheme(schemed)) {
    if (isNonEmptyStyle(style)) return style
  }
  return undefined
}

/**
 * Collect every variant scheme name across the project's atoms. The
 * synthetic `base` scheme is excluded — it's folded into the `common`
 * output. Returns variants in sorted order for deterministic output.
 * @param resolved Parser-produced atom map.
 * @returns Variant scheme names (no `base`, no `common`).
 */
function collectVariantSchemes(resolved: ReadonlyMap<string, SchemedStyle>): readonly string[] {
  const set = new Set<string>()
  for (const schemed of resolved.values()) {
    for (const [scheme] of iterScheme(schemed)) {
      if (scheme !== BASE_SCHEME) set.add(scheme)
    }
  }
  return [...set].toSorted((a, b) => a.localeCompare(b))
}

/**
 * Normalize a CSS keyframe selector to the percentage form Reanimated
 * v4 keyframes objects use.
 * @param offset Selector text (`'from'`, `'to'`, `'50%'`).
 * @returns Percentage string.
 */
function offsetToPercent(offset: string): string {
  if (offset === 'from') return '0%'
  if (offset === 'to') return '100%'
  return offset
}

/**
 * Replace a string `animationName` with the inline keyframes object
 * Reanimated v4's CSS engine expects. Atoms whose `animationName`
 * doesn't match any registered keyframe keep the original string.
 * @param style RN style object (possibly carrying `animationName`).
 * @param keyframes Keyframes available to this build.
 * @returns Style with `animationName` inlined when matched.
 */
function inlineAnimationName(style: RNStyle, keyframes: ReadonlyMap<string, KeyframeBlock>): RNStyle {
  const name = style.animationName
  if (typeof name !== 'string') return style
  const block = keyframes.get(name)
  if (!block) return style
  const out: RNStyle = { ...style }
  const inline: Record<string, Record<string, string | number>> = {}
  for (const step of block.steps) inline[offsetToPercent(step.offset)] = step.style as Record<string, string | number>
  out.animationName = inline as unknown as RNStyle[string]
  return out
}

/**
 * Convert any safe-area markers in the style into a precomputed spec
 * envelope. Atoms with `__safe` markers become
 * `{__safeStyle: [[cssKey, sideTag, or, offset], ...]}` — the runtime
 * resolver reads `value.__safeStyle` as a single property access and
 * resolves against live insets without walking the value's keys.
 * @param style RN style as resolved by the parser.
 * @returns Original style OR the safe-style envelope.
 */
function envelopeSafeMarkers(
  style: RNStyle,
): RNStyle | { __safeStyle: readonly (readonly [string, string, number | undefined, number | undefined])[] } {
  let specs: [string, string, number | undefined, number | undefined][] | null = null
  for (const key of Object.keys(style)) {
    const value = style[key]
    if (typeof value !== 'object' || !value) continue
    const marker = value as { __safe?: string; or?: number; offset?: number }
    if (typeof marker.__safe !== 'string') continue
    if (!specs) specs = []
    specs.push([key, marker.__safe, marker.or, marker.offset])
  }
  if (!specs) return style
  return { __safeStyle: specs }
}

/**
 * Serialise a single atom's RN style to a JS object literal. Honors
 * the `*-hairline` sentinel: numeric values get rewritten to
 * `StyleSheet.hairlineWidth` so device-density differences land in the
 * rendered border.
 * @param atomName The atom's class name (used to detect hairline).
 * @param style The atom's RN style object.
 * @returns JS object-literal source.
 */
function serializeStyle(atomName: string, style: RNStyle): string {
  const json = JSON.stringify(style)
  if (!isHairlineAtom(atomName)) return json
  return json.replaceAll(/:(-?\d+(?:\.\d+)?)/g, ': StyleSheet.hairlineWidth')
}

/**
 * Serialise an atom's resolved value — bare RN style object or an
 * already-enveloped safe-style value.
 * @param atomName Atom name (controls hairline rewrite).
 * @param value Atom value (bare style or `{__safeStyle: spec[]}`).
 * @returns JS source for the value.
 */
function serializeAtomValue(atomName: string, value: unknown): string {
  if (typeof value === 'object' && value !== null && '__safeStyle' in value) return JSON.stringify(value)
  return serializeStyle(atomName, value as RNStyle)
}

/**
 * Resolve + envelope + serialize an atom's value under one scheme.
 * @param atomName Atom name.
 * @param style Raw RN style for this scheme.
 * @param keyframes Keyframes available to this build.
 * @returns Serialized text ready to emit.
 */
function prepareAtomValue(atomName: string, style: RNStyle, keyframes: ReadonlyMap<string, KeyframeBlock>): string {
  const enveloped = envelopeSafeMarkers(inlineAnimationName(style, keyframes))
  return serializeAtomValue(atomName, enveloped)
}

/**
 * Decide which serialized atom values get hoisted to a shared `const`.
 * A value is hoisted ONLY when ≥2 atoms share it — then one
 * `const _s<N> = <value>` saves the repeated bytes AND gives those atoms
 * one shared object (reference identity). A value used once is inlined
 * directly at its atom (`"-m-2": {"margin":-8}`) — hoisting a singleton
 * would only add bytes. First-seen order keeps the const indices stable
 * across workers.
 * @param entries `[atomName, serializedValue]` pairs (atom-sorted).
 * @returns `{ constFor }` value→const-name map + `decls` source lines.
 */
function planValueConsts(entries: readonly (readonly [string, string])[]): {
  constFor: ReadonlyMap<string, string>
  decls: readonly string[]
} {
  const counts = new Map<string, number>()
  for (const [, value] of entries) counts.set(value, (counts.get(value) ?? 0) + 1)
  const constFor = new Map<string, string>()
  const decls: string[] = []
  for (const [value, count] of counts) {
    if (count < 2) continue
    const name = `_s${decls.length}`
    constFor.set(value, name)
    decls.push(`const ${name} = ${value}`)
  }
  return { constFor, decls }
}

/**
 * Serialize a scheme's molecule map into a `registerMolecules(...)` object
 * literal, sorted by className for byte-deterministic output.
 * @param molecules normalized className → pre-merged style object.
 * @returns Object-literal source (`null` when empty).
 */
function serializeMolecules(molecules: Record<string, RNStyle> | undefined): string | null {
  if (!molecules) return null
  const keys = Object.keys(molecules).toSorted((a, b) => a.localeCompare(b))
  if (keys.length === 0) return null
  const body = keys.map((cn) => `  ${JSON.stringify(cn)}: ${JSON.stringify(molecules[cn])},`)
  return ['{', ...body, '}'].join('\n')
}

/**
 * Render one scheme file's source. `entries` is the list of atoms this
 * scheme contributes — for `common` every atom's canonical value; for
 * a variant only atoms whose value differs from canonical. Hairline
 * atoms in this file trigger the `StyleSheet` import. Pre-merged
 * molecules (when present) are registered alongside the atoms so the
 * runtime resolver's molecule-first path is populated.
 * @param schemeName Registry key (`'common'` or the variant name).
 * @param entries `[atomName, serializedValue]` pairs to emit.
 * @param molecules Pre-merged className → style map for this scheme.
 * @returns JS source text.
 */
function renderSchemeFile(
  schemeName: string,
  entries: readonly (readonly [string, string])[],
  molecules?: Record<string, RNStyle>,
): string {
  const needsStyleSheet = entries.some(([atom]) => isHairlineAtom(atom))
  const { constFor, decls } = planValueConsts(entries)
  const recordLines = entries.map(([atom, value]) => `  ${JSON.stringify(atom)}: ${constFor.get(value) ?? value},`)
  const moleculeLiteral = serializeMolecules(molecules)

  const imports = ['registerAtoms']
  if (moleculeLiteral) imports.push('registerMolecules')
  const lines: string[] = []
  if (needsStyleSheet) lines.push(`import { StyleSheet } from 'react-native'`)
  lines.push(`import { ${imports.join(', ')} } from 'rnwind'`, ``)
  if (decls.length > 0) {
    for (const decl of decls) lines.push(decl)
    lines.push(``)
  }
  lines.push(`registerAtoms(${JSON.stringify(schemeName)}, {`, ...recordLines, `})`, ``)
  if (moleculeLiteral) lines.push(`registerMolecules(${JSON.stringify(schemeName)}, ${moleculeLiteral})`, ``)
  return lines.join('\n')
}

/**
 * Serialize a feature map (atom name → JSON-able value: gradient info or
 * haptic request) into a stable JS object literal for the manifest.
 * Sorted by key so the output is byte-deterministic across workers.
 * @param map Atom name → feature value.
 * @returns Object-literal source.
 */
function serializeFeatureMap(map: ReadonlyMap<string, unknown>): string {
  const entries = [...map.entries()].toSorted((a, b) => a[0].localeCompare(b[0]))
  const body = entries.map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(', ')
  return `{ ${body} }`
}

/**
 * Render the JS-object literal for the responsive-breakpoint table the
 * runtime registers at manifest-load time. Sorted by ascending px
 * threshold so the runtime can build a deterministic "tier index" for
 * its style cache.
 * @param breakpoints Breakpoint name → px-threshold map.
 * @returns Object-literal source (`{}` when empty).
 */
function serializeBreakpoints(breakpoints: ReadonlyMap<string, number>): string {
  if (breakpoints.size === 0) return '{}'
  const entries = [...breakpoints].toSorted((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
  const inner = entries.map(([name, px]) => `${JSON.stringify(name)}: ${px}`).join(', ')
  return `{ ${inner} }`
}

/**
 * Render the manifest module. EAGER-imports `common.style.js` AND every
 * variant scheme file so every scheme's atoms register the moment the
 * manifest evaluates — no lazy `require`. Lazy loading raced the cold
 * start: `RnwindProvider` calls `loadScheme(scheme)` on its first render,
 * but on a cold boot the manifest (hence `registerSchemeLoader`) may not
 * have evaluated yet, so that call no-ops and the active variant's atoms
 * never load — scheme-dependent styles fall back to `common` (the light
 * default) until a reload. Eager imports remove the race entirely; the
 * variant files are small diffs, so the upfront cost is negligible.
 * `ensureSchemeLoaded` stays exported as a no-op for API compatibility.
 * @param variants Variant scheme names (no `base`, no `common`).
 * @param breakpoints Responsive breakpoint name → px-threshold map.
 * @param gradients Atom → gradient info for `registerGradients`.
 * @param haptics Atom → haptic request for `registerHaptics`.
 * @returns JS source text.
 */
function renderManifest(
  variants: readonly string[],
  breakpoints: ReadonlyMap<string, number>,
  gradients: ReadonlyMap<string, unknown>,
  haptics: ReadonlyMap<string, unknown>,
): string {
  const imports = ['registerSchemeLoader', 'registerBreakpoints']
  if (gradients.size > 0) imports.push('registerGradients')
  if (haptics.size > 0) imports.push('registerHaptics')
  const lines: string[] = [`import { ${imports.join(', ')} } from 'rnwind'`, `import './common.style'`]
  for (const variant of variants) lines.push(`import ${JSON.stringify(`./${variant}.style`)}`)
  lines.push(``, `registerBreakpoints(${serializeBreakpoints(breakpoints)})`)
  if (gradients.size > 0) lines.push(`registerGradients(${serializeFeatureMap(gradients)})`)
  if (haptics.size > 0) lines.push(`registerHaptics(${serializeFeatureMap(haptics)})`)
  lines.push(
    ``,
    `function ensureSchemeLoaded(_name) {}`,
    ``,
    `registerSchemeLoader(ensureSchemeLoaded)`,
    ``,
    `export { ensureSchemeLoaded }`,
    ``,
  )
  return lines.join('\n')
}

/**
 * Whether a resolved style carries a nested safe-area marker — molecules
 * can't pre-bake these because the inset value is per-render.
 * @param style Raw resolved RN style (pre-envelope).
 * @returns True when any value is a `{__safe: ...}` marker.
 */
function hasSafeMarker(style: RNStyle): boolean {
  for (const key of Object.keys(style)) {
    const value = style[key]
    if (typeof value !== 'object' || !value) continue
    if ('__safe' in value) return true
  }
  return false
}

/**
 * Whether a resolved style has font-scale-sensitive props. Molecules
 * can't pre-bake these because `fontSize`/`lineHeight` scale per-render
 * with `useWindowDimensions().fontScale`.
 * @param style Resolved RN style.
 * @returns True when `fontSize` or `lineHeight` is present.
 */
function hasFontScaleProperty(style: RNStyle): boolean {
  return 'fontSize' in style || 'lineHeight' in style
}

/**
 * Whether a token is a feature-only utility (gradient stop/direction,
 * haptic, or text-truncate) that contributes NO RN `style` — the runtime
 * resolver folds these in via `attachFeatures`, so they don't disqualify
 * a molecule, they just merge nothing.
 * @param token Atom name.
 * @param gradients Gradient feature map.
 * @param haptics Haptic feature map.
 * @returns True when the token is a non-style feature.
 */
function isFeatureToken(token: string, gradients: ReadonlyMap<string, unknown>, haptics: ReadonlyMap<string, unknown>): boolean {
  if (gradients.has(token) || haptics.has(token)) return true
  return token === 'truncate' || token === 'text-ellipsis' || token === 'text-clip' || token.startsWith('line-clamp-')
}

/**
 * Resolve one atom's value under a scheme: the scheme's own non-empty
 * bucket, falling back to canonical. `common` always reads canonical.
 * @param schemed Parser-produced per-scheme bucket.
 * @param scheme Scheme key (`'common'` or a variant name).
 * @returns The atom's RN style for that scheme, or undefined.
 */
function schemeValueOf(schemed: SchemedStyle, scheme: string): RNStyle | undefined {
  if (scheme === COMMON_SCHEME) return canonicalValue(schemed)
  const own = (schemed as Readonly<Record<string, RNStyle>>)[scheme]
  return isNonEmptyStyle(own) ? own : canonicalValue(schemed)
}

/**
 * Pre-merge a normalized className's atoms into ONE RN style object for a
 * scheme, or null when the className is NOT molecule-eligible. A
 * className is eligible only when every token is context-independent:
 *  - no variant prefix (`active:` / `focus:` / `md:` / `dark:` — anything
 *    with a `:`), so scheme/state/breakpoint gating never applies,
 *  - no `*-hairline`, `*-safe`, or font-scale (`fontSize`/`lineHeight`)
 *    atom, whose value is resolved per-render.
 * Feature-only tokens (gradient / haptic / truncate) are skipped, not
 * disqualifying — the runtime folds them in via `attachFeatures`. Unknown
 * tokens disqualify so the atom path still surfaces the dev warning.
 * @param tokens Normalized className tokens (order preserved).
 * @param scheme Scheme key to resolve each atom under.
 * @param resolved Per-atom schemed styles.
 * @param keyframes Keyframes to inline into `animationName`.
 * @param gradients Gradient feature map.
 * @param haptics Haptic feature map.
 * @returns Merged style object, or null when not eligible.
 */
function mergeMolecule(
  tokens: readonly string[],
  scheme: string,
  resolved: ReadonlyMap<string, SchemedStyle>,
  keyframes: ReadonlyMap<string, KeyframeBlock>,
  gradients: ReadonlyMap<string, unknown>,
  haptics: ReadonlyMap<string, unknown>,
): RNStyle | null {
  const merged: RNStyle = {}
  for (const token of tokens) {
    if (token.includes(':')) return null
    if (isFeatureToken(token, gradients, haptics)) continue
    if (isHairlineAtom(token)) return null
    const schemed = resolved.get(token)
    if (!schemed) return null
    const raw = schemeValueOf(schemed, scheme)
    if (!raw) continue
    if (hasSafeMarker(raw) || hasFontScaleProperty(raw)) return null
    Object.assign(merged, inlineAnimationName(raw, keyframes))
  }
  return merged
}

/**
 * Emit each variant's molecule for one className — but only when the
 * variant's merge DIFFERS from common (runtime falls back to common).
 * @param normalized Normalized className key.
 * @param tokens Normalized className tokens.
 * @param commonText Serialized common-scheme merge for the diff check.
 * @param variants Variant scheme names.
 * @param variantMaps Mutable per-variant molecule collectors.
 * @param resolved Per-atom schemed styles.
 * @param keyframes Keyframes to inline.
 * @param gradients Gradient feature map.
 * @param haptics Haptic feature map.
 */
function addVariantMolecules(
  normalized: string,
  tokens: readonly string[],
  commonText: string,
  variants: readonly string[],
  variantMaps: Record<string, Record<string, RNStyle>>,
  resolved: ReadonlyMap<string, SchemedStyle>,
  keyframes: ReadonlyMap<string, KeyframeBlock>,
  gradients: ReadonlyMap<string, unknown>,
  haptics: ReadonlyMap<string, unknown>,
): void {
  for (const variant of variants) {
    const variantMerged = mergeMolecule(tokens, variant, resolved, keyframes, gradients, haptics)
    if (variantMerged === null) continue
    if (JSON.stringify(variantMerged) !== commonText) variantMaps[variant][normalized] = variantMerged
  }
}

/**
 * Build per-scheme molecules for every literal className the project
 * uses. Each eligible className gets a pre-merged style object under
 * `common`; a variant only carries an entry when its merge DIFFERS from
 * common (runtime falls back `molecules[scheme] ?? molecules.common`).
 * @param literals Distinct literal className strings (raw).
 * @param resolved Per-atom schemed styles.
 * @param keyframes Keyframes to inline.
 * @param variants Variant scheme names.
 * @param gradients Gradient feature map.
 * @param haptics Haptic feature map.
 * @returns scheme → (normalized className → merged style).
 */
function buildMolecules(
  literals: readonly string[],
  resolved: ReadonlyMap<string, SchemedStyle>,
  keyframes: ReadonlyMap<string, KeyframeBlock>,
  variants: readonly string[],
  gradients: ReadonlyMap<string, unknown>,
  haptics: ReadonlyMap<string, unknown>,
): Record<string, Record<string, RNStyle>> {
  const common: Record<string, RNStyle> = {}
  const variantMaps: Record<string, Record<string, RNStyle>> = {}
  for (const variant of variants) variantMaps[variant] = {}

  for (const literal of literals) {
    const normalized = normalizeClassName(literal)
    if (normalized.length === 0) continue
    const tokens = normalized.split(' ')
    const commonMerged = mergeMolecule(tokens, COMMON_SCHEME, resolved, keyframes, gradients, haptics)
    if (commonMerged === null) continue
    common[normalized] = commonMerged
    addVariantMolecules(normalized, tokens, JSON.stringify(commonMerged), variants, variantMaps, resolved, keyframes, gradients, haptics)
  }

  const out: Record<string, Record<string, RNStyle>> = { [COMMON_SCHEME]: common }
  for (const variant of variants) {
    if (Object.keys(variantMaps[variant]).length > 0) out[variant] = variantMaps[variant]
  }
  return out
}

/** Output of one build pass — one source per scheme plus the manifest. */
export interface BuildSchemeSourcesOutput {
  /** `<schemeName>.style.js` source per scheme. Always contains `common`. */
  readonly schemeSources: Readonly<Record<string, string>>
  /** Manifest module source (`schemes.js`). */
  readonly manifestSource: string
  /** Variant scheme names this build covers (sorted; excludes `common`). */
  readonly variants: readonly string[]
  /** Number of `prepareAtomValue` / JSON.stringify passes (cache MISSES) this call did — test telemetry. */
  readonly serializedMisses: number
}

/**
 * Per-atom cached serialized value. Canonical (common) string plus a
 * map of variant → own-serialized-string. `styleRef` is an identity
 * guard against the resolved SchemedStyle — when callers replace an
 * atom's value the ref diverges and the cache rebuilds that entry.
 */
export interface AtomSerializedEntry {
  styleRef: SchemedStyle
  canonical: string
  variants: Map<string, string>
}

/** Cache UnionBuilder owns across repeated writeSchemes calls. */
export type AtomSerializedCache = Map<string, AtomSerializedEntry>

/**
 * Pre-serialize every non-empty variant value, reusing the per-atom
 * cache where present. Result drives both the scheme-uniform check
 * AND the per-variant emission loop downstream.
 * @param atom Atom name.
 * @param schemed Parser-produced schemed bucket.
 * @param variants Variant scheme names in deterministic order.
 * @param keyframes Keyframes available to inline.
 * @param cached Cached entry for this atom (when ref-stable).
 * @returns variantName → serialized text.
 */
function buildVariantTexts(
  atom: string,
  schemed: SchemedStyle,
  variants: readonly string[],
  keyframes: ReadonlyMap<string, KeyframeBlock>,
  cached: AtomSerializedEntry | undefined,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const variant of variants) {
    const own = (schemed as Readonly<Record<string, RNStyle>>)[variant]
    if (!isNonEmptyStyle(own)) continue
    const text = cached?.variants.get(variant) ?? prepareAtomValue(atom, own, keyframes)
    out.set(variant, text)
  }
  return out
}

/**
 * Decide whether a (no-base) atom should be promoted to common because
 * every declared variant resolves to the same value. This is the
 * scheme-uniform case: `flex`, `p-4`, `absolute` all carry no theme
 * variables, so Phase-1 fills every variant bucket identically and
 * leaves `base` empty — without this collapse they'd be duplicated
 * across every scheme file.
 *
 * The variant-prefix check is what keeps a real scheme-gated atom
 * (`dark:bg-indigo-800`) out of common in a single-variant project
 * (where its 1 bucket would otherwise look "uniform" by definition).
 * @param atom Atom name (checked for `<variant>:` prefix).
 * @param variants Declared variant scheme names.
 * @param variantTexts Serialized variant values.
 * @param canonicalText Serialized canonical (common) value.
 * @returns Whether the atom is uniform across every declared variant.
 */
function isSchemeUniform(
  atom: string,
  variants: readonly string[],
  variantTexts: ReadonlyMap<string, string>,
  canonicalText: string,
): boolean {
  if (variants.length === 0 || variantTexts.size !== variants.length) return false
  if (variants.some((variant) => atom.startsWith(`${variant}:`))) return false
  for (const text of variantTexts.values()) {
    if (text !== canonicalText) return false
  }
  return true
}

/**
 * Serialize one atom's canonical + variant-diff entries, honouring the
 * per-atom cache. Returns the number of cache MISSES this atom incurred
 * (0 when canonical was cached AND every needed variant was cached;
 * 1 when anything had to be re-stringified).
 *
 * Three paths gated on whether the parser produced a non-empty `base`
 * bucket and whether the variants converge:
 *  - **Themed atom (base present)**: canonical goes to `common`, each
 *    variant whose own value diverges from canonical writes the diff
 *    into its own scheme file. `lookupAtom` finds the variant's
 *    override or falls through to common.
 *  - **Scheme-uniform atom (base empty, every variant identical)**:
 *    promoted to `common` once — the parser's Phase-1 fills every
 *    variant bucket with the same value for utilities like `flex` /
 *    `p-4` / `absolute` that don't reference theme variables.
 *  - **Scheme-gated atom (base empty, prefixed name like `dark:foo`,
 *    or variants diverge)**: each populated variant writes the value
 *    into its own scheme file directly; common stays empty so the
 *    runtime fallback can't leak the variant style into other schemes.
 * @param atom Atom name.
 * @param schemed Parser-produced schemed bucket for the atom.
 * @param canonical Canonical RN style for `common`.
 * @param variants Variant scheme names in deterministic order.
 * @param keyframes Keyframes available to inline.
 * @param commonEntries Mutable collector for `common`'s `[atom, text]` pairs.
 * @param variantEntries Mutable collector keyed by variant name.
 * @param cache Optional shared serialized-value cache.
 * @returns Number of JSON.stringify passes triggered for this atom.
 */
function collectAtomEntries(
  atom: string,
  schemed: SchemedStyle,
  canonical: RNStyle,
  variants: readonly string[],
  keyframes: ReadonlyMap<string, KeyframeBlock>,
  commonEntries: (readonly [string, string])[],
  variantEntries: Record<string, (readonly [string, string])[]>,
  cache?: AtomSerializedCache,
): number {
  const cached = cache?.get(atom)
  const hit = cached?.styleRef === schemed
  const baseEntry = (schemed as Readonly<Record<string, RNStyle>>)[BASE_SCHEME]
  const hasBase = isNonEmptyStyle(baseEntry)
  const canonicalText = hit ? cached.canonical : prepareAtomValue(atom, canonical, keyframes)
  const variantTexts = buildVariantTexts(atom, schemed, variants, keyframes, hit ? cached : undefined)
  const goesToCommon = hasBase || isSchemeUniform(atom, variants, variantTexts, canonicalText)

  if (goesToCommon) commonEntries.push([atom, canonicalText])

  const entry: AtomSerializedEntry = hit
    ? cached
    : { styleRef: schemed, canonical: canonicalText, variants: new Map(variantTexts) }
  if (!hit) cache?.set(atom, entry)

  for (const variant of variants) {
    const ownText = variantTexts.get(variant)
    if (ownText === undefined) continue
    if (goesToCommon && ownText === canonicalText) continue
    variantEntries[variant].push([atom, ownText])
  }
  return hit ? 0 : 1
}

/** Empty fallback when the caller didn't supply breakpoints (legacy callers, tests). */
const EMPTY_BREAKPOINTS: ReadonlyMap<string, number> = new Map()

/**
 * Build the per-scheme style files + manifest source.
 *
 * Dedup rule (the thing that shrinks scheme files to their diff):
 *  - Every atom's canonical value goes into `common.style.js`.
 *  - Each variant's file emits an entry for an atom ONLY when the
 *    variant's own resolved value differs from canonical. When the
 *    variant inherits (parser emits an empty `{}` for that scheme) or
 *    the variant's resolved value serializes identically to canonical,
 *    the atom is omitted — at runtime the lookup falls through via
 *    `cache.atoms[scheme]?.[atom] ?? cache.atoms.common[atom]`.
 *
 * Keyframes are inlined directly into atom values via `animationName`
 * ({@link inlineAnimationName}). Safe-area markers get pre-enveloped
 * via {@link envelopeSafeMarkers}. Hairline utilities stay bound to
 * `StyleSheet.hairlineWidth` at runtime.
 * @param atomNames All atom names (sorted).
 * @param resolved Per-atom schemed styles from the parser.
 * @param keyframes Keyframe blocks referenced by any atom.
 * @param cache Optional shared serialized-value cache.
 * @param breakpoints Responsive breakpoint name → px-threshold map. The
 *   manifest emits `registerBreakpoints({...})` so the runtime can gate
 *   `md:*` / `lg:*` atoms on `windowWidth`. Optional — empty when the
 *   theme declares no breakpoints (legacy/test callers).
 * @param gradients Gradient feature map (atom → role/colour) for the manifest + molecule eligibility.
 * @param haptics Haptic feature map (atom → request) for the manifest + molecule eligibility.
 * @param literals Distinct literal className strings — pre-merged into
 *   per-scheme molecules so the runtime resolver's O(1) molecule-first
 *   path is populated. Empty for legacy/test callers (atom path only).
 * @returns Per-scheme sources, manifest source, variant list.
 */
export function buildSchemeSources(
  atomNames: readonly string[],
  resolved: ReadonlyMap<string, SchemedStyle>,
  keyframes: ReadonlyMap<string, KeyframeBlock>,
  cache?: AtomSerializedCache,
  breakpoints: ReadonlyMap<string, number> = EMPTY_BREAKPOINTS,
  gradients: ReadonlyMap<string, unknown> = EMPTY_FEATURE_MAP,
  haptics: ReadonlyMap<string, unknown> = EMPTY_FEATURE_MAP,
  literals: readonly string[] = EMPTY_LITERALS,
): BuildSchemeSourcesOutput {
  const variants = collectVariantSchemes(resolved)
  const commonEntries: (readonly [string, string])[] = []
  const variantEntries: Record<string, (readonly [string, string])[]> = {}
  for (const variant of variants) variantEntries[variant] = []
  let misses = 0

  for (const atom of atomNames) {
    const schemed = resolved.get(atom)
    if (!schemed) continue
    const canonical = canonicalValue(schemed)
    if (!canonical) continue
    misses += collectAtomEntries(atom, schemed, canonical, variants, keyframes, commonEntries, variantEntries, cache)
  }

  const molecules = buildMolecules(literals, resolved, keyframes, variants, gradients, haptics)
  const schemeSources: Record<string, string> = {
    [COMMON_SCHEME]: renderSchemeFile(COMMON_SCHEME, commonEntries, molecules[COMMON_SCHEME]),
  }
  for (const variant of variants) {
    schemeSources[variant] = renderSchemeFile(variant, variantEntries[variant], molecules[variant])
  }

  return {
    schemeSources,
    manifestSource: renderManifest(variants, breakpoints, gradients, haptics),
    variants,
    serializedMisses: misses,
  }
}

/** Shared empty feature map default. */
const EMPTY_FEATURE_MAP: ReadonlyMap<string, unknown> = new Map()

/** Shared empty literal-list default (atom-only callers). */
const EMPTY_LITERALS: readonly string[] = []

/** Registry key the runtime uses for the always-loaded fallback. */
export const COMMON_SCHEME_NAME: string = COMMON_SCHEME
