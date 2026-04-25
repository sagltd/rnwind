import { describe, expect, it } from 'bun:test'
import {
  animationDelayEntries,
  animationDirectionEntries,
  animationDurationEntries,
  animationFillModeEntries,
  animationIterationCountEntries,
  animationNameEntries,
  animationNameToString,
  animationPlayStateEntries,
  animationShorthandToEntries,
  animationTimingFunctionEntries,
  easingFunctionToString,
  iterationCountToValue,
  timeToString,
  transitionDelayEntries,
  transitionDurationEntries,
  transitionPropertyEntries,
  transitionShorthandToEntries,
  transitionTimingFunctionEntries,
} from '../../../src/core/parser/animation'

describe('easingFunctionToString', () => {
  it('linear', () => expect(easingFunctionToString({ type: 'linear' } as never)).toBe('linear'))
  it('ease / in / out / in-out', () => {
    expect(easingFunctionToString({ type: 'ease' } as never)).toBe('ease')
    expect(easingFunctionToString({ type: 'ease-in' } as never)).toBe('ease-in')
    expect(easingFunctionToString({ type: 'ease-out' } as never)).toBe('ease-out')
    expect(easingFunctionToString({ type: 'ease-in-out' } as never)).toBe('ease-in-out')
  })
  it('cubic-bezier snaps to a predefined keyword (Reanimated v4 CSS engine rejects cubic-bezier(...))', () => {
    // Material standard easing — Tailwind's default for `transition-colors`.
    expect(easingFunctionToString({ type: 'cubic-bezier', x1: 0.4, y1: 0, x2: 0.2, y2: 1 } as never)).toBe('ease-in-out')
    // Roughly `ease-out` shape (slow finish).
    expect(easingFunctionToString({ type: 'cubic-bezier', x1: 0, y1: 0, x2: 0.2, y2: 1 } as never)).toBe('ease-out')
    // Roughly `ease-in` shape (slow start).
    expect(easingFunctionToString({ type: 'cubic-bezier', x1: 0.4, y1: 0, x2: 1, y2: 1 } as never)).toBe('ease-in')
    // Always returns one of the keywords Reanimated accepts.
    const allowed = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end'])
    expect(allowed.has(easingFunctionToString({ type: 'cubic-bezier', x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 } as never))).toBe(true)
  })
  it('steps', () => {
    expect(easingFunctionToString({ type: 'steps', count: 3, position: { type: 'start' } } as never)).toBe('steps(3, start)')
    expect(easingFunctionToString({ type: 'steps', count: 2 } as never)).toBe('steps(2, end)')
  })
  it('unknown default', () => {
    expect(easingFunctionToString({ type: 'who-knows' } as never)).toBe('ease')
  })
})

describe('timeToString', () => {
  it('milliseconds', () => expect(timeToString({ type: 'milliseconds', value: 150 })).toBe('150ms'))
  it('seconds', () => expect(timeToString({ type: 'seconds', value: 1.5 })).toBe('1.5s'))
})

describe('animationNameToString', () => {
  it('none → null', () => expect(animationNameToString({ type: 'none' } as never)).toBeNull())
  it('ident', () => expect(animationNameToString({ type: 'ident', value: 'spin' } as never)).toBe('spin'))
  it('string', () => expect(animationNameToString({ type: 'string', value: 'my-anim' } as never)).toBe('my-anim'))
  it('unknown returns null', () => expect(animationNameToString({ type: 'other' } as never)).toBeNull())
})

describe('iterationCountToValue', () => {
  it('infinite', () => expect(iterationCountToValue({ type: 'infinite' } as never)).toBe('infinite'))
  it('number', () => expect(iterationCountToValue({ type: 'number', value: 3 } as never)).toBe(3))
})

describe('animationShorthandToEntries', () => {
  it('empty list → empty', () => expect(animationShorthandToEntries([])).toEqual([]))
  it('none name → empty', () => expect(animationShorthandToEntries([{ name: { type: 'none' } } as never])).toEqual([]))
  it('full shorthand with all fields', () => {
    const entries = animationShorthandToEntries([
      {
        name: { type: 'ident', value: 'spin' },
        duration: { type: 'seconds', value: 1 },
        timingFunction: { type: 'linear' },
        iterationCount: { type: 'infinite' },
        direction: 'reverse',
        fillMode: 'forwards',
        delay: { type: 'milliseconds', value: 50 },
        playState: 'paused',
      } as never,
    ])
    const map = Object.fromEntries(entries as readonly (readonly [string, unknown])[])
    expect(map.animationName).toBe('spin')
    expect(map.animationDuration).toBe('1s')
    expect(map.animationTimingFunction).toBe('linear')
    expect(map.animationIterationCount).toBe('infinite')
    expect(map.animationDirection).toBe('reverse')
    expect(map.animationFillMode).toBe('forwards')
    expect(map.animationDelay).toBe('50ms')
    expect(map.animationPlayState).toBe('paused')
  })
  it('skips defaults: normal direction + none fillMode + zero delay + running playState', () => {
    const entries = animationShorthandToEntries([
      {
        name: { type: 'ident', value: 'pulse' },
        direction: 'normal',
        fillMode: 'none',
        delay: { type: 'seconds', value: 0 },
        playState: 'running',
      } as never,
    ])
    const map = Object.fromEntries(entries as readonly (readonly [string, unknown])[])
    expect(map.animationDirection).toBeUndefined()
    expect(map.animationFillMode).toBeUndefined()
    expect(map.animationDelay).toBeUndefined()
    expect(map.animationPlayState).toBeUndefined()
  })
})

describe('standalone animation-* entries', () => {
  it('animationNameEntries', () => {
    expect(animationNameEntries([{ type: 'ident', value: 'bounce' } as never])).toEqual([['animationName', 'bounce']])
    expect(animationNameEntries([])).toEqual([])
    expect(animationNameEntries([{ type: 'none' } as never])).toEqual([])
  })
  it('animationDurationEntries', () => {
    expect(animationDurationEntries([{ type: 'milliseconds', value: 200 }])).toEqual([['animationDuration', '200ms']])
    expect(animationDurationEntries([])).toEqual([])
  })
  it('animationTimingFunctionEntries', () => {
    expect(animationTimingFunctionEntries([{ type: 'linear' } as never])).toEqual([['animationTimingFunction', 'linear']])
    expect(animationTimingFunctionEntries([])).toEqual([])
  })
  it('animationIterationCountEntries', () => {
    expect(animationIterationCountEntries([{ type: 'number', value: 5 } as never])).toEqual([['animationIterationCount', 5]])
    expect(animationIterationCountEntries([])).toEqual([])
  })
  it('animationDelayEntries', () => {
    expect(animationDelayEntries([{ type: 'milliseconds', value: 100 }])).toEqual([['animationDelay', '100ms']])
    expect(animationDelayEntries([])).toEqual([])
  })
  it('animationDirectionEntries', () => {
    expect(animationDirectionEntries(['reverse'])).toEqual([['animationDirection', 'reverse']])
    expect(animationDirectionEntries([])).toEqual([])
  })
  it('animationFillModeEntries', () => {
    expect(animationFillModeEntries(['forwards'])).toEqual([['animationFillMode', 'forwards']])
    expect(animationFillModeEntries([])).toEqual([])
  })
  it('animationPlayStateEntries', () => {
    expect(animationPlayStateEntries(['paused'])).toEqual([['animationPlayState', 'paused']])
    expect(animationPlayStateEntries([])).toEqual([])
  })
})

describe('transition entries', () => {
  it('transitionPropertyEntries — single property', () => {
    expect(transitionPropertyEntries([{ property: 'opacity' } as never])).toEqual([['transitionProperty', 'opacity']])
  })
  it('transitionPropertyEntries — multiple properties (camelCased to RN style keys)', () => {
    expect(transitionPropertyEntries([{ property: 'color' }, { property: 'background-color' }] as never)).toEqual([
      ['transitionProperty', ['color', 'backgroundColor']],
    ])
  })

  it('transitionPropertyEntries — drops Tailwind internal --tw-* tokens', () => {
    expect(
      transitionPropertyEntries([{ property: 'color' }, { property: 'custom', value: { name: '--tw-gradient-from' } }] as never),
    ).toEqual([['transitionProperty', 'color']])
  })
  it('transitionPropertyEntries — all empty when all drop', () => {
    expect(transitionPropertyEntries([])).toEqual([])
  })
  it('transitionPropertyEntries — custom property', () => {
    expect(transitionPropertyEntries([{ property: 'custom', value: { name: '--x' } } as never])).toEqual([
      ['transitionProperty', '--x'],
    ])
  })
  it('transitionDurationEntries', () => {
    expect(transitionDurationEntries([{ type: 'milliseconds', value: 300 }])).toEqual([['transitionDuration', '300ms']])
    expect(transitionDurationEntries([])).toEqual([])
  })
  it('transitionTimingFunctionEntries', () => {
    expect(transitionTimingFunctionEntries([{ type: 'linear' } as never])).toEqual([['transitionTimingFunction', 'linear']])
    expect(transitionTimingFunctionEntries([])).toEqual([])
  })
  it('transitionDelayEntries', () => {
    expect(transitionDelayEntries([{ type: 'milliseconds', value: 50 }])).toEqual([['transitionDelay', '50ms']])
    expect(transitionDelayEntries([])).toEqual([])
  })
})

describe('transitionShorthandToEntries', () => {
  it('empty list', () => expect(transitionShorthandToEntries([])).toEqual([]))
  it('single transition', () => {
    const entries = transitionShorthandToEntries([
      {
        property: { property: 'opacity' },
        duration: { type: 'milliseconds', value: 200 },
        timingFunction: { type: 'linear' },
        delay: { type: 'seconds', value: 0 },
      } as never,
    ])
    const map = Object.fromEntries(entries as readonly (readonly [string, unknown])[])
    expect(map.transitionProperty).toBe('opacity')
    expect(map.transitionDuration).toBe('200ms')
    expect(map.transitionTimingFunction).toBe('linear')
    expect(map.transitionDelay).toBeUndefined() // zero delay skipped
  })
  it('multiple transitions collapse to arrays', () => {
    const entries = transitionShorthandToEntries([
      {
        property: { property: 'color' },
        duration: { type: 'milliseconds', value: 100 },
        timingFunction: { type: 'linear' },
        delay: { type: 'seconds', value: 0 },
      },
      {
        property: { property: 'opacity' },
        duration: { type: 'milliseconds', value: 200 },
        timingFunction: { type: 'ease' },
        delay: { type: 'seconds', value: 0 },
      },
    ] as never)
    const map = Object.fromEntries(entries as readonly (readonly [string, unknown])[])
    expect(map.transitionProperty).toEqual(['color', 'opacity'])
    expect(map.transitionDuration).toEqual(['100ms', '200ms'])
    expect(map.transitionTimingFunction).toEqual(['linear', 'ease'])
  })
})
