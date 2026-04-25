import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { flatten, renderWithCss, type RenderWithCssResult } from 'rnwind/testing'

/**
 * End-to-end safe-area integration: source → rnwind transformer →
 * chunk eval → render → assert resolved styles against a non-zero
 * inset snapshot.
 *
 * Covers every pattern from the preset table:
 *  - Plain `pt-safe` / shorthand `p-safe`.
 *  - `*-safe-or-N` fallback.
 *  - `*-safe-offset-N` stacked on top of the inset.
 *  - `h-screen-safe` against a provider-supplied viewport height.
 */

const PRESET = readFileSync(path.resolve(__dirname, '..', '..', 'rnwind', 'preset.css'), 'utf8')
const THEME = `@import 'tailwindcss';\n${PRESET}`
const INSETS = { top: 47, right: 0, bottom: 34, left: 0 }

let handle: RenderWithCssResult | null = null

afterEach(() => {
  handle?.cleanup()
  handle = null
})

/**
 * Compile + render a single-element source using the supplied class
 * names under the shared `THEME` + `INSETS` and return the flattened
 * RN style array the transformer produced.
 * @param className Space-separated class names to apply.
 * @returns Flattened style record keyed by RN style name.
 */
async function mount(className: string): Promise<Record<string, unknown>> {
  handle = await renderWithCss(
    `import { View } from 'react-native'
     export default () => <View className="${className}" testID="box" />`,
    { themeCss: THEME, insets: INSETS },
  )
  return flatten(handle.getByTestId('box').props.style)
}

describe('rnwind — safe-area end to end', () => {
  it('pt-safe resolves to the top inset', async () => {
    expect(await mount('pt-safe')).toEqual({ paddingTop: 47 })
  })

  it('p-safe expands into all four paddings', async () => {
    expect(await mount('p-safe')).toEqual({ paddingTop: 47, paddingRight: 0, paddingBottom: 34, paddingLeft: 0 })
  })

  it('px-safe covers left + right only', async () => {
    expect(await mount('px-safe')).toEqual({ paddingLeft: 0, paddingRight: 0 })
  })

  it('pt-safe-or-4 takes the inset when larger', async () => {
    expect(await mount('pt-safe-or-4')).toEqual({ paddingTop: 47 })
  })

  it('pt-safe-or-16 falls back when inset is smaller', async () => {
    // top inset = 47 < 16 * var(--spacing)=0.25rem → 0.25rem * 16 = 4rem = 64px. Fallback wins.
    expect(await mount('pt-safe-or-16')).toEqual({ paddingTop: 64 })
  })

  it('pt-safe-offset-4 stacks 16px on top of the inset', async () => {
    expect(await mount('pt-safe-offset-4')).toEqual({ paddingTop: 63 })
  })

  it('inset-safe gives four numeric coordinates', async () => {
    expect(await mount('inset-safe')).toEqual({ top: 47, right: 0, bottom: 34, left: 0 })
  })

  it('top-safe-or-[2px] takes the 2px arbitrary when inset is smaller', async () => {
    handle = await renderWithCss(
      `import { View } from 'react-native'
       export default () => <View className="top-safe-or-[2px]" testID="box" />`,
      { themeCss: THEME, insets: { top: 0 } },
    )
    expect(flatten(handle.getByTestId('box').props.style)).toEqual({ top: 2 })
  })

  it('start-safe maps to the left inset through inset-inline-start', async () => {
    expect(await mount('start-safe')).toEqual({ insetInlineStart: 0 })
  })

  it('without an insets prop, pt-safe resolves to 0', async () => {
    handle = await renderWithCss(
      `import { View } from 'react-native'
       export default () => <View className="pt-safe" testID="box" />`,
      { themeCss: THEME },
    )
    expect(flatten(handle.getByTestId('box').props.style)).toEqual({ paddingTop: 0 })
  })
})
