import { describe, expect, it } from 'bun:test'
import { dispatchTypographyDeclaration } from '../../../src/core/parser/typography-dispatcher'

describe('dispatchTypographyDeclaration', () => {
  it('returns null for unrelated properties', () => {
    expect(dispatchTypographyDeclaration({ property: 'color' } as never)).toBeNull()
  })

  it('text-align', () => {
    expect(dispatchTypographyDeclaration({ property: 'text-align', value: 'center' } as never)).toEqual([['textAlign', 'center']])
  })

  it('text-transform', () => {
    expect(dispatchTypographyDeclaration({ property: 'text-transform', value: { case: 'uppercase' } } as never)).toEqual([
      ['textTransform', 'uppercase'],
    ])
    expect(dispatchTypographyDeclaration({ property: 'text-transform', value: {} } as never)).toEqual([['textTransform', 'none']])
  })

  it('text-decoration-line — none / string / array / unknown', () => {
    expect(dispatchTypographyDeclaration({ property: 'text-decoration-line', value: 'none' } as never)).toEqual([
      ['textDecorationLine', 'none'],
    ])
    expect(dispatchTypographyDeclaration({ property: 'text-decoration-line', value: 'underline' } as never)).toEqual([
      ['textDecorationLine', 'underline'],
    ])
    expect(
      dispatchTypographyDeclaration({ property: 'text-decoration-line', value: ['underline', 'line-through'] } as never),
    ).toEqual([['textDecorationLine', 'underline line-through']])
    expect(dispatchTypographyDeclaration({ property: 'text-decoration-line', value: 42 } as never)).toEqual([])
  })

  it('aspect-ratio — auto / ratio / missing', () => {
    expect(dispatchTypographyDeclaration({ property: 'aspect-ratio', value: { auto: true } } as never)).toEqual([])
    expect(dispatchTypographyDeclaration({ property: 'aspect-ratio', value: { auto: false, ratio: [16, 9] } } as never)).toEqual([
      ['aspectRatio', 16 / 9],
    ])
    expect(dispatchTypographyDeclaration({ property: 'aspect-ratio', value: { auto: false, ratio: null } } as never)).toEqual([])
    expect(dispatchTypographyDeclaration({ property: 'aspect-ratio', value: { auto: false, ratio: [1, 0] } } as never)).toEqual(
      [],
    )
  })

  it('line-height — number / length / normal', () => {
    expect(dispatchTypographyDeclaration({ property: 'line-height', value: { type: 'number', value: 1.5 } } as never)).toEqual([
      ['lineHeight', 24],
    ])
    expect(dispatchTypographyDeclaration({ property: 'line-height', value: { type: 'normal' } } as never)).toEqual([
      ['lineHeight', 20],
    ])
    const lengthResult = dispatchTypographyDeclaration({
      property: 'line-height',
      value: { type: 'length', value: { type: 'dimension', value: { unit: 'px', value: 22 } } },
    } as never)
    expect(lengthResult).toEqual([['lineHeight', 22]])
  })

  it('letter-spacing — normal / px / rem / non-object', () => {
    expect(dispatchTypographyDeclaration({ property: 'letter-spacing', value: { type: 'normal' } } as never)).toEqual([
      ['letterSpacing', 0],
    ])
    expect(
      dispatchTypographyDeclaration({
        property: 'letter-spacing',
        value: { type: 'length', value: { type: 'value', value: { unit: 'px', value: 2 } } },
      } as never),
    ).toEqual([['letterSpacing', 2]])
    expect(
      dispatchTypographyDeclaration({
        property: 'letter-spacing',
        value: { type: 'length', value: { type: 'value', value: { unit: 'rem', value: 0.1 } } },
      } as never),
    ).toEqual([['letterSpacing', 1.6]])
    expect(dispatchTypographyDeclaration({ property: 'letter-spacing', value: 'garbage' } as never)).toEqual([])
  })
})
