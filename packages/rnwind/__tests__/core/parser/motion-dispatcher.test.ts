import { describe, expect, it } from 'bun:test'
import { dispatchMotionDeclaration } from '../../../src/core/parser/motion-dispatcher'

/**
 * Hit every branch of the motion dispatcher so coverage shows the full
 * surface — end-to-end tests exercise some paths but the standalone
 * `animation-duration`/`-delay`/etc. entry points need direct pokes.
 */

describe('dispatchMotionDeclaration', () => {
  it('returns null for non-motion properties', () => {
    expect(dispatchMotionDeclaration({ property: 'color' } as never)).toBeNull()
  })

  it('animation shorthand', () => {
    const result = dispatchMotionDeclaration({
      property: 'animation',
      value: [{ name: { type: 'ident', value: 'spin' } }],
    } as never)
    expect(result?.[0]).toEqual(['animationName', 'spin'])
  })

  it('animation-name standalone', () => {
    const result = dispatchMotionDeclaration({
      property: 'animation-name',
      value: [{ type: 'ident', value: 'pulse' }],
    } as never)
    expect(result).toEqual([['animationName', 'pulse']])
  })

  it('animation-duration standalone', () => {
    const result = dispatchMotionDeclaration({
      property: 'animation-duration',
      value: [{ type: 'milliseconds', value: 200 }],
    } as never)
    expect(result).toEqual([['animationDuration', '200ms']])
  })

  it('animation-timing-function standalone', () => {
    const result = dispatchMotionDeclaration({
      property: 'animation-timing-function',
      value: [{ type: 'linear' }],
    } as never)
    expect(result).toEqual([['animationTimingFunction', 'linear']])
  })

  it('animation-iteration-count standalone', () => {
    const result = dispatchMotionDeclaration({
      property: 'animation-iteration-count',
      value: [{ type: 'number', value: 3 }],
    } as never)
    expect(result).toEqual([['animationIterationCount', 3]])
  })

  it('animation-delay standalone', () => {
    const result = dispatchMotionDeclaration({
      property: 'animation-delay',
      value: [{ type: 'seconds', value: 2 }],
    } as never)
    expect(result).toEqual([['animationDelay', '2s']])
  })

  it('animation-direction standalone', () => {
    const result = dispatchMotionDeclaration({
      property: 'animation-direction',
      value: ['alternate'],
    } as never)
    expect(result).toEqual([['animationDirection', 'alternate']])
  })

  it('animation-fill-mode standalone', () => {
    const result = dispatchMotionDeclaration({
      property: 'animation-fill-mode',
      value: ['both'],
    } as never)
    expect(result).toEqual([['animationFillMode', 'both']])
  })

  it('animation-play-state standalone', () => {
    const result = dispatchMotionDeclaration({
      property: 'animation-play-state',
      value: ['paused'],
    } as never)
    expect(result).toEqual([['animationPlayState', 'paused']])
  })

  it('transition shorthand', () => {
    const result = dispatchMotionDeclaration({
      property: 'transition',
      value: [
        {
          property: { property: 'opacity' },
          duration: { type: 'milliseconds', value: 150 },
          timingFunction: { type: 'linear' },
          delay: { type: 'seconds', value: 0 },
        },
      ],
    } as never)
    expect(result?.some(([k]) => k === 'transitionProperty')).toBe(true)
  })

  it('transition-property / -duration / -timing-function / -delay standalone', () => {
    expect(dispatchMotionDeclaration({ property: 'transition-property', value: [{ property: 'opacity' }] } as never)).toEqual([
      ['transitionProperty', 'opacity'],
    ])
    expect(
      dispatchMotionDeclaration({ property: 'transition-duration', value: [{ type: 'milliseconds', value: 300 }] } as never),
    ).toEqual([['transitionDuration', '300ms']])
    expect(dispatchMotionDeclaration({ property: 'transition-timing-function', value: [{ type: 'ease-in' }] } as never)).toEqual([
      ['transitionTimingFunction', 'ease-in'],
    ])
    expect(
      dispatchMotionDeclaration({ property: 'transition-delay', value: [{ type: 'milliseconds', value: 25 }] } as never),
    ).toEqual([['transitionDelay', '25ms']])
  })

  it('transform array', () => {
    const result = dispatchMotionDeclaration({
      property: 'transform',
      value: [{ type: 'rotate', value: { type: 'deg', value: 45 } }],
    } as never)
    expect(result).toEqual([['transform', [{ rotate: '45deg' }]]])
  })

  it('rotate / translate / scale individual properties', () => {
    expect(
      dispatchMotionDeclaration({
        property: 'rotate',
        value: { angle: { type: 'deg', value: 30 }, x: 0, y: 0, z: 1 },
      } as never),
    ).toEqual([['transform', [{ rotate: '30deg' }]]])

    expect(
      dispatchMotionDeclaration({
        property: 'scale',
        value: { x: { type: 'number', value: 2 }, y: { type: 'number', value: 3 }, z: { type: 'number', value: 1 } },
      } as never),
    ).toEqual([['transform', [{ scaleX: 2 }, { scaleY: 3 }]]])

    expect(
      dispatchMotionDeclaration({
        property: 'translate',
        value: {
          x: { type: 'dimension', value: { unit: 'px', value: 5 } },
          y: { type: 'dimension', value: { unit: 'px', value: 10 } },
          z: { type: 'value', value: { unit: 'px', value: 0 } },
        },
      } as never),
    ).toEqual([['transform', [{ translateX: 5 }, { translateY: 10 }]]])
  })

  it('rotate/scale/translate none → empty', () => {
    expect(dispatchMotionDeclaration({ property: 'rotate', value: 'none' } as never)).toEqual([])
    expect(dispatchMotionDeclaration({ property: 'scale', value: 'none' } as never)).toEqual([])
    expect(dispatchMotionDeclaration({ property: 'translate', value: 'none' } as never)).toEqual([])
  })
})
