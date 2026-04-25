/**
 * Gradient-atom extractor.
 *
 * Tailwind v4's gradient system is encoded as a set of CSS custom
 * properties Tailwind writes onto specific utility class rules:
 *
 *   .from-red-500       → `--tw-gradient-from: #ef4444`
 *   .via-green-500      → `--tw-gradient-via:  #22c55e`
 *   .to-blue-500        → `--tw-gradient-to:   #3b82f6`
 *   .bg-gradient-to-r   → `--tw-gradient-position: to right`
 *   .bg-linear-to-br    → `--tw-gradient-position: to bottom right`
 *
 * None of these set properties React Native can render (`backgroundImage:
 * linear-gradient(...)` is web-only). Instead, rnwind treats them as
 * **metadata**: the transformer strips gradient atoms from the JSX
 * site's className and emits `colors={[...]} start={...} end={...}`
 * props on the original component (user supplies `<LinearGradient>`
 * from `expo-linear-gradient` or similar).
 *
 * This module walks a lightningcss declaration list, notices the
 * `--tw-gradient-*` writes, and surfaces them as a compact
 * {@link GradientAtomInfo} record the transformer can read per atom.
 */

import type { Declaration as LcDeclaration, TokenOrValue } from 'lightningcss'
import { cssColorToString } from './color'

/**
 * The four roles an atom can play in a Tailwind v4 gradient. `from`,
 * `via`, `to` carry a color. `direction` carries one of the 8 stock
 * points (or a bare angle when Tailwind v4's `bg-linear-[angle]`
 * syntax is used).
 */
export type GradientAtomInfo =
  | { readonly role: 'from'; readonly color: string }
  | { readonly role: 'via'; readonly color: string }
  | { readonly role: 'to'; readonly color: string }
  | { readonly role: 'direction'; readonly dir: GradientDirection }

/**
 * Eight stock corner directions Tailwind v4 ships. The transformer
 * maps each to a `(start, end)` pair of unit-square points the
 * expo-linear-gradient API expects. Unknown directions are surfaced as
 * `'unknown'` so the transformer can skip them gracefully.
 */
export type GradientDirection =
  | 'to-r'
  | 'to-l'
  | 'to-t'
  | 'to-b'
  | 'to-tr'
  | 'to-tl'
  | 'to-br'
  | 'to-bl'
  | 'unknown'

/**
 * Inspect a rule's declaration list for `--tw-gradient-*` writes and
 * return the atom's role + data. Returns `null` for rules that don't
 * belong to a gradient utility.
 * @param declarations Declarations from one lightningcss style rule.
 * @returns Gradient info, or null.
 */
function detectGradientAtom(declarations: readonly LcDeclaration[]): GradientAtomInfo | null {
  for (const decl of declarations) {
    if (decl.property !== 'custom') continue
    const custom = decl.value as { name: { name: string } | string; value?: readonly TokenOrValue[] }
    const name = typeof custom.name === 'string' ? custom.name : custom.name.name
    if (!name.startsWith('--tw-gradient-')) continue
    if (name === '--tw-gradient-from') return fromColor('from', custom.value)
    if (name === '--tw-gradient-via') return fromColor('via', custom.value)
    if (name === '--tw-gradient-to') return fromColor('to', custom.value)
    if (name === '--tw-gradient-position') return fromDirection(custom.value)
  }
  return null
}

/**
 * Extract a single color token from a custom-property value list and
 * return the `{role, color}` record. Returns `null` when no color token
 * is present (defensive — Tailwind always emits one, but future output
 * shapes may not).
 * @param role Target role (`from` / `via` / `to`).
 * @param tokens Value tokens from the `--tw-gradient-*` declaration.
 * @returns Gradient info, or null.
 */
function fromColor(role: 'from' | 'via' | 'to', tokens: readonly TokenOrValue[] | undefined): GradientAtomInfo | null {
  if (!tokens) return null
  for (const token of tokens) {
    if (token.type !== 'color') continue
    const color = cssColorToString(token.value as never)
    if (!color) return null
    return { role, color } as GradientAtomInfo
  }
  return null
}

/**
 * Interpret a `--tw-gradient-position` value list as a direction tag.
 * Tailwind emits plain idents (`to`, `right`, `bottom`, …) for the
 * 8 stock corners.
 * @param tokens Value tokens from `--tw-gradient-position`.
 * @returns Direction record, or null when unrecognised.
 */
function fromDirection(tokens: readonly TokenOrValue[] | undefined): GradientAtomInfo | null {
  if (!tokens) return null
  const idents: string[] = []
  for (const token of tokens) {
    if (token.type !== 'token') continue
    if (token.value.type === 'ident') idents.push(token.value.value as string)
  }
  const dir = directionFromIdents(idents)
  if (!dir) return null
  return { role: 'direction', dir }
}

/** Table of Tailwind-space direction idents → compact rnwind tag. */
const DIRECTION_TABLE: Record<string, GradientDirection> = {
  right: 'to-r',
  left: 'to-l',
  top: 'to-t',
  bottom: 'to-b',
  'top-right': 'to-tr',
  'top-left': 'to-tl',
  'bottom-right': 'to-br',
  'bottom-left': 'to-bl',
}

/**
 * Collapse the ident list Tailwind emits (`['to', 'right']`,
 * `['to', 'bottom', 'right']`, etc.) into the compact tag the
 * transformer hoists.
 * @param idents Ident tokens from the declaration value.
 * @returns One of the eight stock directions, `'unknown'`, or null.
 */
function directionFromIdents(idents: readonly string[]): GradientDirection | null {
  if (idents.length === 0) return null
  if (idents[0] !== 'to') return 'unknown'
  // Tailwind v4 appends `in <colourspace>` for colour interpolation
  // (`to right in oklab`). Strip everything from the `in` keyword on
  // — it's irrelevant for the point mapping.
  const inIndex = idents.indexOf('in')
  const rest = idents.slice(1, inIndex === -1 ? idents.length : inIndex)
  if (rest.length === 0 || rest.length > 2) return 'unknown'
  return DIRECTION_TABLE[rest.join('-')] ?? 'unknown'
}

export { detectGradientAtom }
