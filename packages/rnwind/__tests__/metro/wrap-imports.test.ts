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
})
