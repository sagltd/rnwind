import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderWithCss, type RenderWithCssResult } from 'rnwind/testing'
import type { AsLinearGradientProps } from 'rnwind'

/**
 * End-to-end gradient integration: source → rnwind transformer →
 * component mount → assert the component received `colors`, `start`,
 * `end` props that match the `className`.
 *
 * Uses a `<LinearGradient>` stub that's a plain JS function recording
 * its props. No `expo-linear-gradient` dependency — rnwind is
 * library-agnostic; any component accepting {@link AsLinearGradientProps}
 * works verbatim.
 */

const PRESET = readFileSync(path.resolve(__dirname, '..', '..', 'rnwind', 'preset.css'), 'utf8')
const THEME = `@import 'tailwindcss';\n${PRESET}`

let captured: AsLinearGradientProps | null = null
/**
 * Test stand-in for `<LinearGradient>`. Records its props so tests can
 * inspect the rnwind-emitted `colors` / `start` / `end`. Returns a
 * plain View-ish element so the renderer still produces a tree.
 * @param props Props rnwind's transformer fills in.
 * @returns A null React element (the test renderer's host tree ignores it).
 */
function LinearGradient(props: AsLinearGradientProps & { children?: React.ReactNode }): React.ReactElement {
  captured = { colors: props.colors, start: props.start, end: props.end }
  return React.createElement('rn-linear-gradient', props as never, props.children)
}

let handle: RenderWithCssResult | null = null
afterEach(() => {
  handle?.cleanup()
  handle = null
  captured = null
})

describe('rnwind — gradient end to end', () => {
  it('bg-gradient-to-r + from + to fills colors/start/end', async () => {
    handle = await renderWithCss(
      `import { LinearGradient } from 'react-native'
       export default () => (
         <LinearGradient className="bg-gradient-to-r from-red-500 to-blue-500 rounded-lg" testID="g" />
       )`,
      {
        themeCss: THEME,
        reactNative: { LinearGradient },
      },
    )
    expect(captured).not.toBeNull()
    expect(captured!.colors).toHaveLength(2)
    expect(captured!.colors[0]).toMatch(/^#/)
    expect(captured!.colors[1]).toMatch(/^#/)
    expect(captured!.start).toEqual({ x: 0, y: 0.5 })
    expect(captured!.end).toEqual({ x: 1, y: 0.5 })
  })

  it('three-stop gradient carries via colour in the middle', async () => {
    handle = await renderWithCss(
      `import { LinearGradient } from 'react-native'
       export default () => (
         <LinearGradient className="bg-gradient-to-b from-red-500 via-green-500 to-blue-500" testID="g" />
       )`,
      {
        themeCss: THEME,
        reactNative: { LinearGradient },
      },
    )
    expect(captured!.colors).toHaveLength(3)
    expect(captured!.start).toEqual({ x: 0.5, y: 0 })
    expect(captured!.end).toEqual({ x: 0.5, y: 1 })
  })

  it('produces frozen arrays / objects for referential stability', async () => {
    handle = await renderWithCss(
      `import { LinearGradient } from 'react-native'
       export default () => <LinearGradient className="bg-gradient-to-r from-red-500 to-blue-500" testID="g" />`,
      {
        themeCss: THEME,
        reactNative: { LinearGradient },
      },
    )
    expect(Object.isFrozen(captured!.colors)).toBe(true)
    expect(Object.isFrozen(captured!.start)).toBe(true)
    expect(Object.isFrozen(captured!.end)).toBe(true)
  })
})
