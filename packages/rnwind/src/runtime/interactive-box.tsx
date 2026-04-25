import { createElement, type ComponentType, type ElementType, type ReactElement } from 'react'
import { chainFocus, chainPress } from './chain-handlers'
import { useInteract } from './hooks/use-interact'
import { lookupCss, type HoistedClassName } from './lookup-css'
import type { RnwindState } from './components/rnwind-provider'

/**
 * Per-element "interactive" spec the transformer packs into the `_rw`
 * prop on every JSX site it rewrites for active/focus support. Carrying
 * it as one object prop (rather than four sibling props) keeps the
 * rewritten JSX legible and avoids colliding with any host component's
 * own naming.
 */
export interface InteractiveSpec {
  /** The original JSX tag (`Pressable`, `TextInput`, `Animated.View`, …). */
  readonly as: ElementType
  /** Hoisted atom-name array (or a dynamic classname string). */
  readonly cn: HoistedClassName | string | null | undefined
  /** Full rnwind context — `_t = useRnwind___()` from the call site. */
  readonly t: RnwindState
  /** Optional caller-supplied style forwarded as `lookupCss`'s 3rd arg. */
  readonly us?: unknown
}

/** Props InteractiveBox accepts — `_rw` plus anything to forward. */
export interface InteractiveBoxProps {
  /** Compile-time spec packed by the transformer. */
  readonly _rw: InteractiveSpec
  /** Every other prop passes through to the inner component. */
  readonly [key: string]: unknown
}

/**
 * Per-instance wrapper that drives `active:` / `focus:` variants. One
 * `useInteract()` hook per mounted `InteractiveBox` means each element
 * owns its own state — siblings never share `active` / `focus` flags.
 *
 * The transformer replaces
 *   `<Pressable className="active:bg-sky-700" onPress={x} />`
 * with
 *   `<InteractiveBox _rw={{as: Pressable, cn: _c0, t: _t}} onPress={x} />`.
 * @param props `_rw` spec + any props to forward to the inner component.
 * @returns Rendered element of the inner component with interact wiring.
 */
export function InteractiveBox(props: InteractiveBoxProps): ReactElement {
  const { _rw, onPressIn, onPressOut, onFocus, onBlur, ...rest } = props
  const interact = useInteract()
  const merged: Record<string, unknown> = {
    ...rest,
    style: lookupCss(_rw.cn, _rw.t, _rw.us, interact.state),
    onPressIn: chainPress(onPressIn as Parameters<typeof chainPress>[0], interact.onPressIn),
    onPressOut: chainPress(onPressOut as Parameters<typeof chainPress>[0], interact.onPressOut),
    onFocus: chainFocus(onFocus as Parameters<typeof chainFocus>[0], interact.onFocus),
    onBlur: chainFocus(onBlur as Parameters<typeof chainFocus>[0], interact.onBlur),
  }
  return createElement(_rw.as as ComponentType<Record<string, unknown>>, merged)
}
