import { describe, expect, it } from 'bun:test'
import { parse } from '@babel/parser'
import generateModule from '@babel/generator'
import type { File } from '@babel/types'
import { transformAst, type TransformAstOptions } from '../../src/metro/transform-ast'

const generate = (generateModule as unknown as { default?: typeof generateModule }).default ?? generateModule

/**
 * Host-vs-custom detection — the rule that keeps `<MyButton className="…" />`
 * from being silently rewritten into `<MyButton style={…} />`. Custom
 * components own their `className` prop; only tags imported from a
 * known host source (or explicitly listed) get the compile-time rewrite.
 *
 * Default host sources: react-native, react-native-reanimated,
 * react-native-svg, react-native-gesture-handler, expo-linear-gradient,
 * expo-image. Users extend with `hostSources` / `hostComponents`.
 * @param source TSX source fragment.
 * @param options Transformer options (pass-through).
 * @returns Regenerated post-transform source.
 */
function run(source: string, options: Partial<TransformAstOptions> = {}): string {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) as unknown as File
  transformAst(ast, { styleSpecifiers: [], ...options })
  return generate(ast).code
}

describe('transform-ast — host detection', () => {
  it('rewrites className when the JSX tag is imported from `react-native`', () => {
    const out = run(`import { View } from 'react-native'; export default () => <View className="p-4 bg-card" />`)
    expect(out).toMatch(/style=\{_l\(_c_[0-9a-f]+, _t\)\}/)
    expect(out).not.toContain('className=')
  })

  it('LEAVES className alone when the JSX tag is a custom component (not from a host source)', () => {
    const out = run(
      `import { MyButton } from './my-button'
       export default () => <MyButton className="p-4 bg-card" />`,
    )
    expect(out).toContain('className="p-4 bg-card"')
    expect(out).not.toMatch(/style=\{_l/)
  })

  it('LEAVES className alone for an unimported (locally-declared) component', () => {
    const out = run(`function Local(_p: any) { return null }
       export default () => <Local className="p-4" />`)
    expect(out).toContain('className="p-4"')
    expect(out).not.toMatch(/style=\{_l/)
  })

  it('respects `Animated.View` (member expr) when `Animated` is from react-native-reanimated', () => {
    const out = run(
      `import Animated from 'react-native-reanimated'
       export default () => <Animated.View className="p-4" />`,
    )
    expect(out).toMatch(/style=\{_l\(_c_[0-9a-f]+, _t\)\}/)
  })

  it('LEAVES `Custom.Subcomponent` className alone (custom member expr)', () => {
    const out = run(
      `import { Custom } from './my-lib'
       export default () => <Custom.Sub className="p-4" />`,
    )
    expect(out).toContain('className="p-4"')
    expect(out).not.toMatch(/style=\{_l/)
  })

  it('rewrites tags from extra `hostSources` configured by the user', () => {
    const out = run(
      `import { Box } from '@my-org/primitives'
       export default () => <Box className="p-4" />`,
      { hostSources: ['@my-org/primitives'] },
    )
    expect(out).toMatch(/style=\{_l\(_c_[0-9a-f]+, _t\)\}/)
  })

  it('rewrites tags listed in `hostComponents` even when the import source is not host-listed', () => {
    const out = run(
      `import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view'
       export default () => <KeyboardAwareScrollView className="p-4" />`,
      { hostComponents: ['KeyboardAwareScrollView'] },
    )
    expect(out).toMatch(/style=\{_l\(_c_[0-9a-f]+, _t\)\}/)
  })

  it('skips contentContainerClassName rewrite on a custom component too', () => {
    const out = run(
      `import { CustomList } from './custom-list'
       export default () => <CustomList contentContainerClassName="px-4" />`,
    )
    expect(out).toContain('contentContainerClassName="px-4"')
    expect(out).not.toMatch(/contentContainerStyle=\{_l/)
  })

  it('rewrites contentContainerClassName when the tag IS host', () => {
    const out = run(
      `import { ScrollView } from 'react-native'
       export default () => <ScrollView contentContainerClassName="px-4" />`,
    )
    expect(out).toMatch(/contentContainerStyle=\{_l\(_c_[0-9a-f]+, _t\)\}/)
  })

  it('dynamic className on a custom component stays untouched (no `_l` injected)', () => {
    const out = run(
      `import { MyComp } from './my-comp'
       export default ({cn}: any) => <MyComp className={cn} />`,
    )
    expect(out).toContain('className={cn}')
    expect(out).not.toMatch(/_l\(cn/)
  })

  it('dynamic className on a host component IS rewritten to a runtime _l call', () => {
    const out = run(
      `import { View } from 'react-native'
       export default ({cn}: any) => <View className={cn} />`,
    )
    expect(out).toMatch(/style=\{_l\(/)
  })

  it('mixed host + custom in the same file rewrites only the host', () => {
    const out = run(
      `import { View } from 'react-native'
       import { Card } from './card'
       export default () => (
         <Card className="rounded-lg">
           <View className="p-4" />
         </Card>
       )`,
    )
    // Card.className stays as a literal
    expect(out).toContain('className="rounded-lg"')
    // View.className becomes style={_l(...)}
    expect(out).toMatch(/<View style=\{_l/)
  })

  it('rewrites `expo-linear-gradient` tags by default (gradient atoms need it)', () => {
    const out = run(
      `import { LinearGradient } from 'expo-linear-gradient'
       export default () => <LinearGradient className="p-4" />`,
    )
    expect(out).toMatch(/style=\{_l\(_c_[0-9a-f]+, _t\)\}/)
  })

  // Mirrors the real-world pattern in mobile-expanse: a project-local
  // `styled.ts` module re-exports third-party components, and consumers
  // import from the re-export. `hostSources` includes the re-export
  // specifier so the rewrite still engages on the inner host site.
  // (Dynamic className on a non-RN-known tag routes through `<_ib>`
  // since interactivity can't be ruled out from the call site — same
  // path any host with a dynamic className expression takes.)
  it('rewrites a tag imported from a re-export module when its specifier is in hostSources', () => {
    const out = run(
      `import { FlashList as StyledFlashList } from 'ui/src/components/styled'
       export default ({ cn }: any) => <StyledFlashList className={cn} />`,
      { hostSources: ['ui/src/components/styled'] },
    )
    // _ib spec packs the tag + dynamic className through the runtime resolver.
    expect(out).toMatch(/<_ib _rw=\{\{\s*as: StyledFlashList,\s*cn: cn,\s*t: _t\s*\}\}/)
    // Original className attribute is gone.
    expect(out).not.toContain('className={cn}')
  })

  it('does NOT rewrite the same re-exported tag when the specifier is NOT in hostSources', () => {
    const out = run(
      `import { FlashList as StyledFlashList } from 'ui/src/components/styled'
       export default ({ cn }: any) => <StyledFlashList className={cn} />`,
    )
    expect(out).toContain('className={cn}')
    expect(out).not.toMatch(/style=\{_l/)
  })

  // Regression: the InteractiveBox wrap mutates `JSXOpeningElement.name`
  // in-place from the original tag → `_ib`. Sibling attributes processed
  // by the visitor AFTER the swap used to see the new (`_ib`) name and
  // skip the host check, leaving prefixed-className siblings unrewritten.
  // The fix captures host status per ELEMENT once (keyed on object identity
  // via a WeakSet) so the post-swap reparent doesn't lose the classification.
  it('rewrites both className AND contentContainerClassName on a host element with active: tokens (post-_ib-swap)', () => {
    // Pressable is both (a) a host (from react-native) AND (b) not in the
    // NON_INTERACTIVE_HOST_TAGS allowlist, so its `active:` className DOES
    // trigger the InteractiveBox swap. The swap mutates `parent.name` from
    // `Pressable` → `_ib`; the bug under test is that the sibling
    // `contentContainerClassName` attribute, processed AFTER the swap,
    // re-classifies off the now-`_ib` name and skips the rewrite.
    const out = run(
      `import { Pressable } from 'react-native'
       export default ({ on }: any) => <Pressable className="active:bg-sky-700" contentContainerClassName="px-4" />`,
    )
    expect(out).toMatch(/<_ib _rw=\{\{\s*as: Pressable,\s*cn: _c_[0-9a-f]+/)
    expect(out).toMatch(/contentContainerStyle=\{_l\(_c_[0-9a-f]+, _t\)\}/)
    expect(out).not.toMatch(/contentContainerClassName=/)
  })

  // Regression: `mono-number.tsx` (and many RN libraries) declares a
  // module-local `const AnimatedX = Animated.createAnimatedComponent(X)`
  // and uses `<AnimatedX className="…">` later. Without recognising this
  // alias the transformer left className alone, the wrapped TextInput /
  // View ignored the className prop, and the user's font-size /
  // font-family changes never landed.
  it('treats `const X = Animated.createAnimatedComponent(Y)` locals as hosts (Reanimated alias)', () => {
    const out = run(
      `import Animated from 'react-native-reanimated'
       import { TextInput } from 'react-native'
       const AnimatedTextInput = Animated.createAnimatedComponent(TextInput)
       export default ({ cn }: any) => <AnimatedTextInput className={cn} />`,
    )
    expect(out).toMatch(/<_ib _rw=\{\{\s*as: AnimatedTextInput,\s*cn: cn,\s*t: _t/)
    expect(out).not.toContain('className={cn}')
  })

  it('treats `const X = createAnimatedComponent(Y)` (named import shape) as a host too', () => {
    const out = run(
      `import { createAnimatedComponent } from 'react-native-reanimated'
       import { TextInput } from 'react-native'
       const Animated = createAnimatedComponent(TextInput)
       export default () => <Animated className="text-3xl" />`,
    )
    expect(out).toMatch(/style=\{_l\(_c_[0-9a-f]+, _t\)\}/)
  })

  it('rewrites `react-native-svg` tags (Svg, Path, …) by default', () => {
    const out = run(
      `import Svg, { Path } from 'react-native-svg'
       export default () => (<Svg className="w-10 h-10"><Path className="fill-red-500" /></Svg>)`,
    )
    expect(out).toMatch(/<Svg style=\{_l/)
    expect(out).toMatch(/<Path style=\{_l/)
  })
})
