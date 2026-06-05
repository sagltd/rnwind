import { afterEach, describe, expect, it } from 'bun:test'
import {
  __resetResolveState,
  __resolveCacheStats,
  normalizeClassName,
  registerGradients,
  registerHaptics,
  registerMolecules,
  resolve,
} from '../../src/runtime/resolve'
import { __registerAtomsFromRecord, __resetLookupCssState, registerAtoms, registerBreakpoints } from '../../src/runtime/lookup-css'
import { ctx } from './_ctx'

afterEach(() => {
  __resetResolveState()
  __resetLookupCssState()
})

describe('normalizeClassName', () => {
  it('trims, collapses whitespace, drops exact dups, preserves order', () => {
    expect(normalizeClassName('  px-2   bg-primary px-2 ')).toBe('px-2 bg-primary')
  })
  it('does NOT sort (last-wins order must survive)', () => {
    expect(normalizeClassName('p-4 p-2')).toBe('p-4 p-2')
    expect(normalizeClassName('p-2 p-4')).toBe('p-2 p-4')
  })
})

describe('resolve — molecule fast path', () => {
  it('returns the pre-merged molecule object BY REFERENCE, cached across calls', () => {
    const MOLECULE = { paddingHorizontal: 8, backgroundColor: '#4f46e5' }
    registerMolecules('common', { 'px-2 bg-primary': MOLECULE })
    const a = resolve('px-2 bg-primary', ctx('common'))
    const b = resolve('bg-primary px-2 px-2', ctx('common')) // normalizes to same key… order differs → different molecule
    expect(a.style).toBe(MOLECULE) // exact reference, no array, no merge
    // second identical call → same cached result reference
    expect(resolve('px-2 bg-primary', ctx('common'))).toBe(a)
    // different token order is a DIFFERENT molecule key (correct) → miss → atom fallback
    expect(b.style).not.toBe(MOLECULE)
  })

  it('per-scheme: picks the molecule for the active scheme, falls back to common', () => {
    registerMolecules('light', { 'bg-bg': { backgroundColor: '#ffffff' } })
    registerMolecules('dark', { 'bg-bg': { backgroundColor: '#0a0a0a' } })
    expect((resolve('bg-bg', ctx('light')).style as Record<string, unknown>).backgroundColor).toBe('#ffffff')
    expect((resolve('bg-bg', ctx('dark')).style as Record<string, unknown>).backgroundColor).toBe('#0a0a0a')
  })
})

describe('resolve — atom fallback (unseen / dynamic strings)', () => {
  it('falls back to per-atom resolution, merged into ONE runtime-molecule object', () => {
    __registerAtomsFromRecord({ 'flex-1': { flex: 1 }, 'p-4': { padding: 16 } })
    const result = resolve('flex-1 p-4', ctx('common'))
    // Atom array flattened to a single object — same shape as a build molecule.
    expect(result.style).toEqual({ flex: 1, padding: 16 })
  })

  it('returns the SAME merged object by reference across calls (cached)', () => {
    __registerAtomsFromRecord({ 'flex-1': { flex: 1 }, 'p-4': { padding: 16 } })
    const a = resolve('flex-1 p-4', ctx('common'))
    const b = resolve('flex-1 p-4', ctx('common'))
    expect(b.style).toBe(a.style)
  })
})

describe('resolve — cache bounding', () => {
  it('keys on the numeric breakpoint tier, not raw windowWidth (same tier → same cached object)', () => {
    registerBreakpoints({ sm: 640, md: 768 })
    __registerAtomsFromRecord({ 'p-4': { padding: 16 } })
    const narrow = resolve('p-4', ctx('common', { windowWidth: 320 }))
    const wide = resolve('p-4', ctx('common', { windowWidth: 414 }))
    expect(wide.style).toBe(narrow.style) // both tier 0 → cache hit
    const md = resolve('p-4', ctx('common', { windowWidth: 800 }))
    expect(md.style).not.toBe(narrow.style) // tier 2 → distinct entry
  })

  it('does NOT serve a stale style across the SMALLEST breakpoint threshold (rotate bug)', () => {
    registerBreakpoints({ sm: 640 })
    // p-1 always; sm:p-2 only when width >= 640.
    registerAtoms('common', { 'p-1': { padding: 4 }, 'sm:p-2': { padding: 8 } })
    // Resolve WIDE first (tier 1, sm active → padding 8), caching it.
    const wide = resolve('p-1 sm:p-2', ctx('common', { windowWidth: 700 }))
    expect((wide.style as Record<string, unknown>).padding).toBe(8)
    // Then NARROW (tier 0, sm off → padding 4). The clamped activeBreakpoint
    // NAME would collide here ('sm' for both) and replay the stale 8.
    const narrow = resolve('p-1 sm:p-2', ctx('common', { windowWidth: 320 }))
    expect((narrow.style as Record<string, unknown>).padding).toBe(4)
  })

  it('bulk-evicts so the cache never exceeds its ceiling (memoisation, recompute on miss)', () => {
    __registerAtomsFromRecord({ 'p-4': { padding: 16 } })
    const { max } = __resolveCacheStats()
    for (let index = 0; index < max + 500; index += 1) {
      // Each distinct className is its own key; only `p-4` is a known atom.
      resolve(`p-4 c-${index}`, ctx('common'))
    }
    const { size } = __resolveCacheStats()
    expect(size).toBeLessThanOrEqual(max)
    // An evicted-then-re-resolved className still returns the correct style.
    expect(resolve('p-4 c-0', ctx('common')).style).toEqual({ padding: 16 })
  })
})

describe('resolve — inline style wins', () => {
  it('appends userStyle last over a molecule', () => {
    registerMolecules('common', { 'p-1': { padding: 4 } })
    const result = resolve('p-1', ctx('common'), { padding: 99 })
    const flat = Object.assign({}, ...(result.style as Array<Record<string, unknown>>))
    expect(flat.padding).toBe(99)
  })
})

describe('resolve — features', () => {
  it('surfaces gradient colors/start/end from the gradient registry', () => {
    registerGradients({
      'bg-linear-to-r': { role: 'direction', dir: 'to-r' },
      'from-red-500': { role: 'from', color: '#ef4444' },
      'to-blue-500': { role: 'to', color: '#3b82f6' },
    })
    const result = resolve('bg-linear-to-r from-red-500 to-blue-500', ctx('common'))
    expect(result.colors).toEqual(['#ef4444', '#3b82f6'])
    expect(result.start).toEqual({ x: 0, y: 0.5 })
    expect(result.end).toEqual({ x: 1, y: 0.5 })
  })

  it('surfaces haptic requests with the right trigger', () => {
    registerHaptics({
      'haptic-light': { kind: 'impact', style: 'Light' },
      'active:haptic-medium': { kind: 'impact', style: 'Medium' },
    })
    const result = resolve('haptic-light active:haptic-medium', ctx('common'))
    expect(result.haptics).toEqual([
      { request: { kind: 'impact', style: 'Light' }, trigger: 'mount' },
      { request: { kind: 'impact', style: 'Medium' }, trigger: 'pressIn' },
    ])
  })

  it('surfaces truncate props syntactically', () => {
    expect(resolve('truncate', ctx('common'))).toMatchObject({ numberOfLines: 1, ellipsizeMode: 'tail' })
    expect(resolve('line-clamp-3', ctx('common'))).toMatchObject({ numberOfLines: 3 })
  })

  it('does NOT warn "unknown class" for feature-only tokens (haptic / gradient / truncate)', () => {
    registerHaptics({ 'active:haptic-rigid': { kind: 'impact', style: 'Rigid' } })
    registerGradients({ 'bg-linear-to-r': { role: 'direction', dir: 'to-r' } })
    __registerAtomsFromRecord({ 'px-4': { paddingHorizontal: 16 } })
    const warnings: string[] = []
    /* eslint-disable no-console */
    const original = console.warn
    console.warn = (...args: unknown[]): void => {
      warnings.push(String(args[0]))
    }
    try {
      // Style atom resolves; the feature tokens are filtered OUT of the atom
      // lookup so they never hit the unknown-class warning path.
      resolve('px-4 active:haptic-rigid bg-linear-to-r truncate', ctx('common'))
    } finally {
      console.warn = original
    }
    /* eslint-enable no-console */
    expect(warnings.some((line) => line.includes('unknown class'))).toBe(false)
  })
})
