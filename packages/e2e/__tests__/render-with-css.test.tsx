import { afterEach, describe, expect, it } from 'bun:test'
import { useCss } from 'rnwind'
import { flatten, renderHookWithCss, renderWithCss, type RenderHookWithCssResult, type RenderWithCssResult } from 'rnwind/testing'

let handle: RenderWithCssResult | null = null
afterEach(() => {
  handle?.cleanup()
  handle = null
})

describe('rnwind/testing — renderWithCss', () => {
  it('<View className="bg-primary p-4" /> → rendered element carries resolved background + padding', async () => {
    handle = await renderWithCss(
      `import { View } from 'react-native'
       export default () => <View className="bg-primary p-4" testID="box" />`,
      {
        themeCss: `@import 'tailwindcss';
@theme { --color-primary: #6366f1; }
`,
      },
    )
    if (!handle) {
      throw new Error('renderWithCss returned null or undefined handle')
    }
    const flat = flatten(handle.getByTestId('box').props.style)
    expect(flat.backgroundColor).toBe('#6366f1')
    expect(flat.padding).toBe(16)
  })

  it('exposes the raw transformer output so tests can eyeball it', async () => {
    handle = await renderWithCss(
      `import { View } from 'react-native'
       export default () => <View className="bg-primary" testID="box" />`,
      {
        themeCss: `@import 'tailwindcss';
@theme { --color-primary: #ff0099; }
`,
      },
    )
    expect(handle.transformedSource).toContain('lookupCss(')
    expect(handle.transformedSource).toContain('useScheme')
    expect(handle.transformedSource).not.toContain('className=')
  })

  it('the returned handle spreads the testing-library queries (getByText, queryByTestId, etc.)', async () => {
    handle = await renderWithCss(
      `import { Text } from 'react-native'
       export default () => <Text className="text-lg" testID="hello">hello</Text>`,
    )
    // Sample a few queries from @testing-library/react-native — they're
    // spread directly onto the handle, no `.queries` wrapper.
    expect(typeof handle.getByTestId).toBe('function')
    expect(typeof handle.queryByTestId).toBe('function')
    expect(typeof handle.unmount).toBe('function')
    expect(typeof handle.rerender).toBe('function')
  })
})

describe('rnwind/testing — renderHookWithCss', () => {
  let hookHandle: RenderHookWithCssResult<readonly unknown[], unknown> | null = null
  afterEach(() => {
    hookHandle?.cleanup()
    hookHandle = null
  })

  it('useCss("bg-primary") returns the resolved style array', async () => {
    hookHandle = await renderHookWithCss(() => useCss('bg-primary'), {
      themeCss: `@import 'tailwindcss';
@theme { --color-primary: #6366f1; }
`,
      classNames: ['bg-primary'],
    })
    const flat = flatten(hookHandle.result.current)
    expect(flat.backgroundColor).toBe('#6366f1')
  })

  it('forwards renderHook API surface — result/rerender/unmount/cleanup', async () => {
    hookHandle = await renderHookWithCss(() => useCss('p-4'), {
      classNames: ['p-4'],
    })
    expect(hookHandle.result).toBeDefined()
    expect(typeof hookHandle.rerender).toBe('function')
    expect(typeof hookHandle.unmount).toBe('function')
    expect(typeof hookHandle.cleanup).toBe('function')
  })
})
