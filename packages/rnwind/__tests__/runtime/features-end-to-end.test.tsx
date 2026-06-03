import { afterEach, describe, expect, it } from 'bun:test'
import { fireEvent } from '@testing-library/react-native'
import { flatten, renderWithCss } from '../../src/testing'

/**
 * End-to-end feature coverage for the wrap + resolve model. Each test
 * runs a real source string through the Metro transformer (which wraps
 * the host imports), evaluates the generated registries, and renders the
 * wrapped component — so the assertions exercise the exact pipeline a
 * production bundle ships: import-wrap → `resolve()` → host props.
 */

const PRIMARY_THEME = `@import 'tailwindcss';
@theme { --color-primary: #6366f1; }
`

/**
 * Theme that declares the rnwind haptic utility (normally shipped in
 * `preset.css`) so the parser surfaces a `HapticRequest` for it. Mirrors
 * the `@utility haptic-light { --rnwind-haptic: impact-Light }` rule.
 */
const HAPTIC_THEME = `@import 'tailwindcss';
@utility haptic-light { --rnwind-haptic: impact-Light; }
`

/**
 * Theme declaring the rnwind safe-area utility (from `preset.css`) so the
 * parser surfaces a safe-area marker the runtime resolves against insets.
 */
const SAFE_THEME = `@import 'tailwindcss';
@utility pt-safe { padding-top: env(safe-area-inset-top); }
`

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/**
 * Render a source through the full pipeline and queue its teardown.
 * @param source Source string to transform + render.
 * @param options renderWithCss options (theme, scheme, insets, onHaptics).
 * @returns The render handle.
 */
async function render(source: string, options?: Parameters<typeof renderWithCss>[1]): ReturnType<typeof renderWithCss> {
  const handle = await renderWithCss(source, options)
  cleanups.push(handle.cleanup)
  return handle
}

describe('features — molecule style', () => {
  it('resolves a static className to its pre-merged style', async () => {
    const handle = await render(
      `import { View } from 'react-native'
       export default () => <View className="bg-primary p-4" testID="box" />`,
      { themeCss: PRIMARY_THEME },
    )
    const flat = flatten(handle.getByTestId('box').props.style)
    expect(flat.backgroundColor).toBe('#6366f1')
    expect(flat.padding).toBe(16)
  })
})

describe('features — safe-area insets', () => {
  it('resolves `pt-safe` against the provider insets', async () => {
    const handle = await render(
      `import { View } from 'react-native'
       export default () => <View className="pt-safe" testID="box" />`,
      { themeCss: SAFE_THEME, insets: { top: 44 } },
    )
    expect(flatten(handle.getByTestId('box').props.style).paddingTop).toBe(44)
  })
})

describe('features — animations', () => {
  it('inlines keyframes into the resolved style for `animate-spin`', async () => {
    const handle = await render(
      `import { View } from 'react-native'
       export default () => <View className="animate-spin" testID="box" />`,
    )
    const flat = flatten(handle.getByTestId('box').props.style)
    // animationName becomes an inline keyframes object the RN/Reanimated CSS engine reads.
    expect(typeof flat.animationName).toBe('object')
  })
})

describe('features — text truncate', () => {
  it('maps `truncate` to numberOfLines + ellipsizeMode props', async () => {
    const handle = await render(
      `import { Text } from 'react-native'
       export default () => <Text className="truncate" testID="t">hi</Text>`,
    )
    const node = handle.getByTestId('t')
    expect(node.props.numberOfLines).toBe(1)
    expect(node.props.ellipsizeMode).toBe('tail')
  })
})

describe('features — gradients', () => {
  it('surfaces colors/start/end from a complete linear gradient', async () => {
    const handle = await render(
      `import { View } from 'react-native'
       export default () => <View className="bg-linear-to-r from-red-500 to-blue-500" testID="g" />`,
    )
    const node = handle.getByTestId('g')
    expect(Array.isArray(node.props.colors)).toBe(true)
    expect(node.props.colors).toHaveLength(2)
    expect(node.props.start).toBeDefined()
    expect(node.props.end).toBeDefined()
  })
})

describe('features — haptics', () => {
  it('dispatches a mount haptic through the provider onHaptics', async () => {
    const fired: Array<{ trigger: string }> = []
    await render(
      `import { View } from 'react-native'
       export default () => <View className="haptic-light" testID="h" />`,
      { themeCss: HAPTIC_THEME, onHaptics: (request, trigger) => fired.push({ trigger }) },
    )
    expect(fired.some((entry) => entry.trigger === 'mount')).toBe(true)
  })

  it('dispatches a press haptic for `active:haptic-light` on press-in', async () => {
    const fired: Array<{ trigger: string }> = []
    const handle = await render(
      `import { Pressable } from 'react-native'
       export default () => <Pressable className="active:haptic-light" testID="p" />`,
      { themeCss: HAPTIC_THEME, onHaptics: (request, trigger) => fired.push({ trigger }) },
    )
    fireEvent(handle.getByTestId('p'), 'pressIn')
    expect(fired.some((entry) => entry.trigger === 'pressIn')).toBe(true)
  })
})
