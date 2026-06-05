import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import type { File } from '@babel/types'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildWrapModules, rewriteWrapImports } from '../../src/metro/wrap-imports'
import { configureRnwindState, resetRnwindState, transform } from '../../src/metro'

const gen = (generate as unknown as { default?: typeof generate }).default ?? generate

/**
 * Parse → wrap-imports → regenerate, used by the pure-AST unit tests.
 * @param source Source text.
 * @returns Regenerated code.
 */
function wrap(source: string): string {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) as unknown as File
  rewriteWrapImports(ast, buildWrapModules())
  return gen(ast).code
}

describe('rewriteWrapImports — pure AST', () => {
  it('aliases a react-native component import and binds a wrap() const', () => {
    const out = wrap(`import { View } from 'react-native'\nexport default () => <View className="p-4" />`)
    expect(out).toContain(`import { wrap as _rnwWrap } from "rnwind"`)
    expect(out).toMatch(/import \{ View as _rnw0 \} from ['"]react-native['"]/)
    expect(out).toMatch(/const View = _rnwWrap\(_rnw0\)/)
  })

  it('leaves non-component react-native exports (StyleSheet, Platform) untouched', () => {
    const out = wrap(`import { View, StyleSheet, Platform } from 'react-native'\nexport default () => <View />`)
    expect(out).toMatch(/const View = _rnwWrap\(_rnw0\)/)
    // StyleSheet / Platform stay in the original (now-aliased) import, unwrapped.
    expect(out).not.toContain('_rnwWrap(StyleSheet')
    expect(out).not.toMatch(/const StyleSheet = _rnwWrap/)
    expect(out).not.toMatch(/const Platform = _rnwWrap/)
  })

  it('wraps every named export of an `all`-policy module (expo-linear-gradient)', () => {
    const out = wrap(`import { LinearGradient } from 'expo-linear-gradient'\nexport default () => <LinearGradient />`)
    expect(out).toMatch(/const LinearGradient = _rnwWrap\(_rnw0\)/)
  })

  it('`all` policy wraps components but NEVER hooks / contexts / enum exports', () => {
    const out = wrap(
      `import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets, SafeAreaInsetsContext } from 'react-native-safe-area-context'
       export default () => <SafeAreaView />`,
    )
    // Components → wrapped.
    expect(out).toMatch(/const SafeAreaProvider = _rnwWrap/)
    expect(out).toMatch(/const SafeAreaView = _rnwWrap/)
    // Hook (camelCase) → left alone, so `useSafeAreaInsets()` stays callable.
    expect(out).not.toMatch(/const useSafeAreaInsets = _rnwWrap/)
    expect(out).toContain('useSafeAreaInsets')
    // React context → left alone, so `.Provider` access survives.
    expect(out).not.toMatch(/const SafeAreaInsetsContext = _rnwWrap/)
  })

  it('namespace-wraps a default import so `Animated.View className` resolves', () => {
    const out = wrap(`import Animated from 'react-native-reanimated'\nexport default () => <Animated.View className="p-4" />`)
    // Default import aliased + bound through the namespace wrapper, so
    // member access `Animated.View` returns a wrapped component.
    expect(out).toContain(`import { wrap as _rnwWrap, wrapNamespace as _rnwWrapNs } from "rnwind"`)
    expect(out).toMatch(/import _rnw0 from ['"]react-native-reanimated['"]/)
    expect(out).toMatch(/const Animated = _rnwWrapNs\(_rnw0\)/)
  })

  it('namespace-wraps a `* as` namespace import', () => {
    const out = wrap(`import * as Reanimated from 'react-native-reanimated'\nexport default () => <Reanimated.View className="p-4" />`)
    expect(out).toMatch(/const Reanimated = _rnwWrapNs\(_rnw0\)/)
  })

  it('`all` policy skips gesture-handler enum / namespace exports', () => {
    const out = wrap(
      `import { GestureDetector, Gesture, State, Directions } from 'react-native-gesture-handler'
       export default () => <GestureDetector />`,
    )
    expect(out).toMatch(/const GestureDetector = _rnwWrap/)
    expect(out).not.toMatch(/const Gesture = _rnwWrap/)
    expect(out).not.toMatch(/const State = _rnwWrap/)
    expect(out).not.toMatch(/const Directions = _rnwWrap/)
  })

  it('never wraps a type-only import declaration (`import type { … }`)', () => {
    // `import type { SharedValue }` is stripped at runtime by preset-typescript;
    // wrapping it emits `const SharedValue = wrap(_rnwN)` referencing a binding
    // that no longer exists → Hermes "Property '_rnwN' doesn't exist".
    const out = wrap(
      `import { View } from 'react-native'
       import type { SharedValue } from 'react-native-reanimated'
       export default () => <View className="p-4" />`,
    )
    expect(out).toMatch(/const View = _rnwWrap\(_rnw0\)/)
    expect(out).not.toMatch(/const SharedValue = _rnwWrap/)
    expect(out).not.toMatch(/SharedValue as _rnw/)
  })

  it('never wraps an inline type-only specifier (`import { type X }`)', () => {
    const out = wrap(
      `import { GestureDetector, type GestureType } from 'react-native-gesture-handler'
       export default () => <GestureDetector />`,
    )
    expect(out).toMatch(/const GestureDetector = _rnwWrap\(_rnw0\)/)
    expect(out).not.toMatch(/const GestureType = _rnwWrap/)
    expect(out).not.toMatch(/GestureType as _rnw/)
  })

  it('never wraps reanimated animation builders / enums (only the default Animated namespace)', () => {
    // `FadeIn.duration()` / `new Keyframe()` / `SensorType.X` must survive —
    // wrapping these PascalCase non-components turned them into wrap()ed funcs.
    const out = wrap(
      `import Animated, { FadeIn, ZoomIn, Keyframe, Layout, SensorType, useSharedValue } from 'react-native-reanimated'
       export default () => <Animated.View className="p-4" />`,
    )
    // Default namespace still wraps (that's the real styleable surface).
    expect(out).toMatch(/const Animated = _rnwWrapNs\(_rnw0\)/)
    // None of the named builders / enums get a wrap const.
    expect(out).not.toMatch(/const FadeIn = _rnwWrap/)
    expect(out).not.toMatch(/const ZoomIn = _rnwWrap/)
    expect(out).not.toMatch(/const Keyframe = _rnwWrap/)
    expect(out).not.toMatch(/const Layout = _rnwWrap/)
    expect(out).not.toMatch(/const SensorType = _rnwWrap/)
  })

  it('never wraps gesture-handler enum exports (PointerType / MouseButton / HoverEffect)', () => {
    const out = wrap(
      `import { GestureDetector, PointerType, MouseButton, HoverEffect } from 'react-native-gesture-handler'
       export default () => <GestureDetector />`,
    )
    expect(out).toMatch(/const GestureDetector = _rnwWrap/)
    expect(out).not.toMatch(/const PointerType = _rnwWrap/)
    expect(out).not.toMatch(/const MouseButton = _rnwWrap/)
    expect(out).not.toMatch(/const HoverEffect = _rnwWrap/)
  })

  it('does not touch imports from an unlisted module', () => {
    const out = wrap(`import { Box } from '@acme/ui'\nexport default () => <Box className="p-4" />`)
    expect(out).not.toContain('_rnwWrap')
    expect(out).toContain(`import { Box } from '@acme/ui'`)
  })

  it('merges an extra user module via buildWrapModules', () => {
    const ast = parse(`import { Card } from '@acme/ui'\nexport default () => <Card />`, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    }) as unknown as File
    rewriteWrapImports(ast, buildWrapModules(['@acme/ui']))
    expect(gen(ast).code).toMatch(/const Card = _rnwWrap\(_rnw0\)/)
  })
})

describe('transform — forwarder ({...rest}) with no literal className', () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'rnwind-fwd-'))
    const cssPath = path.join(projectRoot, 'global.css')
    writeFileSync(cssPath, `@import "tailwindcss";`)
    configureRnwindState(cssPath, path.join(projectRoot, '.rnwind-cache'))
  })

  afterEach(() => {
    resetRnwindState()
    if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true })
  })

  it('wraps the host import so a spread-forwarded className resolves at render', async () => {
    const source = `import { Pressable } from 'react-native'
      export const Button = (props) => <Pressable {...props} />`
    const filename = path.join(projectRoot, 'Button.tsx')
    writeFileSync(filename, source)
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    const result = await transform({ filename, src: source, options: { projectRoot }, ast: ast as never })
    const out = gen(result.ast).code
    // No className= literal here, but the spread means className can flow
    // through → the import MUST be wrapped.
    expect(out).toMatch(/const Pressable = _rnwWrap\(_rnw0\)/)
    expect(out).toContain('{...props}')
  })

  it('leaves a style-less host usage (no className, no spread) untouched', async () => {
    const source = `import { View } from 'react-native'
      export const Spacer = () => <View />`
    const filename = path.join(projectRoot, 'Spacer.tsx')
    writeFileSync(filename, source)
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    const result = await transform({ filename, src: source, options: { projectRoot }, ast: ast as never })
    const out = gen(result.ast).code
    expect(out).not.toContain('_rnwWrap')
  })

  // Regression: a className file that also has a type-only reanimated import
  // (`import type { SharedValue }`) used to emit `const SharedValue =
  // wrap(_rnw3)` while preset-typescript stripped the `_rnw3` binding →
  // runtime "Property '_rnw3' doesn't exist". Every wrap()ed alias must have a
  // matching VALUE import declaration in the same output.
  it('emits no wrap binding that references a stripped type-only import (the _rnwN crash)', async () => {
    const source = `import { View } from 'react-native'
      import type { SharedValue } from 'react-native-reanimated'
      export const Box = () => <View className="p-4" />`
    const filename = path.join(projectRoot, 'pager.tsx')
    writeFileSync(filename, source)
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    const result = await transform({ filename, src: source, options: { projectRoot }, ast: ast as never })
    const out = gen(result.ast).code
    // The type-only import contributes no runtime binding and no wrap const.
    expect(out).not.toMatch(/const SharedValue = _rnwWrap/)
    // Every `_rnwWrap(_rnwN)` alias must be declared by an import in the output.
    for (const [, alias] of out.matchAll(/_rnwWrap\((_rnw\d+)\)/g)) {
      expect(out).toMatch(new RegExp(String.raw`as ${alias}\b`))
    }
  })
})
