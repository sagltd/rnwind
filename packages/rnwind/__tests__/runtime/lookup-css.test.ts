import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import {
  __registerAtomsFromRecord,
  __resetLookupCssState,
  loadScheme,
  lookupCss,
  registerAtoms,
  registerSchemeLoader,
  setWindowHeightProvider,
} from '../../src/runtime/lookup-css'
import { ctx } from './_ctx'

afterEach(() => {
  __resetLookupCssState()
})

describe('registerAtoms — per-scheme replacement', () => {
  it('re-registering a scheme surfaces the new value on the next lookup', () => {
    registerAtoms('light', { 'bg-bg': { backgroundColor: '#ffffff' } })
    expect(lookupCss('bg-bg', ctx('light'))).toEqual([{ backgroundColor: '#ffffff' }])

    registerAtoms('light', { 'bg-bg': { backgroundColor: '#ff00ff' } })
    expect(lookupCss('bg-bg', ctx('light'))).toEqual([{ backgroundColor: '#ff00ff' }])
  })

  it('re-registration REPLACES the scheme — atoms no longer present disappear', () => {
    // Re-registration intentionally drops `b` from the scheme. The
    // unknown-atom dev banner would fire on the second lookup and
    // pollute test output; we silence it here because the missing-class
    // behaviour is exactly what this test asserts.
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    registerAtoms('common', { a: { flex: 1 }, b: { padding: 4 } })
    expect(lookupCss('a b', ctx('common'))).toEqual([{ flex: 1 }, { padding: 4 }])

    registerAtoms('common', { a: { flex: 1 } })
    expect(lookupCss('a b', ctx('common'))).toEqual([{ flex: 1 }])
    warn.mockRestore()
  })

  it('scheme lookup falls back to common when the scheme has no own entry', () => {
    registerAtoms('common', { a: { flex: 1 }, b: { padding: 4 } })
    registerAtoms('dark', { a: { flex: 2 } })
    // `a` overridden under dark; `b` falls through to common.
    expect(lookupCss('a b', ctx('dark'))).toEqual([{ flex: 2 }, { padding: 4 }])
  })
})

describe('end-to-end: scheme-prefixed atoms resolve under their target scheme', () => {
  it('dark:opacity-20 → resolves to the dark scheme override via per-scheme build output', async () => {
    const { TailwindParser } = await import('../../src/core/parser')
    const { buildSchemeSources } = await import('../../src/core/style-builder/build-style')
    const parser = new TailwindParser({
      themeCss: `@import 'tailwindcss';
@layer theme {
  :root {
    @variant light { --color-bg: #fff; }
    @variant dark  { --color-bg: #000; }
  }
}`,
    })
    await parser.parseAtoms({ content: '<V className="flex-1" />', extension: 'tsx' })
    const result = await parser.parseAtoms({ content: '<V className="dark:opacity-20" />', extension: 'tsx' })
    const { schemeSources } = buildSchemeSources([...result.atoms.keys()], result.atoms, new Map())

    for (const source of Object.values(schemeSources)) evalAndRegister(source)
    const dark = lookupCss('dark:opacity-20', ctx('dark')) as readonly Record<string, number>[]
    expect(dark).toHaveLength(1)
    expect(dark[0]!.opacity).toBeCloseTo(0.2, 4)
  })
})

describe('lookupCss — input edge cases', () => {
  it('null input returns the empty-styles sentinel (zero alloc)', () => {
    expect(lookupCss(null, ctx('common'))).toEqual([])
  })

  it('undefined input returns the empty-styles sentinel', () => {
    expect(lookupCss(undefined, ctx('common'))).toEqual([])
  })

  it('null input + userStyle returns just the user style', () => {
    expect(lookupCss(null, ctx('common'), { opacity: 0.5 })).toEqual([{ opacity: 0.5 }])
  })

  it('undefined input + userStyle returns just the user style', () => {
    expect(lookupCss(undefined, ctx('common'), { opacity: 0.5 })).toEqual([{ opacity: 0.5 }])
  })

  it('whitespace-only string input returns empty-styles', () => {
    expect(lookupCss('   ', ctx('common'))).toEqual([])
  })

  it('whitespace-only string + userStyle returns just the user style', () => {
    expect(lookupCss('   ', ctx('common'), { opacity: 0.3 })).toEqual([{ opacity: 0.3 }])
  })
})

describe('lookupCss — registry helpers', () => {
  it('loadScheme is a no-op when no manifest loader is registered', () => {
    // No loader → no-op, no throw.
    loadScheme('dark')
    expect(true).toBe(true)
  })

  it('registerSchemeLoader installs a loader that loadScheme delegates to', () => {
    const loader = mock(() => {})
    registerSchemeLoader(loader)
    loadScheme('brand')
    expect(loader).toHaveBeenCalledTimes(1)
    expect(loader).toHaveBeenCalledWith('brand')
    registerSchemeLoader(null) // detach to avoid leakage into other tests
  })

  it('setWindowHeightProvider installs a provider read by safe-area resolution', () => {
    const provider = mock(() => 320)
    setWindowHeightProvider(provider)
    __registerAtomsFromRecord({
      'h-screen-safe': { __safeStyle: [['height', 'screen-minus-y', undefined, undefined]] },
    })
    expect(lookupCss('h-screen-safe', ctx('common', { insets: { top: 50, right: 0, bottom: 30, left: 0 } }))).toEqual([
      { height: 240 }, // 320 - 50 - 30
    ])
    expect(provider).toHaveBeenCalled()
    setWindowHeightProvider(null)
  })
})

describe('lookupCss — userStyle merging on hoisted input', () => {
  it('appends a userStyle after the resolved hoist', () => {
    __registerAtomsFromRecord({ a: { flex: 1 } })
    expect(lookupCss(['a'] as const, ctx('common'), { opacity: 0.5 })).toEqual([{ flex: 1 }, { opacity: 0.5 }])
  })

  it('appends a userStyle after a string input', () => {
    __registerAtomsFromRecord({ a: { flex: 1 } })
    expect(lookupCss('a', ctx('common'), { opacity: 0.5 })).toEqual([{ flex: 1 }, { opacity: 0.5 }])
  })
})

describe('lookupCss preserves source order — last className wins on RN style flatten', () => {
  it('string input: opacity-100 opacity-0 → opacity-0 last (element hidden)', () => {
    __registerAtomsFromRecord({
      'opacity-100': { opacity: 1 },
      'opacity-0': { opacity: 0 },
    })
    expect(lookupCss('opacity-100 opacity-0', ctx('common'))).toEqual([{ opacity: 1 }, { opacity: 0 }])
  })

  it('string input: opacity-0 opacity-100 → opacity-100 last (element visible)', () => {
    __registerAtomsFromRecord({
      'opacity-100': { opacity: 1 },
      'opacity-0': { opacity: 0 },
    })
    expect(lookupCss('opacity-0 opacity-100', ctx('common'))).toEqual([{ opacity: 0 }, { opacity: 1 }])
  })

  it('hoisted input: atom-list preserves source order in the resolved array', () => {
    __registerAtomsFromRecord({
      'opacity-100': { opacity: 1 },
      'opacity-0': { opacity: 0 },
    })
    const hoist = ['opacity-100', 'opacity-0'] as const
    expect(lookupCss(hoist, ctx('common'))).toEqual([{ opacity: 1 }, { opacity: 0 }])
  })

  it('hoisted input returns the same array reference on repeat calls (zero-alloc hot path)', () => {
    __registerAtomsFromRecord({
      'opacity-100': { opacity: 1 },
    })
    const hoist = ['opacity-100'] as const
    const first = lookupCss(hoist, ctx('common'))
    const second = lookupCss(hoist, ctx('common'))
    expect(second).toBe(first)
  })
})

/**
 * Evaluate a generated scheme-style file source against shimmed
 * `react-native` and the real `registerAtoms` so subsequent `lookupCss`
 * calls find the atoms. Strips the file's import lines and forwards
 * bindings into the closure.
 * @param source Scheme-style source returned by `buildSchemeSources`.
 */
function evalAndRegister(source: string): void {
  const body = source
    .replace(/import \{ StyleSheet \} from 'react-native'\s*\n/, '')
    .replace(/import \{ [^}]+ \} from 'rnwind'\s*\n/, '')
  // eslint-disable-next-line sonarjs/code-eval
  new Function('StyleSheet', 'registerAtoms', body)({ create: <T>(map: T): T => map, hairlineWidth: 1 }, registerAtoms)
}
