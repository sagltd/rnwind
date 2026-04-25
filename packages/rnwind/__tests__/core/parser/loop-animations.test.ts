import { beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { TailwindParser, type RNStyle } from '../../../src/core/parser'

/**
 * End-to-end cover for the looping-animation preset +
 * user-authored animation utilities:
 *  - `repeat-infinite` / `repeat-<n>` compose with any animation
 *    to set `animationIterationCount`.
 *  - `loop-pulse` / `loop-spin` / `loop-bounce` ship as
 *    one-class looping animations.
 *  - A user-defined `@utility` pointing at a `@keyframes` block in
 *    their own `global.css` is resolved end-to-end — proving the
 *    preset's shape is not privileged; anything Tailwind v4's
 *    `@utility` + `@keyframes` can express flows through to RN.
 */

const preset = readFileSync(path.resolve(__dirname, '..', '..', '..', 'preset.css'), 'utf8')
const themeCss = `@import "tailwindcss";\n${preset}`

let parser: TailwindParser

beforeAll(() => {
  parser = new TailwindParser({ themeCss })
})

/**
 * Resolve one className through the shared preset parser and return
 * the base-scheme RN style.
 * @param className Tailwind class token.
 * @returns RN style object (base scheme).
 */
async function resolve(className: string): Promise<RNStyle> {
  const result = await parser.parseAtoms({ content: `<V className="${className}" />`, extension: 'tsx' })
  const schemed = result.atoms.get(className)
  if (!schemed) throw new Error(`atom ${className} missing`)
  const [firstScheme] = Object.keys(schemed)
  return schemed[firstScheme!] as RNStyle
}

describe('preset: repeat-* utility', () => {
  it('repeat-infinite → { animationIterationCount: "infinite" }', async () => {
    const style = await resolve('repeat-infinite')
    expect(style.animationIterationCount).toBe('infinite')
  })

  it('repeat-5 → { animationIterationCount: 5 }', async () => {
    const style = await resolve('repeat-5')
    expect(style.animationIterationCount).toBe(5)
  })
})

describe('preset: loop-* utilities ship with iteration-count baked in', () => {
  it('loop-pulse defaults to 2s — slow enough to actually read as a pulse', async () => {
    const style = await resolve('loop-pulse')
    expect(style.animationName).toBe('rnw-pulse')
    expect(style.animationIterationCount).toBe('infinite')
    expect(style.animationDuration).toBe('2s')
  })

  it('loop-spin → rnw-spin keyframe, linear, infinite, 1s default', async () => {
    const style = await resolve('loop-spin')
    expect(style.animationName).toBe('rnw-spin')
    expect(style.animationIterationCount).toBe('infinite')
    expect(style.animationTimingFunction).toBe('linear')
    expect(style.animationDuration).toBe('1s')
  })

  it('loop-bounce → rnw-bounce keyframe, infinite, 1s default', async () => {
    const style = await resolve('loop-bounce')
    expect(style.animationName).toBe('rnw-bounce')
    expect(style.animationIterationCount).toBe('infinite')
    expect(style.animationDuration).toBe('1s')
  })
})

describe('preset: loop-*-<duration> lets the user override the duration', () => {
  it('loop-pulse-500 → 500ms', async () => {
    const style = await resolve('loop-pulse-500')
    expect(style.animationName).toBe('rnw-pulse')
    expect(style.animationDuration).toBe('500ms')
    expect(style.animationIterationCount).toBe('infinite')
  })

  it('loop-spin-slow → --duration-slow (420ms)', async () => {
    const style = await resolve('loop-spin-slow')
    expect(style.animationName).toBe('rnw-spin')
    expect(style.animationDuration).toBe('420ms')
    expect(style.animationIterationCount).toBe('infinite')
  })

  it('loop-bounce-[1500ms] → arbitrary time literal', async () => {
    const style = await resolve('loop-bounce-[1500ms]')
    expect(style.animationName).toBe('rnw-bounce')
    expect(style.animationDuration).toBe('1500ms')
    expect(style.animationIterationCount).toBe('infinite')
  })
})

describe('user-authored animation utility + keyframes flow end-to-end', () => {
  it('resolves a custom @utility + @keyframes declared in the user theme', async () => {
    const userTheme = `@import "tailwindcss";
      @keyframes my-wiggle {
        0%   { transform: rotate(-3deg); }
        50%  { transform: rotate(3deg); }
        100% { transform: rotate(-3deg); }
      }
      @utility my-wiggle {
        animation-name: my-wiggle;
        animation-duration: 600ms;
        animation-iteration-count: infinite;
      }`
    const userParser = new TailwindParser({ themeCss: userTheme })
    const result = await userParser.parseAtoms({ content: `<V className="my-wiggle" />`, extension: 'tsx' })
    const schemed = result.atoms.get('my-wiggle') as Record<string, RNStyle> | undefined
    expect(schemed).toBeDefined()
    const [firstScheme] = Object.keys(schemed!)
    const style = schemed![firstScheme!] as RNStyle
    expect(style.animationName).toBe('my-wiggle')
    expect(style.animationIterationCount).toBe('infinite')
    expect(result.keyframes.has('my-wiggle')).toBe(true)
  })

  it('functional user utility `my-pulse-*` accepts a duration suffix', async () => {
    const userTheme = `@import "tailwindcss";
      @keyframes my-pulse {
        0%, 100% { opacity: 1; }
        50%      { opacity: 0.4; }
      }
      @utility my-pulse-* {
        animation-name: my-pulse;
        animation-duration: calc(--value(integer) * 1ms);
        animation-iteration-count: infinite;
      }`
    const userParser = new TailwindParser({ themeCss: userTheme })
    const result = await userParser.parseAtoms({ content: `<V className="my-pulse-800" />`, extension: 'tsx' })
    const schemed = result.atoms.get('my-pulse-800') as Record<string, RNStyle> | undefined
    expect(schemed).toBeDefined()
    const [firstScheme] = Object.keys(schemed!)
    const style = schemed![firstScheme!] as RNStyle
    expect(style.animationName).toBe('my-pulse')
    expect(style.animationDuration).toBe('800ms')
    expect(style.animationIterationCount).toBe('infinite')
  })
})
