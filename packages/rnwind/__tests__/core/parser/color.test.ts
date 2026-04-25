import { describe, expect, it } from 'bun:test'
import { cssColorToString } from '../../../src/core/parser/color'

describe('cssColorToString', () => {
  it('passes through SystemColor string keywords', () => {
    expect(cssColorToString('background' as never)).toBe('background')
    expect(cssColorToString('canvas' as never)).toBe('canvas')
  })

  it('rgb integer triple → #rrggbb when alpha=1', () => {
    expect(cssColorToString({ type: 'rgb', r: 255, g: 0, b: 128, alpha: 1 } as never)).toBe('#ff0080')
  })

  it('rgb with alpha<1 → rgba()', () => {
    expect(cssColorToString({ type: 'rgb', r: 10, g: 20, b: 30, alpha: 0.5 } as never)).toBe('rgba(10, 20, 30, 0.5)')
  })

  it('oklch → hex via culori', () => {
    const hex = cssColorToString({ type: 'oklch', l: 0.7, c: 0.2, h: 150, alpha: 1 } as never)
    expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('oklab → hex', () => {
    const hex = cssColorToString({ type: 'oklab', l: 0.5, a: 0.1, b: 0.1, alpha: 1 } as never)
    expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('lab → hex', () => {
    const hex = cssColorToString({ type: 'lab', l: 50, a: 10, b: 10, alpha: 1 } as never)
    expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('lch → hex', () => {
    const hex = cssColorToString({ type: 'lch', l: 50, c: 30, h: 60, alpha: 1 } as never)
    expect(hex).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('lab with alpha<1 → rgba', () => {
    const result = cssColorToString({ type: 'lab', l: 50, a: 10, b: 10, alpha: 0.25 } as never)
    expect(result.startsWith('rgba(')).toBe(true)
  })

  it('srgb color(srgb 1 0 0) → #ff0000', () => {
    expect(cssColorToString({ type: 'srgb', r: 1, g: 0, b: 0, alpha: 1 } as never)).toBe('#ff0000')
  })

  it('display-p3 clamps to sRGB', () => {
    const hex = cssColorToString({ type: 'display-p3', r: 1, g: 0, b: 0, alpha: 1 } as never)
    expect(hex).toBe('#ff0000')
  })

  it('xyz-d50 / xyz-d65 → hex', () => {
    const d50 = cssColorToString({ type: 'xyz-d50', x: 0.5, y: 0.5, z: 0.5, alpha: 1 } as never)
    expect(d50).toMatch(/^#[0-9a-f]{6}$/i)
    const d65 = cssColorToString({ type: 'xyz-d65', x: 0.5, y: 0.5, z: 0.5, alpha: 1 } as never)
    expect(d65).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('currentcolor keyword', () => {
    expect(cssColorToString({ type: 'currentcolor' } as never)).toBe('currentColor')
  })

  it('light-dark picks light variant', () => {
    const result = cssColorToString({
      type: 'light-dark',
      light: { type: 'rgb', r: 255, g: 255, b: 255, alpha: 1 },
      dark: { type: 'rgb', r: 0, g: 0, b: 0, alpha: 1 },
    } as never)
    expect(result).toBe('#ffffff')
  })

  it('unknown discriminant falls back to transparent', () => {
    expect(cssColorToString({ type: 'hwb' } as never)).toBe('transparent')
  })
})
