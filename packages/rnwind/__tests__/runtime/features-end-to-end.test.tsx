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

/**
 * Theme with a scheme-dependent accent color (`--color-1`) — light value in
 * `@theme`, dark override in `@variant dark`. Mirrors the meetelios theme so
 * `text-1` carries both buckets.
 */
const ACCENT_THEME = `@import 'tailwindcss';
@custom-variant light (&:where(.scheme-light, .scheme-light *));
@custom-variant dark (&:where(.scheme-dark, .scheme-dark *));
@theme { --color-1: #fb6a3a; }
@layer theme { :root { @variant dark { --color-1: #ff7fa6; } } }
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

describe('useCss-only hook file — scanned + scheme-reactive end to end', () => {
  // A hook file whose ONLY rnwind use is useCss("text-1") — no className=.
  // Proves: (1) the class registers (file is scanned through the real
  // transform), (2) it resolves the active scheme's color.
  const source = `import { Text } from 'react-native'
     import { useCss } from 'rnwind'
     export default function Probe() {
       const s = useCss("text-1")
       return <Text testID="t" style={s} />
     }`

  it('resolves the LIGHT accent color', async () => {
    const handle = await render(source, { themeCss: ACCENT_THEME, scheme: 'light' })
    expect(flatten(handle.getByTestId('t').props.style).color).toBe('#fb6a3a')
  })

  it('resolves the DARK accent color (same class, different scheme)', async () => {
    const handle = await render(source, { themeCss: ACCENT_THEME, scheme: 'dark' })
    expect(flatten(handle.getByTestId('t').props.style).color).toBe('#ff7fa6')
  })
})

describe('design-system primitive — className forwarded to a wrapped host', () => {
  it('resolves when the primitive forwards className to RNPressable', async () => {
    const handle = await render(
      `import { Pressable as RNPressable } from 'react-native'
       function MyPressable({ children, className, ...rest }) {
         return <RNPressable className={className} {...rest}>{children}</RNPressable>
       }
       export default () => <MyPressable className="p-4" testID="p" />`,
    )
    // RNPressable is the auto-wrapped react-native Pressable; the primitive
    // forwards className to it, so the style resolves.
    expect(flatten(handle.getByTestId('p').props.style).padding).toBe(16)
  })

  it('resolves when the primitive keeps className in {...rest} (no destructure)', async () => {
    const handle = await render(
      `import { Pressable as RNPressable } from 'react-native'
       function MyPressable({ children, ...rest }) {
         return <RNPressable {...rest}>{children}</RNPressable>
       }
       export default () => <MyPressable className="p-4" testID="p" />`,
    )
    expect(flatten(handle.getByTestId('p').props.style).padding).toBe(16)
  })

  it('does NOT style when the primitive destructures className and never forwards it', async () => {
    const handle = await render(
      `import { Pressable as RNPressable } from 'react-native'
       function MyPressable({ children, className, ...rest }) {
         return <RNPressable {...rest}>{children}</RNPressable>
       }
       export default () => <MyPressable className="p-4" testID="p" />`,
    )
    // className is pulled out of the param list, so it's absent from {...rest}
    // and never reaches the wrapped RNPressable — plain JS, not an rnwind gap.
    const flat = flatten(handle.getByTestId('p').props.style)
    expect(flat.padding).toBeUndefined()
  })
})

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

describe('features — secondary class props', () => {
  it('resolves contentContainerClassName into contentContainerStyle on a ScrollView', async () => {
    const handle = await render(
      `import { ScrollView } from 'react-native'
       export default () => <ScrollView contentContainerClassName="p-4" testID="s" />`,
    )
    const node = handle.getByTestId('s')
    expect(flatten(node.props.contentContainerStyle).padding).toBe(16)
    // The raw *ClassName prop must NOT leak through to the host.
    expect(node.props.contentContainerClassName).toBeUndefined()
  })

  it('appends an existing contentContainerStyle after the resolved className (caller wins)', async () => {
    const handle = await render(
      `import { ScrollView } from 'react-native'
       export default () => <ScrollView contentContainerClassName="p-4" contentContainerStyle={{ padding: 99 }} testID="s" />`,
    )
    expect(flatten(handle.getByTestId('s').props.contentContainerStyle).padding).toBe(99)
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

  it('fires the haptic in the real interact-button shape (bg + active:bg + active:haptic + transition)', async () => {
    const fired: Array<{ trigger: string }> = []
    const handle = await render(
      `import { Pressable } from 'react-native'
       export default () => <Pressable className="flex-1 px-3 py-3 rounded-lg bg-sky-500 active:bg-sky-700 active:haptic-light items-center transition-colors duration-150" testID="p" />`,
      { themeCss: HAPTIC_THEME, onHaptics: (request, trigger) => fired.push({ trigger }) },
    )
    fireEvent(handle.getByTestId('p'), 'pressIn')
    expect(fired.some((entry) => entry.trigger === 'pressIn')).toBe(true)
  })
})
