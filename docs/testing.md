# Testing

`rnwind/testing` runs the **real Metro transformer + runtime** in your test process. Assertions target the exact styles your production bundle would attach.

## `renderWithCss`

```tsx
import { afterEach, expect, test } from 'bun:test'
import { renderWithCss, flatten, type RenderWithCssResult } from 'rnwind/testing'

let handle: RenderWithCssResult | null = null
afterEach(() => handle?.cleanup())

test('<View className="bg-primary p-4" />', async () => {
  handle = await renderWithCss(
    `import { View } from 'react-native'
     export default () => <View className="bg-primary p-4" testID="box" />`,
    { themeCss: `@import 'tailwindcss'; @theme { --color-primary: #6366f1; }` },
  )
  const flat = flatten(handle.getByTestId('box').props.style)
  expect(flat.backgroundColor).toBe('#6366f1')
  expect(flat.padding).toBe(16)
})
```

`renderWithCss` returns `@testing-library/react-native`'s full render API (`getByTestId`, `rerender`, `unmount`, …) plus `transformedSource` and `cleanup`.

## `renderHookWithCss`

```tsx
import { renderHookWithCss, flatten } from 'rnwind/testing'
import { useCss } from 'rnwind'

const { result, cleanup } = await renderHookWithCss(() => useCss('bg-primary'), {
  themeCss: `@theme { --color-primary: #6366f1; }`,
  classNames: ['bg-primary'],
})
expect(flatten(result.current).backgroundColor).toBe('#6366f1')
cleanup()
```

Mirrors `renderHook`'s shape — `result`, `rerender`, `unmount` — plus `cleanup`.

## Bun setup

```toml
# bunfig.toml
[test]
preload = ["./test-setup/react-native-stub.ts"]
```

```ts
// test-setup/react-native-stub.ts
import { mock } from 'bun:test'

// Suppresses RTR's deprecation banner — RN's intended escape hatch.
;(globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }).IS_REACT_NATIVE_TEST_ENVIRONMENT = true

mock.module('react-native', () => ({
  View: 'RNView', Text: 'RNText', Pressable: 'RNPressable', ScrollView: 'RNScrollView',
  StyleSheet: { create: <T>(s: T) => s, flatten: <T>(s: T) => s, hairlineWidth: 1 },
  useColorScheme: () => null,
  useWindowDimensions: () => ({ width: 375, height: 812, fontScale: 1, scale: 2 }),
}))
```

## Jest setup

`jest-expo`'s preset handles the RN environment — no extra stubbing needed. Add `rnwind` to `transformIgnorePatterns`'s allow-list so Jest transpiles its TS sources:

```js
// jest.config.js
module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: ['/node_modules/(?!rnwind)'],
}
```
