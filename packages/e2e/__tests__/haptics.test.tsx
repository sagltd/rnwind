import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderWithCss, type RenderWithCssResult } from 'rnwind/testing'
import type { HapticRequest, HapticTrigger } from 'rnwind'

/**
 * End-to-end haptics integration:
 *  - Bare `haptic-*` fires on mount.
 *  - `active:haptic-*` fires on press-in.
 *  - Classes without a matching provider `onHaptics` emit a dev warning.
 */

const PRESET = readFileSync(path.resolve(__dirname, '..', '..', 'rnwind', 'preset.css'), 'utf8')
const THEME = `@import 'tailwindcss';\n${PRESET}`

let handle: RenderWithCssResult | null = null
afterEach(() => {
  handle?.cleanup()
  handle = null
})

interface Capture {
  readonly request: HapticRequest
  readonly trigger: HapticTrigger
}

describe('rnwind — haptics end to end', () => {
  it('bare haptic-success fires onHaptics({kind:"notification",type:"Success"},"mount") once at mount', async () => {
    const calls: Capture[] = []
    handle = await renderWithCss(
      `import { View } from 'react-native'
       export default () => <View className="haptic-success" testID="t" />`,
      {
        themeCss: THEME,
        onHaptics: (request, trigger) => calls.push({ request, trigger }),
      },
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ request: { kind: 'notification', type: 'Success' }, trigger: 'mount' })
  })

  it('active:haptic-medium fires on every onPressIn', async () => {
    const calls: Capture[] = []
    handle = await renderWithCss(
      `import { Pressable } from 'react-native'
       export default () => (
         <Pressable className="active:haptic-medium" testID="btn" />
       )`,
      {
        themeCss: THEME,
        onHaptics: (request, trigger) => calls.push({ request, trigger }),
      },
    )
    const button = handle.getByTestId('btn')
    const pressIn = (button.props as { onPressIn?: (event: unknown) => void }).onPressIn
    expect(typeof pressIn).toBe('function')
    pressIn?.({})
    pressIn?.({})
    expect(calls).toEqual([
      { request: { kind: 'impact', style: 'Medium' }, trigger: 'pressIn' },
      { request: { kind: 'impact', style: 'Medium' }, trigger: 'pressIn' },
    ])
  })

  it('haptic-selection fires selection request on mount', async () => {
    const calls: Capture[] = []
    handle = await renderWithCss(
      `import { View } from 'react-native'
       export default () => <View className="haptic-selection" testID="t" />`,
      {
        themeCss: THEME,
        onHaptics: (request, trigger) => calls.push({ request, trigger }),
      },
    )
    expect(calls).toEqual([{ request: { kind: 'selection' }, trigger: 'mount' }])
  })
})

describe('rnwind — dev warnings for missing providers', () => {
  let warnSpy: ReturnType<typeof spyOn>
  beforeEach(() => {
    warnSpy = spyOn(console, 'warn')
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('warns when a haptic class is used without onHaptics', async () => {
    handle = await renderWithCss(
      `import { View } from 'react-native'
       export default () => <View className="haptic-light" testID="t" />`,
      { themeCss: THEME },
    )
    const messages = warnSpy.mock.calls.map((args: unknown[]) => String(args[0] ?? ''))
    expect(messages.some((m: string) => m.includes('onHaptics'))).toBe(true)
  })

  it('warns when a safe-area class is used without insets', async () => {
    handle = await renderWithCss(
      `import { View } from 'react-native'
       export default () => <View className="pt-safe" testID="t" />`,
      { themeCss: THEME },
    )
    const messages = warnSpy.mock.calls.map((args: unknown[]) => String(args[0] ?? ''))
    expect(messages.some((m: string) => m.includes('insets'))).toBe(true)
  })
})
