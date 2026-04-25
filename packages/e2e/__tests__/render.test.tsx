import { afterEach, describe, expect, it } from 'bun:test'
import { renderWithCss, renderHookWithCss, flatten, type RenderWithCssResult } from '../../rnwind/src/testing'
import { useCss } from '../../rnwind/src/runtime/hooks/use-css'

let handle: RenderWithCssResult | null = null
let hookCleanup: (() => void) | null = null

afterEach(() => {
  handle?.cleanup()
  handle = null
  hookCleanup?.()
  hookCleanup = null
})

/**
 * Real end-to-end coverage: feed source through the transformer, evaluate
 * the rewritten module against the populated runtime registry, and assert
 * on the resolved style RN actually receives. If this passes, a user's
 * `<View className="bg-primary" />` renders with the registered colour in
 * their app — proven through the SAME `renderWithCss` external consumers
 * use, not a bespoke harness.
 */
describe('e2e — <Component className="..." /> reaches RN with the resolved style', () => {
  it('static className: <View className="p-4 bg-red-500" /> → style array carries the resolved values', async () => {
    handle = await renderWithCss(
      `import { View } from 'react-native'
       export default () => <View className="p-4 bg-red-500" testID="box" />`,
    )
    const node = handle.getByTestId('box')
    const style = flatten(node.props.style)
    expect(style.padding).toBe(16)
    expect(typeof style.backgroundColor).toBe('string')
    // The transformer collapses className → style; the prop should be gone.
    expect(node.props.className).toBeUndefined()
  })

  it('custom theme: bg-primary resolves to the user-declared color', async () => {
    handle = await renderWithCss(
      `import { View } from 'react-native'
       export default () => <View className="bg-primary p-2" testID="box" />`,
      { themeCss: `@import 'tailwindcss'; @theme { --color-primary: #112233; }` },
    )
    const style = flatten(handle.getByTestId('box').props.style)
    expect(style.backgroundColor).toBe('#112233')
    expect(style.padding).toBe(8)
  })
})

describe('e2e — useCss(className) returns the same resolved style as the rewritten element', () => {
  it('useCss("p-4 bg-red-500") inside a hook returns the populated style array', async () => {
    const { result, cleanup } = await renderHookWithCss(() => useCss('p-4 bg-red-500'), {
      classNames: ['p-4', 'bg-red-500'],
    })
    hookCleanup = cleanup
    const style = flatten(result.current)
    expect(style.padding).toBe(16)
    expect(typeof style.backgroundColor).toBe('string')
  })

  it('useCss("bg-primary") on a custom theme returns the registered color', async () => {
    const { result, cleanup } = await renderHookWithCss(() => useCss('bg-primary'), {
      themeCss: `@import 'tailwindcss'; @theme { --color-primary: #aabbcc; }`,
      classNames: ['bg-primary'],
    })
    hookCleanup = cleanup
    expect(flatten(result.current).backgroundColor).toBe('#aabbcc')
  })
})
