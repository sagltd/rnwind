import { describe, expect, it } from 'bun:test'
import { buildSchemeSources } from '../../../src/core/style-builder/build-style'
import type { SchemedStyle } from '../../../src/core/parser'

/**
 * Repro for the user-visible bug "per scheme variants not work":
 *
 *   <View className="light:bg-sky-200 dark:bg-indigo-800 brand:bg-fuchsia-700" />
 *
 * Each variant rule lands in the parser as a schemed bucket with
 * `base` empty and exactly one scheme populated — Tailwind's
 * `light:` / `dark:` / `brand:` selectors only match when that scheme
 * is active.
 *
 * The build used to hoist the canonical (= the lone non-empty scheme's
 * value) into `common`. At runtime `lookupAtom(scheme, atom)` falls
 * through to common when the scheme's own table doesn't carry the
 * atom — so a `light:`-gated atom resolved to its light value even
 * under `dark` / `brand`. The bug surfaced as "all per-scheme atoms
 * apply in every scheme" → the last per-scheme atom in source order
 * stomped the others.
 *
 * Fix contract: an atom whose `base` bucket is empty is scheme-gated;
 * it must only appear in the variant files where it actually applies,
 * never in `common.style.js`.
 */
describe('buildSchemeSources — scheme-gated (base-less) atoms', () => {
  it('a `light:` atom registers only in light.style.js, not common', () => {
    const { schemeSources } = buildSchemeSources(
      ['light:bg-sky-200'],
      new Map<string, SchemedStyle>([
        ['light:bg-sky-200', { light: { backgroundColor: '#b8e6fe' } }],
      ]),
      new Map(),
    )
    expect(schemeSources.common).not.toContain('light:bg-sky-200')
    expect(schemeSources.light).toContain('"light:bg-sky-200":')
    expect(schemeSources.light).toContain('"#b8e6fe"')
  })

  it('a `dark:` atom registers only in dark.style.js, not common', () => {
    const { schemeSources } = buildSchemeSources(
      ['dark:bg-indigo-800'],
      new Map<string, SchemedStyle>([
        ['dark:bg-indigo-800', { dark: { backgroundColor: '#3730a3' } }],
      ]),
      new Map(),
    )
    expect(schemeSources.common).not.toContain('dark:bg-indigo-800')
    expect(schemeSources.dark).toContain('"dark:bg-indigo-800":')
    expect(schemeSources.dark).toContain('"#3730a3"')
  })

  it('three sibling per-scheme atoms each land only in their own variant', () => {
    const { schemeSources } = buildSchemeSources(
      ['light:bg-sky-200', 'dark:bg-indigo-800', 'brand:bg-fuchsia-700'],
      new Map<string, SchemedStyle>([
        ['light:bg-sky-200', { light: { backgroundColor: '#b8e6fe' } }],
        ['dark:bg-indigo-800', { dark: { backgroundColor: '#3730a3' } }],
        ['brand:bg-fuchsia-700', { brand: { backgroundColor: '#a21caf' } }],
      ]),
      new Map(),
    )
    expect(schemeSources.common).not.toContain('light:bg-sky-200')
    expect(schemeSources.common).not.toContain('dark:bg-indigo-800')
    expect(schemeSources.common).not.toContain('brand:bg-fuchsia-700')
    expect(schemeSources.light).toContain('"light:bg-sky-200":')
    expect(schemeSources.dark).toContain('"dark:bg-indigo-800":')
    expect(schemeSources.brand).toContain('"brand:bg-fuchsia-700":')
  })

  it('themed atoms (with a `base` value) keep the canonical hoist into common', () => {
    const { schemeSources } = buildSchemeSources(
      ['bg-primary'],
      new Map<string, SchemedStyle>([
        ['bg-primary', { base: { backgroundColor: '#6366f1' }, dark: { backgroundColor: '#f8fafc' } }],
      ]),
      new Map(),
    )
    // Sanity: regression guard for the existing themed-atom path.
    expect(schemeSources.common).toContain('"bg-primary":')
    expect(schemeSources.common).toContain('"#6366f1"')
    expect(schemeSources.dark).toContain('"bg-primary":')
    expect(schemeSources.dark).toContain('"#f8fafc"')
  })
})
