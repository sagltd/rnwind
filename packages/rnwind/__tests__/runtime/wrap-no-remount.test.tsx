import { afterEach, describe, expect, it } from 'bun:test'
import { createElement, useEffect, type ReactNode } from 'react'
import { render } from '@testing-library/react-native'
import { wrap } from '../../src/runtime/wrap'
import { RnwindProvider } from '../../src/runtime/components/rnwind-provider'
import { __resetLookupCssState, registerAtoms } from '../../src/runtime/lookup-css'
import { __resetResolveState } from '../../src/runtime/resolve'

afterEach(() => {
  __resetResolveState()
  __resetLookupCssState()
})

// Module-level mount counter — incremented in the child's mount effect. A
// remount of the subtree runs the effect again, so a stable subtree keeps the
// count at 1 across re-renders.
const mounts: { count: number } = { count: 0 }

/**
 * Child whose mount effect bumps the shared counter. Used to detect whether
 * the parent's subtree was unmounted + remounted between renders.
 * @returns Null.
 */
function MountCounter(): null {
  useEffect(() => {
    mounts.count += 1
  }, [])
  return null
}

/**
 * Minimal host that renders its children — stands in for an RN `View` so the
 * wrapped component has a subtree whose mount lifecycle we can observe.
 * @param props Host props.
 * @param props.children Child nodes.
 * @returns The children.
 */
function Host({ children }: { children?: ReactNode }): ReactNode {
  return children ?? null
}

const Wrapped = wrap(Host)

/**
 * Render `<Wrapped className=…>` with a mount-counting child under a provider.
 * @param className Class string to apply.
 * @returns Provider tree.
 */
function tree(className: string): ReactNode {
  return createElement(RnwindProvider, {} as never, createElement(Wrapped, { className } as never, createElement(MountCounter)))
}

describe('wrap — no subtree remount when className flips interactivity', () => {
  it('child stays mounted when className gains an `active:` variant', () => {
    registerAtoms('base', { 'px-4': { paddingHorizontal: 16 }, 'active:bg-blue-500': { backgroundColor: '#3b82f6' } })
    mounts.count = 0

    const { rerender } = render(tree('px-4') as never)
    expect(mounts.count).toBe(1)

    // Flip to an interactive className — previously this swapped PlainLeaf →
    // InteractiveLeaf (different component type) and remounted the subtree.
    rerender(tree('px-4 active:bg-blue-500') as never)
    expect(mounts.count).toBe(1)

    // …and back again — still no remount.
    rerender(tree('px-4') as never)
    expect(mounts.count).toBe(1)
  })
})
