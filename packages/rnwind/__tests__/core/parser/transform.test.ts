import { describe, expect, it } from 'bun:test'
import {
  rotateToEntries,
  scaleToEntries,
  transformFunctionsToEntries,
  translateToEntries,
} from '../../../src/core/parser/transform'

describe('transformFunctionsToEntries', () => {
  it('empty list → empty', () => expect(transformFunctionsToEntries([])).toEqual([]))

  it('rotate(45deg)', () => {
    expect(transformFunctionsToEntries([{ type: 'rotate', value: { type: 'deg', value: 45 } } as never])).toEqual([
      ['transform', [{ rotate: '45deg' }]],
    ])
  })

  it('rotateZ / rotateX / rotateY', () => {
    expect(transformFunctionsToEntries([{ type: 'rotateZ', value: { type: 'deg', value: 90 } } as never])).toEqual([
      ['transform', [{ rotate: '90deg' }]],
    ])
    expect(transformFunctionsToEntries([{ type: 'rotateX', value: { type: 'deg', value: 45 } } as never])).toEqual([
      ['transform', [{ rotateX: '45deg' }]],
    ])
    expect(transformFunctionsToEntries([{ type: 'rotateY', value: { type: 'deg', value: 45 } } as never])).toEqual([
      ['transform', [{ rotateY: '45deg' }]],
    ])
  })

  it('angle units — rad / grad / turn convert to deg', () => {
    const rad = transformFunctionsToEntries([{ type: 'rotate', value: { type: 'rad', value: Math.PI } } as never])
    expect(rad[0]![1]).toEqual([{ rotate: '180deg' }])
    const grad = transformFunctionsToEntries([{ type: 'rotate', value: { type: 'grad', value: 200 } } as never])
    expect(grad[0]![1]).toEqual([{ rotate: '180deg' }])
    const turn = transformFunctionsToEntries([{ type: 'rotate', value: { type: 'turn', value: 0.5 } } as never])
    expect(turn[0]![1]).toEqual([{ rotate: '180deg' }])
  })

  it('scale / scaleX / scaleY', () => {
    expect(transformFunctionsToEntries([{ type: 'scaleX', value: { type: 'number', value: 2 } } as never])).toEqual([
      ['transform', [{ scaleX: 2 }]],
    ])
    expect(transformFunctionsToEntries([{ type: 'scaleY', value: { type: 'number', value: 3 } } as never])).toEqual([
      ['transform', [{ scaleY: 3 }]],
    ])
    const compound = transformFunctionsToEntries([
      {
        type: 'scale',
        value: [
          { type: 'number', value: 2 },
          { type: 'number', value: 3 },
        ],
      } as never,
    ])
    expect(compound[0]![1]).toEqual([{ scaleX: 2 }, { scaleY: 3 }])
  })

  it('translate / translateX / translateY / translate3d', () => {
    expect(
      transformFunctionsToEntries([
        { type: 'translateX', value: { type: 'dimension', value: { unit: 'px', value: 10 } } } as never,
      ]),
    ).toEqual([['transform', [{ translateX: 10 }]]])
    expect(
      transformFunctionsToEntries([
        { type: 'translateY', value: { type: 'dimension', value: { unit: 'px', value: 20 } } } as never,
      ]),
    ).toEqual([['transform', [{ translateY: 20 }]]])
    const compound = transformFunctionsToEntries([
      {
        type: 'translate',
        value: [
          { type: 'dimension', value: { unit: 'px', value: 5 } },
          { type: 'dimension', value: { unit: 'px', value: 15 } },
        ],
      } as never,
    ])
    expect(compound[0]![1]).toEqual([{ translateX: 5 }, { translateY: 15 }])
    const t3d = transformFunctionsToEntries([
      {
        type: 'translate3d',
        value: [
          { type: 'dimension', value: { unit: 'px', value: 5 } },
          { type: 'dimension', value: { unit: 'px', value: 15 } },
          { type: 'value', value: { unit: 'px', value: 0 } },
        ],
      } as never,
    ])
    expect(t3d[0]![1]).toEqual([{ translateX: 5 }, { translateY: 15 }])
  })

  it('skew / skewX / skewY', () => {
    expect(transformFunctionsToEntries([{ type: 'skewX', value: { type: 'deg', value: 10 } } as never])).toEqual([
      ['transform', [{ skewX: '10deg' }]],
    ])
    expect(transformFunctionsToEntries([{ type: 'skewY', value: { type: 'deg', value: 5 } } as never])).toEqual([
      ['transform', [{ skewY: '5deg' }]],
    ])
    const compound = transformFunctionsToEntries([
      {
        type: 'skew',
        value: [
          { type: 'deg', value: 10 },
          { type: 'deg', value: 5 },
        ],
      } as never,
    ])
    expect(compound[0]![1]).toEqual([{ skewX: '10deg' }, { skewY: '5deg' }])
  })

  it('drops unsupported ops (matrix, perspective)', () => {
    expect(transformFunctionsToEntries([{ type: 'matrix', value: { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 } } as never])).toEqual(
      [],
    )
    expect(
      transformFunctionsToEntries([
        { type: 'perspective', value: { type: 'value', value: { unit: 'px', value: 100 } } } as never,
      ]),
    ).toEqual([])
  })
})

describe('standalone entry-property converters', () => {
  it('rotateToEntries — none + typed rotate', () => {
    expect(rotateToEntries('none')).toEqual([])
    expect(rotateToEntries({ angle: { type: 'deg', value: 30 }, x: 0, y: 0, z: 1 } as never)).toEqual([
      ['transform', [{ rotate: '30deg' }]],
    ])
  })

  it('translateToEntries — none + typed translate, collapses y=0', () => {
    expect(translateToEntries('none')).toEqual([])
    const both = translateToEntries({
      x: { type: 'dimension', value: { unit: 'px', value: 5 } },
      y: { type: 'dimension', value: { unit: 'px', value: 10 } },
      z: { type: 'value', value: { unit: 'px', value: 0 } },
    } as never)
    expect(both).toEqual([['transform', [{ translateX: 5 }, { translateY: 10 }]]])
    const xOnly = translateToEntries({
      x: { type: 'dimension', value: { unit: 'px', value: 5 } },
      y: { type: 'dimension', value: { unit: 'px', value: 0 } },
      z: { type: 'value', value: { unit: 'px', value: 0 } },
    } as never)
    expect(xOnly).toEqual([['transform', [{ translateX: 5 }]]])
  })

  it('scaleToEntries — none + typed scale', () => {
    expect(scaleToEntries('none')).toEqual([])
    const result = scaleToEntries({
      x: { type: 'number', value: 1.5 },
      y: { type: 'number', value: 2 },
      z: { type: 'number', value: 1 },
    } as never)
    expect(result).toEqual([['transform', [{ scaleX: 1.5 }, { scaleY: 2 }]]])
  })

  it('percentage values in translate — stay as string %', () => {
    const result = translateToEntries({
      x: { type: 'percentage', value: 0.5 },
      y: { type: 'percentage', value: 0.25 },
      z: { type: 'value', value: { unit: 'px', value: 0 } },
    } as never)
    expect(result).toEqual([['transform', [{ translateX: '50%' }, { translateY: '25%' }]]])
  })
})
