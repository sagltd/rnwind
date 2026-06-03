import { afterEach, describe, expect, it } from 'bun:test'
import { createElement, type ComponentType } from 'react'
import { render } from '@testing-library/react-native'
import { wrap, wrapNamespace } from '../../src/runtime/wrap'
import { RnwindProvider } from '../../src/runtime/components/rnwind-provider'
import { __registerAtomsFromRecord, __resetLookupCssState } from '../../src/runtime/lookup-css'
import { __resetResolveState, registerGradients, registerHaptics, registerMolecules } from '../../src/runtime/resolve'

afterEach(() => {
  __resetResolveState()
  __resetLookupCssState()
})

/**
 * Build a leaf host mock that records the props it last received.
 * @returns The mock + a getter for its props.
 */
function makeHost(): { Host: ComponentType<Record<string, unknown>>; props: () => Record<string, unknown> } {
  let captured: Record<string, unknown> | null = null
  const Host: ComponentType<Record<string, unknown>> = (received): null => {
    captured = received
    return null
  }
  return { Host, props: () => captured as Record<string, unknown> }
}

describe('wrap — className resolves to style at render, any delivery', () => {
  it('resolves a className delivered via {...rest} spread into a molecule style', () => {
    registerMolecules('common', { 'items-center bg-primary': { alignItems: 'center', backgroundColor: '#4f46e5' } })
    const { Host, props } = makeHost()
    const Wrapped = wrap(Host)
    const rest = { className: 'items-center bg-primary', onPress: (): void => undefined }
    render(createElement(Wrapped, { ...rest }))
    expect(props().style).toEqual({ alignItems: 'center', backgroundColor: '#4f46e5' })
    expect(props().className).toBeUndefined()
    expect(props().onPress).toBeDefined()
  })

  it('wrapNamespace wraps component members so `Animated.View className` resolves', () => {
    registerMolecules('common', { 'p-4': { padding: 16 } })
    const { Host, props } = makeHost()
    const fakeAnimated = { View: Host, createAnimatedComponent: (): null => null }
    const Animated = wrapNamespace(fakeAnimated)
    // Member access yields a wrapped component (stable identity across reads).
    expect(Animated.View).toBe(Animated.View)
    expect(Animated.View).not.toBe(Host)
    // Lowercase utility passes straight through, untouched.
    expect(Animated.createAnimatedComponent).toBe(fakeAnimated.createAnimatedComponent)
    render(createElement(Animated.View, { className: 'p-4' }))
    expect(props().style).toEqual({ padding: 16 })
    expect(props().className).toBeUndefined()
  })

  it('atom fallback for an unregistered className', () => {
    __registerAtomsFromRecord({ 'p-4': { padding: 16 } })
    const { Host, props } = makeHost()
    const Wrapped = wrap(Host)
    render(createElement(Wrapped, { className: 'p-4' }))
    expect(props().style).toEqual([{ padding: 16 }])
  })

  it('spreads gradient props (colors/start/end)', () => {
    registerGradients({
      'bg-linear-to-r': { role: 'direction', dir: 'to-r' },
      'from-red-500': { role: 'from', color: '#ef4444' },
      'to-blue-500': { role: 'to', color: '#3b82f6' },
    })
    const { Host, props } = makeHost()
    const Wrapped = wrap(Host)
    render(createElement(Wrapped, { className: 'bg-linear-to-r from-red-500 to-blue-500' }))
    expect(props().colors).toEqual(['#ef4444', '#3b82f6'])
    expect(props().start).toEqual({ x: 0, y: 0.5 })
  })

  it('spreads truncate props', () => {
    const { Host, props } = makeHost()
    const Wrapped = wrap(Host)
    render(createElement(Wrapped, { className: 'line-clamp-2' }))
    expect(props().numberOfLines).toBe(2)
  })

  it('dispatches a mount haptic through the provider onHaptics', () => {
    registerHaptics({ 'haptic-light': { kind: 'impact', style: 'Light' } })
    const fired: unknown[] = []
    const { Host } = makeHost()
    const Wrapped = wrap(Host)
    render(
      createElement(
        RnwindProvider,
        { scheme: 'light' as never, onHaptics: (request: unknown, trigger: unknown) => fired.push({ request, trigger }) },
        createElement(Wrapped, { className: 'haptic-light' }),
      ),
    )
    expect(fired).toEqual([{ request: { kind: 'impact', style: 'Light' }, trigger: 'mount' }])
  })
})
