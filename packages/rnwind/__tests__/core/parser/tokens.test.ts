import { describe, expect, it } from 'bun:test'
import {
  coerceUnparsedValue,
  serializeRawToken,
  serializeToken,
  serializeTokens,
  substituteThemeVars,
} from '../../../src/core/parser/tokens'

describe('serializeToken — TokenOrValue variants', () => {
  it('token wrapper dispatches to serializeRawToken', () => {
    expect(serializeToken({ type: 'token', value: { type: 'ident', value: 'flex' } } as never)).toBe('flex')
  })

  it('length passes value + unit', () => {
    expect(serializeToken({ type: 'length', value: { value: 1, unit: 'rem' } } as never)).toBe('1rem')
  })

  it('dashed-ident', () => {
    expect(serializeToken({ type: 'dashed-ident', value: '--foo' } as never)).toBe('--foo')
  })

  it('angle / time / resolution get serialized', () => {
    expect(serializeToken({ type: 'angle', value: { type: 'deg', value: 45 } } as never)).toBe('45deg')
    expect(serializeToken({ type: 'time', value: { type: 'milliseconds', value: 200 } } as never)).toBe('200ms')
    expect(serializeToken({ type: 'time', value: { type: 'seconds', value: 1 } } as never)).toBe('1s')
    expect(serializeToken({ type: 'resolution', value: { type: 'dpi', value: 96 } } as never)).toBe('96dpi')
  })

  it('var() with and without fallback', () => {
    expect(
      serializeToken({
        type: 'var',
        value: { name: { ident: '--x' }, fallback: [] },
      } as never),
    ).toBe('var(--x)')
    expect(
      serializeToken({
        type: 'var',
        value: {
          name: { ident: '--x' },
          fallback: [{ type: 'token', value: { type: 'dimension', value: 4, unit: 'px' } }],
        },
      } as never),
    ).toBe('var(--x, 4px)')
  })

  it('function with args', () => {
    expect(
      serializeToken({
        type: 'function',
        value: { name: 'calc', arguments: [{ type: 'token', value: { type: 'number', value: 1.5 } }] },
      } as never),
    ).toBe('calc(1.5)')
  })

  it('color tokens render to RN-compatible color string', () => {
    expect(serializeToken({ type: 'color', value: { type: 'rgb', r: 255, g: 0, b: 0, alpha: 1 } } as never)).toBe('#ff0000')
  })

  it('unknown / env / url / animation-name → empty', () => {
    expect(serializeToken({ type: 'env' } as never)).toBe('')
    expect(serializeToken({ type: 'animation-name' } as never)).toBe('')
    expect(serializeToken({ type: 'never-heard-of' } as never)).toBe('')
  })
})

describe('serializeRawToken', () => {
  it('hash / id-hash', () => {
    expect(serializeRawToken({ type: 'hash', value: 'abc' } as never)).toBe('#abc')
    expect(serializeRawToken({ type: 'id-hash', value: 'foo' } as never)).toBe('#foo')
  })
  it('number / percentage / dimension', () => {
    expect(serializeRawToken({ type: 'number', value: 42 } as never)).toBe('42')
    expect(serializeRawToken({ type: 'percentage', value: 0.5 } as never)).toBe('50%')
    expect(serializeRawToken({ type: 'dimension', value: 2, unit: 'rem' } as never)).toBe('2rem')
  })
  it('delim / comma / white-space', () => {
    expect(serializeRawToken({ type: 'delim', value: '+' } as never)).toBe('+')
    expect(serializeRawToken({ type: 'comma' } as never)).toBe(',')
    expect(serializeRawToken({ type: 'white-space' } as never)).toBe(' ')
  })
  it('ident family', () => {
    expect(serializeRawToken({ type: 'ident', value: 'auto' } as never)).toBe('auto')
    expect(serializeRawToken({ type: 'at-keyword', value: 'media' } as never)).toBe('media')
    expect(serializeRawToken({ type: 'string', value: 'hi' } as never)).toBe('hi')
    expect(serializeRawToken({ type: 'unquoted-url', value: '/foo.png' } as never)).toBe('/foo.png')
    expect(serializeRawToken({ type: 'function', value: 'calc' } as never)).toBe('calc')
  })
  it('skipped tokens → empty', () => {
    expect(serializeRawToken({ type: 'colon' } as never)).toBe('')
    expect(serializeRawToken({ type: 'semicolon' } as never)).toBe('')
    expect(serializeRawToken({ type: 'comment' } as never)).toBe('')
    expect(serializeRawToken({ type: 'bad-url' } as never)).toBe('')
    expect(serializeRawToken({ type: 'out-of-scope' } as never)).toBe('')
  })
})

describe('serializeTokens', () => {
  it('joins token list', () => {
    expect(
      serializeTokens([
        { type: 'token', value: { type: 'number', value: 1 } },
        { type: 'token', value: { type: 'white-space', value: ' ' } },
        { type: 'token', value: { type: 'ident', value: 'solid' } },
      ] as never),
    ).toBe('1 solid')
  })
})

describe('coerceUnparsedValue', () => {
  it('empty / whitespace → null', () => {
    expect(coerceUnparsedValue('')).toBeNull()
    expect(coerceUnparsedValue('   ')).toBeNull()
  })
  it('bare numbers', () => {
    expect(coerceUnparsedValue('42')).toBe(42)
    expect(coerceUnparsedValue('-3.14')).toBe(-3.14)
  })
  it('px lengths', () => {
    expect(coerceUnparsedValue('16px')).toBe(16)
  })
  it('rem lengths', () => {
    expect(coerceUnparsedValue('1.5rem')).toBe(24)
  })
  it('var fallback recursion', () => {
    expect(coerceUnparsedValue('var(--x, 8px)')).toBe(8)
  })
  it('calc ratio', () => {
    expect(coerceUnparsedValue('calc(10 / 2)')).toBe(5)
  })
  it('calc ratio with zero denominator → null', () => {
    expect(coerceUnparsedValue('calc(10 / 0)')).toBeNull()
  })
  it('calc multiply with rem unit', () => {
    expect(coerceUnparsedValue('calc(0.5rem * 2)')).toBe(16)
  })
  it('calc multiply without unit', () => {
    expect(coerceUnparsedValue('calc(2 * 3)')).toBe(6)
  })
  it('unrecognized passes through as string', () => {
    expect(coerceUnparsedValue('solid')).toBe('solid')
  })
})

describe('substituteThemeVars', () => {
  it('replaces var() refs from table', () => {
    expect(substituteThemeVars('var(--x) 2px', new Map([['--x', '8px']]))).toBe('8px 2px')
  })
  it('uses fallback when var is missing', () => {
    expect(substituteThemeVars('var(--missing, 4px)', new Map())).toBe('4px')
  })
  it('keeps var() unchanged when no lookup and no fallback', () => {
    expect(substituteThemeVars('var(--missing)', new Map())).toBe('var(--missing)')
  })
  it('resolves multi-hop var references to a fixed point', () => {
    const table = new Map([
      ['--a', 'var(--b)'],
      ['--b', 'var(--c)'],
      ['--c', '4rem'],
    ])
    expect(substituteThemeVars('var(--a)', table)).toBe('4rem')
  })
  it('handles unbalanced parens by passing through the raw text', () => {
    expect(substituteThemeVars('var(--x', new Map())).toBe('var(--x')
  })
})
