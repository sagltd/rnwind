/**
 * Lightweight extractor for user-declared `@theme` and `@variant` blocks
 * inside `:root` / `@layer theme`. Used by the parser to resolve
 * `var(--x)` references that Tailwind's `theme(inline)` leaves
 * unresolved (it only inlines its own known tokens, not user-added ones).
 *
 * Kept regex-free — a linear paren-balanced scan handles nesting without
 * the backtracking risks of `{[^}]*}` patterns. CSS comment blocks are
 * stripped before scanning so slash-star-sequences inside declaration
 * values don't confuse the parser.
 */

/**
 * `@custom-variant <name> ...content-up-to-semicolon...;`
 * The `[^;]+` class is constant-width relative to its input (one char
 * per step, no alternation backtracking), so sonarjs/slow-regex doesn't
 * apply — the flagged pattern is a false positive.
 */
// eslint-disable-next-line sonarjs/slow-regex
const CUSTOM_VARIANT_WITH_SELECTOR = /@custom-variant\s+([A-Za-z][A-Za-z0-9_-]*)\s+([^;]+);/g
/** Bare `.classname` occurrences (one capture group per class). */
const CLASS_IN_SELECTOR = /\.([A-Za-z_][\w-]*)/g

/**
 * One iteration step of the block walker — decides whether the next
 * interesting token is a declaration, a nested block, or the end of
 * scope. Kept small to keep {@link walkBlocks} below the cognitive
 * complexity threshold.
 */
interface WalkStep {
  /** Next scan index, or `-1` to terminate the outer loop. */
  next: number
}

/**
 * Recursively descend into `{ ... }` blocks, collecting `--x: y;`
 * declarations under the active scheme. When we hit `@variant <name> {`,
 * the child scope's scheme becomes `<name>` until that block closes.
 * @param source Pre-stripped CSS source.
 * @param start Start index of the block body (0 for top-level).
 * @param scheme Active scheme name for declarations inside this scope.
 * @param table Destination table, mutated in place.
 */
function walkBlocks(source: string, start: number, scheme: string, table: ThemeSchemeTable): void {
  let index = start
  while (index < source.length) {
    const step = nextWalkStep(source, index, scheme, table)
    if (step.next === -1) return
    index = step.next
  }
}

/**
 * Decide the next action at `index`: declaration, nested block, or EOF.
 * @param source Pre-stripped CSS.
 * @param index Current scan index.
 * @param scheme Active scheme name.
 * @param table Destination table.
 * @returns Step descriptor with the next scan index (or -1 for EOF).
 */
function nextWalkStep(source: string, index: number, scheme: string, table: ThemeSchemeTable): WalkStep {
  // Find the next TOP-LEVEL `--` (outside any `( ... )`). That's the only
  // place a custom-property declaration can start. `--foo` that appears
  // inside `var(--foo)` or `calc(... --value(integer) ...)` is part of a
  // value, not a new declaration — accidentally treating it as one would
  // splice into the `@theme` block's declaration list and produce broken
  // CSS that Tailwind rejects downstream.
  const atIndex = findTopLevelDoubleDash(source, index)
  const openIndex = source.indexOf('{', index)
  const closeIndex = source.indexOf('}', index)
  const blockClose = closeIndex === -1 ? Number.POSITIVE_INFINITY : closeIndex
  if (isDeclarationNext(atIndex, openIndex, blockClose)) {
    return { next: consumeDeclaration(source, atIndex, scheme, table) }
  }
  if (openIndex !== -1 && openIndex < blockClose) {
    return { next: enterBlock(source, index, openIndex, scheme, table) }
  }
  return { next: -1 }
}

/**
 * Find the next `--` in `source` that's not inside a `( ... )` group.
 * Stops early if we hit an unmatched `}` (end of the containing block)
 * — a `--` inside a nested block isn't our concern either.
 * @param source Pre-stripped CSS source.
 * @param from Start index to scan from.
 * @returns Index of the next top-level `--`, or `-1` when none.
 */
function findTopLevelDoubleDash(source: string, from: number): number {
  let parenDepth = 0
  for (let index = from; index < source.length - 1; index += 1) {
    const ch = source.codePointAt(index)
    if (ch === 40 /* ( */) {
      parenDepth += 1
      continue
    }
    if (ch === 41 /* ) */) {
      if (parenDepth > 0) parenDepth -= 1
      continue
    }
    if (ch === 125 /* } */ && parenDepth === 0) return -1
    if (ch === 45 /* - */ && parenDepth === 0 && source.codePointAt(index + 1) === 45) {
      return index
    }
  }
  return -1
}

/**
 * Whether the next action at the current scan position is a declaration.
 * @param atIndex Index of the next `--`.
 * @param openIndex Index of the next `{`.
 * @param blockClose Index of the next `}` (or `+Infinity` when absent).
 * @returns True when a declaration should be consumed next.
 */
function isDeclarationNext(atIndex: number, openIndex: number, blockClose: number): boolean {
  if (atIndex === -1 || atIndex >= blockClose) return false
  return openIndex === -1 || atIndex < openIndex
}

/**
 * Handle a nested `{ ... }` block: recurse with the right scheme, then
 * skip past the matching closing brace.
 * @param source Pre-stripped CSS.
 * @param index Scan position at the start of the header.
 * @param openIndex Index of the opening brace.
 * @param scheme Scheme active in the parent scope.
 * @param table Destination table.
 * @returns Index past the matching closing brace.
 */
function enterBlock(source: string, index: number, openIndex: number, scheme: string, table: ThemeSchemeTable): number {
  const header = source.slice(index, openIndex).trim()
  // Skip blocks that define utilities / at-rules that carry declarations
  // meant for a downstream compiler, not custom-property values for the
  // active theme scheme. `@utility name-*` bodies contain Tailwind v4's
  // `--value(...)` meta-syntax which would otherwise confuse the
  // top-level declaration walker and spill into the extracted theme.
  if (isNonThemeAtRule(header)) return skipMatchingBrace(source, openIndex + 1)
  const childScheme = variantNameOf(header) ?? scheme
  walkBlocks(source, openIndex + 1, childScheme, table)
  return skipMatchingBrace(source, openIndex + 1)
}

/**
 * Whether a block header belongs to an at-rule whose body should be
 * ignored by the theme-var extractor. `@utility` / `@media` / `@keyframes`
 * / `@supports` / `@container` bodies contain property declarations that
 * are NOT custom-property definitions for the active theme.
 * @param header Text between the outer statement and the opening brace.
 * @returns `true` when the block body should be skipped.
 */
function isNonThemeAtRule(header: string): boolean {
  const trimmed = header.trimStart()
  if (!trimmed.startsWith('@')) return false
  const match = /^@([A-Za-z-]+)/.exec(trimmed)
  if (!match) return false
  const name = match[1]!
  return name === 'utility' || name === 'keyframes' || name === 'media' || name === 'supports' || name === 'container'
}

/**
 * Consume one `--name: value;` declaration starting at `start`. Commits
 * the name/value pair into the active scheme's map and returns the index
 * just past the terminating `;`.
 * @param source CSS source.
 * @param start Index of the `--`.
 * @param scheme Active scheme.
 * @param table Destination table.
 * @returns Next scan index.
 */
function consumeDeclaration(source: string, start: number, scheme: string, table: ThemeSchemeTable): number {
  const colon = source.indexOf(':', start)
  if (colon === -1) return source.length
  const name = source.slice(start, colon).trim()
  const end = source.indexOf(';', colon)
  const stop = end === -1 ? source.indexOf('}', colon) : end
  if (stop === -1) return source.length
  const value = source.slice(colon + 1, stop).trim()
  if (name.startsWith('--')) {
    const bucket = table.get(scheme) ?? new Map()
    bucket.set(name, value)
    table.set(scheme, bucket)
  }
  return stop + 1
}

/**
 * Walk forward through the source tracking brace depth; return the index
 * just past the matching `}` for the opener at `start - 1`.
 * @param source CSS source.
 * @param start Index just past the opening brace.
 * @returns Index past the matching closer (or source.length on imbalance).
 */
function skipMatchingBrace(source: string, start: number): number {
  let depth = 1
  for (let index = start; index < source.length; index += 1) {
    const ch = source[index]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return source.length
}

/**
 * If `header` text (right before an opening brace) names a variant
 * (`@variant <name>`), return that name. Otherwise null.
 * @param header Text between the previous statement and the next `{`.
 * @returns Variant name, or null when this block isn't a `@variant`.
 */
function variantNameOf(header: string): string | null {
  const match = /^@variant\s+([A-Za-z][A-Za-z0-9_-]*)/.exec(header)
  if (!match) return null
  return match[1] ?? null
}

/**
 * Emit `@custom-variant` declarations for every scheme the user declared
 * but hasn't manually registered. Makes Tailwind accept `light:*` /
 * `dark:*` / etc. as valid class-name prefixes.
 * @param css Stripped CSS source used to detect already-declared variants.
 * @param schemes Non-base scheme names from the extracted table.
 * @returns Zero or more `@custom-variant ... ;` lines.
 */
function buildCustomVariantDeclarations(css: string, schemes: readonly string[]): string[] {
  if (schemes.length === 0) return []
  const existing = new Set<string>()
  for (const match of css.matchAll(CUSTOM_VARIANT_REGEX)) existing.add(match[1]!)
  const out: string[] = []
  for (const name of schemes) {
    if (!existing.has(name)) out.push(`@custom-variant ${name} (&:where(.${name}, .${name} *));`)
  }
  return out
}

/**
 * Re-publish variant-scoped tokens into a flat theme block so Tailwind
 * sees every custom-property name it needs. Values come from the base
 * scheme first, with the FIRST declared non-base scheme layering on top
 * — Tailwind only cares about token shape (color vs length), not the
 * exact value, since rnwind does per-scheme substitution at walk time.
 * @param table Extracted scheme → var-name → value table.
 * @param schemes Non-base scheme names (sorted by declaration order).
 * @returns A single `@theme { ... }` block or `null` when there are no tokens.
 */
function buildUnifiedThemeBlock(table: ThemeSchemeTable, schemes: readonly string[]): string | null {
  const unifiedVars = new Map<string, string>()
  const baseTokens = table.get(BASE_SCHEME)
  if (baseTokens) for (const [k, v] of baseTokens) unifiedVars.set(k, v)
  if (schemes.length > 0) {
    const firstTokens = table.get(schemes[0]!)
    if (firstTokens) for (const [k, v] of firstTokens) unifiedVars.set(k, v)
  }
  if (unifiedVars.size === 0) return null
  const decls = [...unifiedVars].map(([name, value]) => `  ${name}: ${value};`).join('\n')
  return `@theme {\n${decls}\n}`
}

const CUSTOM_VARIANT_REGEX = /@custom-variant\s+([A-Za-z][A-Za-z0-9_-]*)\b/g
const VARIANT_OPEN_REGEX = /@variant\s+[A-Za-z0-9_-]+\s*\{/g

/**
 * Strip every `@variant <name> { ... }` block (including nested braces)
 * from a CSS source.
 * @param css Raw CSS.
 * @returns CSS without variant blocks.
 */
function stripVariantBlocks(css: string): string {
  let out = ''
  let cursor = 0
  VARIANT_OPEN_REGEX.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = VARIANT_OPEN_REGEX.exec(css)) !== null) {
    const openEnd = match.index + match[0].length
    const closeIndex = findMatchingBrace(css, openEnd)
    if (closeIndex === -1) break
    out += css.slice(cursor, match.index)
    cursor = closeIndex + 1
    VARIANT_OPEN_REGEX.lastIndex = cursor
  }
  out += css.slice(cursor)
  return out
}

/**
 * Walk forward from `start` tracking brace depth; return the index of the
 * matching `}` for the opener just before `start`.
 * @param source Source string.
 * @param start Index just past the opening `{`.
 * @returns Index of matching `}`, or `-1` on imbalance.
 */
function findMatchingBrace(source: string, start: number): number {
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
 * Drop CSS comment blocks from a source. Keeps the token-declaration
 * scanner simple — comments can contain braces / `--` sequences that
 * would otherwise fool it.
 * @param css Raw CSS source.
 * @returns Source with every comment block removed.
 */
function stripComments(css: string): string {
  let out = ''
  let index = 0
  while (index < css.length) {
    const open = css.indexOf('/*', index)
    if (open === -1) {
      out += css.slice(index)
      break
    }
    out += css.slice(index, open)
    const close = css.indexOf('*/', open + 2)
    if (close === -1) break
    index = close + 2
  }
  return out
}

/** Scheme name → (var name → value). The base scheme key is `'base'`. */
export type ThemeSchemeTable = Map<string, Map<string, string>>

/** Synthetic scheme name used for tokens declared outside any `@variant`. */
export const BASE_SCHEME = 'base'

/**
 * Extract user-declared theme tokens from a CSS source. Scans for:
 *  - classic v4 `@theme` blocks (`@theme { --x: y; ... }`)
 *  - `@variant <name> { --x: y; ... }` inside any surrounding block
 *
 * Both flavors contribute to the returned table: vars outside any
 * `@variant` go under `'base'`; vars inside `@variant <name>` go under
 * `<name>`.
 *
 * Not a full CSS parser — just enough to recognise the token-declaration
 * shape Tailwind v4 users actually write.
 * @param css Theme CSS source.
 * @returns Scheme → var-name → value map.
 */
export function extractThemeVars(css: string): ThemeSchemeTable {
  const table: ThemeSchemeTable = new Map()
  const stripped = stripComments(css)
  walkBlocks(stripped, 0, BASE_SCHEME, table)
  return table
}

/**
 * Build a `<class-in-selector> → <scheme-name>` alias map from any
 * `@custom-variant <name> (<selector>);` declarations in the theme CSS.
 *
 * Tailwind compiles `dark:opacity-100` to a nested rule whose selector is
 * the user's declared variant selector. When the user writes
 * `@custom-variant dark (&:where(.scheme-dark, .scheme-dark *));`, the
 * generated rule references `.scheme-dark` instead of the literal `.dark`
 * class rnwind's selector matcher defaults to. This alias map lets the
 * parser map those custom selector classes back to their scheme name.
 * @param css Theme CSS source.
 * @returns Class-name → scheme-name map. Empty when no `@custom-variant`
 *   declarations are present (rnwind's auto-generated defaults already
 *   use the literal scheme name and don't need an alias).
 */
export function extractSchemeAliases(css: string): Map<string, string> {
  const aliases = new Map<string, string>()
  const stripped = stripComments(css)
  for (const match of stripped.matchAll(CUSTOM_VARIANT_WITH_SELECTOR)) {
    const schemeName = match[1]!
    const selectorBody = match[2]!
    for (const cls of selectorBody.matchAll(CLASS_IN_SELECTOR)) {
      const className = cls[1]!
      if (className === schemeName) continue
      aliases.set(className, schemeName)
    }
  }
  return aliases
}

/**
 * Rewrite the theme CSS so Tailwind's compiler accepts it:
 *  1. Strip every `@variant <name> { ... }` block — Tailwind rejects
 *     them inline because `@variant` is a rnwind concept, not a Tailwind
 *     at-rule. The scheme-scoped vars are preserved in the extracted
 *     {@link ThemeSchemeTable} and substituted at walk time.
 *  2. Prepend `@custom-variant <name> (&:where(.<name>, .<name> *));`
 *     for every scheme name we saw, so Tailwind accepts `light:bg-*`,
 *     `dark:bg-*`, etc. as valid class-name prefixes without the user
 *     having to duplicate the variant declaration.
 * @param css Theme CSS source.
 * @param table Scheme → var-name → value table from {@link extractThemeVars}.
 * @returns CSS ready to feed `@tailwindcss/node`'s compiler.
 */
export function compileReadyTheme(css: string, table: ThemeSchemeTable): string {
  const schemes = [...table.keys()].filter((name) => name !== BASE_SCHEME)
  const stripped = stripVariantBlocks(css)
  const prelude: string[] = []
  const customVariants = buildCustomVariantDeclarations(stripped, schemes)
  if (customVariants.length > 0) prelude.push(...customVariants)
  const themeBlock = buildUnifiedThemeBlock(table, schemes)
  if (themeBlock) prelude.push(themeBlock)
  if (prelude.length === 0) return stripped
  return `${prelude.join('\n')}\n${stripped}`
}
