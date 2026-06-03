import { describe, expect, it } from 'bun:test'
import { buildSchemeSources } from '../../../src/core/style-builder/build-style'
import type { SchemedStyle } from '../../../src/core/parser'

describe('buildSchemeSources — per-scheme files + manifest', () => {
  it('emits a registerAtoms call per scheme keyed by the scheme name', () => {
    const { schemeSources } = buildSchemeSources(
      ['flex-1', 'p-4'],
      new Map<string, SchemedStyle>([
        ['flex-1', { base: { flex: 1 } }],
        ['p-4', { base: { padding: 16 } }],
      ]),
      new Map(),
    )
    expect(schemeSources.common).toContain(`registerAtoms("common", {`)
    expect(schemeSources.common).toContain('"flex-1":')
    expect(schemeSources.common).toContain('"p-4":')
  })

  it('uniform atoms live in common only — variant files stay empty for them', () => {
    const { schemeSources, variants } = buildSchemeSources(
      ['flex-1', 'bg-primary'],
      new Map<string, SchemedStyle>([
        ['flex-1', { base: { flex: 1 } }],
        ['bg-primary', { base: { backgroundColor: '#6366f1' }, light: { backgroundColor: '#0a0a0a' }, dark: { backgroundColor: '#f8fafc' } }],
      ]),
      new Map(),
    )
    expect(variants).toEqual(['dark', 'light'])
    // flex-1 only appears in common
    expect(schemeSources.common).toContain('"flex-1":')
    expect(schemeSources.dark).not.toContain('"flex-1"')
    expect(schemeSources.light).not.toContain('"flex-1"')
  })

  it('variant files emit only atoms whose own value differs from canonical', () => {
    const { schemeSources } = buildSchemeSources(
      ['bg-primary'],
      new Map<string, SchemedStyle>([
        ['bg-primary', { base: { backgroundColor: '#6366f1' }, light: { backgroundColor: '#0a0a0a' }, dark: { backgroundColor: '#f8fafc' } }],
      ]),
      new Map(),
    )
    expect(schemeSources.common).toContain('"#6366f1"')
    expect(schemeSources.light).toContain('"#0a0a0a"')
    expect(schemeSources.dark).toContain('"#f8fafc"')
  })

  it('variants that inherit (empty scheme entry) skip the atom entirely in their file', () => {
    const { schemeSources } = buildSchemeSources(
      ['bg-primary'],
      new Map<string, SchemedStyle>([
        ['bg-primary', { base: { backgroundColor: '#6366f1' }, dark: {} }],
      ]),
      new Map(),
    )
    expect(schemeSources.common).toContain('"#6366f1"')
    expect(schemeSources.dark).not.toContain('bg-primary')
  })

  it('atom values carry NO __state wrapper — gating is hoist-side', () => {
    const { schemeSources } = buildSchemeSources(
      ['active:bg-sky-700'],
      new Map<string, SchemedStyle>([
        ['active:bg-sky-700', { base: { backgroundColor: '#0069a8' }, __state: 'active' } as unknown as SchemedStyle],
      ]),
      new Map(),
    )
    expect(schemeSources.common).not.toContain('__state')
    expect(schemeSources.common).toContain('"active:bg-sky-700":')
    expect(schemeSources.common).toContain('"#0069a8"')
  })

  it('safe-area atoms emit a {__safeStyle: [[cssKey, sideTag, or, offset], ...]} envelope — precomputed at build time', () => {
    const { schemeSources } = buildSchemeSources(
      ['pt-safe', 'pt-safe-or-4'],
      new Map<string, SchemedStyle>([
        ['pt-safe', { base: { paddingTop: { __safe: 't' } } }],
        ['pt-safe-or-4', { base: { paddingTop: { __safe: 't', or: 16 } } }],
      ]),
      new Map(),
    )
    expect(schemeSources.common).not.toContain('"__safe":"t"')
    expect(schemeSources.common).toContain('"__safeStyle":[["paddingTop","t",null,null]]')
    expect(schemeSources.common).toContain('"__safeStyle":[["paddingTop","t",16,null]]')
  })

  it('hairline atoms inline `StyleSheet.hairlineWidth` and import StyleSheet', () => {
    const { schemeSources } = buildSchemeSources(
      ['border-hairline', 'h-hairline'],
      new Map<string, SchemedStyle>([
        ['border-hairline', { base: { borderWidth: 0.000_976_562_5 } }],
        ['h-hairline', { base: { height: 0.000_976_562_5 } }],
      ]),
      new Map(),
    )
    expect(schemeSources.common).not.toContain('0.0009765625')
    expect(schemeSources.common).toContain('StyleSheet.hairlineWidth')
    expect(schemeSources.common).toContain(`import { StyleSheet } from 'react-native'`)
  })

  it('non-hairline projects skip the StyleSheet import entirely', () => {
    const { schemeSources } = buildSchemeSources(
      ['p-4'],
      new Map<string, SchemedStyle>([['p-4', { base: { padding: 16 } }]]),
      new Map(),
    )
    expect(schemeSources.common).not.toContain(`from 'react-native'`)
    expect(schemeSources.common).not.toContain('StyleSheet.hairlineWidth')
  })

  it('never emits StyleSheet.create — every atom value is an inline literal', () => {
    const { schemeSources } = buildSchemeSources(
      ['flex-1', 'border-hairline'],
      new Map<string, SchemedStyle>([
        ['flex-1', { base: { flex: 1 } }],
        ['border-hairline', { base: { borderWidth: 0.000_976_562_5 } }],
      ]),
      new Map(),
    )
    expect(schemeSources.common).not.toContain('StyleSheet.create')
  })

  it('keyframes are inlined directly into atom values via animationName — no separate register call', () => {
    const keyframes = new Map([
      [
        'spin',
        { name: 'spin', steps: [{ offset: 'from', style: { transform: '0deg' } }, { offset: 'to', style: { transform: '360deg' } }] },
      ],
    ])
    const { schemeSources } = buildSchemeSources(
      ['animate-spin'],
      new Map<string, SchemedStyle>([['animate-spin', { base: { animationName: 'spin' } }]]),
      keyframes,
    )
    expect(schemeSources.common).not.toContain('registerKeyframes')
    expect(schemeSources.common).toContain(`import { registerAtoms } from 'rnwind'`)
    expect(schemeSources.common).toContain('"0%"')
    expect(schemeSources.common).toContain('"100%"')
    expect(schemeSources.common).toContain('"transform":"360deg"')
  })

  // Regression: production parser fills every variant bucket in Phase 1
  // (no base) for scheme-independent atoms like `flex`, `p-4`, `absolute`.
  // Before the fix those atoms got duplicated into every per-scheme file
  // instead of landing in common. The variant-prefix check below is what
  // keeps a real scheme-gated atom (`dark:bg-indigo-800`) out of common.
  it('scheme-independent atoms with no base bucket but identical values across every variant collapse into common', () => {
    const { schemeSources } = buildSchemeSources(
      ['flex', 'p-4', 'absolute', 'bg-card'],
      new Map<string, SchemedStyle>([
        ['flex', { light: { display: 'flex' }, dark: { display: 'flex' } }],
        ['p-4', { light: { padding: 16 }, dark: { padding: 16 } }],
        ['absolute', { light: { position: 'absolute' }, dark: { position: 'absolute' } }],
        ['bg-card', { light: { backgroundColor: '#fff' }, dark: { backgroundColor: '#000' } }],
      ]),
      new Map(),
    )
    expect(schemeSources.common).toContain('"flex":')
    expect(schemeSources.common).toContain('"p-4":')
    expect(schemeSources.common).toContain('"absolute":')
    expect(schemeSources.dark).not.toContain('"flex":')
    expect(schemeSources.light).not.toContain('"flex":')
    expect(schemeSources.dark).not.toContain('"p-4":')
    expect(schemeSources.light).not.toContain('"p-4":')
    // bg-card's per-scheme values diverge → both schemes still emit, common does NOT.
    expect(schemeSources.common).not.toContain('"bg-card":')
    expect(schemeSources.light).toContain('"bg-card":')
    expect(schemeSources.dark).toContain('"bg-card":')
  })

  it('atoms whose every scheme is empty are dropped entirely', () => {
    const { schemeSources } = buildSchemeSources(
      ['empty-atom'],
      new Map<string, SchemedStyle>([['empty-atom', { base: {}, dark: {} }]]),
      new Map(),
    )
    expect(schemeSources.common).not.toContain('empty-atom')
  })
})

describe('buildSchemeSources — dedup across 4 themes', () => {
  /*
   * Fixture: four variant schemes (`amber`, `dark`, `light`, `teal`) plus
   * the synthetic `base`. Each atom exercises a different share-pattern
   * across the four variants so the dedup rule is observable:
   *
   *  - `flex-1`      → shared across ALL schemes (uniform). Must land
   *                    in common only; every variant file skips it.
   *  - `shadow-sm`   → shared across 3 schemes (amber/dark/light);
   *                    `teal` differs. Common carries the majority
   *                    value; only `teal.style.js` emits the override.
   *  - `bg-card`     → 2-of-4 split — amber+light identical, dark+teal
   *                    identical. Common carries the `base` canonical;
   *                    the two schemes whose value differs emit their
   *                    own entry.
   *  - `bg-primary`  → every scheme has a unique value. Common carries
   *                    the canonical (base); every variant emits its
   *                    own override.
   */
  const atomNames = ['bg-card', 'bg-primary', 'flex-1', 'shadow-sm']
  const resolved = new Map<string, SchemedStyle>([
    [
      'flex-1',
      {
        base: { flex: 1 },
        light: { flex: 1 },
        dark: { flex: 1 },
        amber: { flex: 1 },
        teal: { flex: 1 },
      },
    ],
    [
      'shadow-sm',
      {
        base: { shadowOpacity: 0.05 },
        light: { shadowOpacity: 0.05 },
        dark: { shadowOpacity: 0.05 },
        amber: { shadowOpacity: 0.05 },
        teal: { shadowOpacity: 0.4 },
      },
    ],
    [
      'bg-card',
      {
        base: { backgroundColor: '#f0f0f0' },
        light: { backgroundColor: '#f0f0f0' },
        amber: { backgroundColor: '#f0f0f0' },
        dark: { backgroundColor: '#101010' },
        teal: { backgroundColor: '#101010' },
      },
    ],
    [
      'bg-primary',
      {
        base: { backgroundColor: '#6366f1' },
        light: { backgroundColor: '#6366f1' },
        dark: { backgroundColor: '#818cf8' },
        amber: { backgroundColor: '#f59e0b' },
        teal: { backgroundColor: '#14b8a6' },
      },
    ],
  ])

  it('uniform atom lives in common only — every variant file omits it', () => {
    const { schemeSources } = buildSchemeSources(atomNames, resolved, new Map())
    expect(schemeSources.common).toContain('"flex-1"')
    expect(schemeSources.amber).not.toContain('flex-1')
    expect(schemeSources.dark).not.toContain('flex-1')
    expect(schemeSources.light).not.toContain('flex-1')
    expect(schemeSources.teal).not.toContain('flex-1')
  })

  it('3-of-4 shared atom: majority value in common, only the diverging variant emits', () => {
    const { schemeSources } = buildSchemeSources(atomNames, resolved, new Map())
    expect(schemeSources.common).toContain('"shadow-sm"')
    expect(schemeSources.common).toContain('"shadowOpacity":0.05')
    expect(schemeSources.amber).not.toContain('shadow-sm')
    expect(schemeSources.dark).not.toContain('shadow-sm')
    expect(schemeSources.light).not.toContain('shadow-sm')
    expect(schemeSources.teal).toContain('"shadow-sm"')
    expect(schemeSources.teal).toContain('"shadowOpacity":0.4')
  })

  it('2-of-4 split: canonical lives in common; only variants whose value differs emit', () => {
    const { schemeSources } = buildSchemeSources(atomNames, resolved, new Map())
    expect(schemeSources.common).toContain('"bg-card"')
    expect(schemeSources.common).toContain('"#f0f0f0"')
    // light + amber match canonical — skipped.
    expect(schemeSources.light).not.toContain('bg-card')
    expect(schemeSources.amber).not.toContain('bg-card')
    // dark + teal diverge — both emit the override value.
    expect(schemeSources.dark).toContain('"bg-card"')
    expect(schemeSources.dark).toContain('"#101010"')
    expect(schemeSources.teal).toContain('"bg-card"')
    expect(schemeSources.teal).toContain('"#101010"')
  })

  it('fully distinct atom: common holds canonical; every variant with a different value emits its own', () => {
    const { schemeSources } = buildSchemeSources(atomNames, resolved, new Map())
    expect(schemeSources.common).toContain('"#6366f1"')
    expect(schemeSources.light).not.toContain('bg-primary') // light === base
    expect(schemeSources.dark).toContain('"#818cf8"')
    expect(schemeSources.amber).toContain('"#f59e0b"')
    expect(schemeSources.teal).toContain('"#14b8a6"')
  })

  it('never duplicates the same value across common and a variant', () => {
    const { schemeSources } = buildSchemeSources(atomNames, resolved, new Map())
    // The canonical color for bg-primary appears exactly once in the
    // whole bundle (in common) — no variant file carries the same
    // literal.
    const canonical = '"#6366f1"'
    const total =
      (schemeSources.common.match(new RegExp(canonical, 'g')) ?? []).length +
      (schemeSources.light.match(new RegExp(canonical, 'g')) ?? []).length +
      (schemeSources.dark.match(new RegExp(canonical, 'g')) ?? []).length +
      (schemeSources.amber.match(new RegExp(canonical, 'g')) ?? []).length +
      (schemeSources.teal.match(new RegExp(canonical, 'g')) ?? []).length
    expect(total).toBe(1)
  })

  it('variants list is sorted and excludes `base` + `common`', () => {
    const { variants } = buildSchemeSources(atomNames, resolved, new Map())
    expect(variants).toEqual(['amber', 'dark', 'light', 'teal'])
  })
})

describe('buildSchemeSources — manifest module', () => {
  it('eager-imports common.style AND every variant scheme (no lazy require)', () => {
    const { manifestSource, variants } = buildSchemeSources(
      ['bg-primary'],
      new Map<string, SchemedStyle>([
        ['bg-primary', { base: { backgroundColor: '#6366f1' }, dark: { backgroundColor: '#818cf8' } }],
      ]),
      new Map(),
    )
    expect(variants).toEqual(['dark'])
    expect(manifestSource).toContain(`import './common.style'`)
    // Eager import — every scheme registers when the manifest evaluates, so
    // a cold start never falls back to common before the variant loads.
    expect(manifestSource).toContain(`import "./dark.style"`)
    expect(manifestSource).not.toContain('require(')
    expect(manifestSource).not.toContain('LOADERS')
    expect(manifestSource).toContain('export { ensureSchemeLoaded }')
    expect(manifestSource).toContain('registerSchemeLoader(ensureSchemeLoaded)')
  })

  it('no variants → manifest ships a no-op ensureSchemeLoaded', () => {
    const { manifestSource, variants } = buildSchemeSources(
      ['flex-1'],
      new Map<string, SchemedStyle>([['flex-1', { base: { flex: 1 } }]]),
      new Map(),
    )
    expect(variants).toEqual([])
    expect(manifestSource).toContain(`import './common.style'`)
    expect(manifestSource).toContain(`function ensureSchemeLoaded(_name) {}`)
  })
})
