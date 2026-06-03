import { createElement, useEffect, useRef, type ComponentType, type ReactElement } from 'react'
import { chainFocus, chainPress } from './chain-handlers'
import { useInteract } from './hooks/use-interact'
import { useRnwind } from './components/rnwind-provider'
import { resolve, type ResolvedCss } from './resolve'
import type { OnHaptics } from '../core/parser/haptics'

/** Matches a leading `active:` / `focus:` variant token (`\b` excludes `inactive:`). */
const INTERACTIVE_VARIANT = /\b(?:active|focus):/

/**
 * Whether a className needs press/focus state tracking.
 * @param className Raw className string.
 * @returns True when an `active:` / `focus:` variant is present.
 */
function hasInteractiveVariant(className: string): boolean {
  return INTERACTIVE_VARIANT.test(className)
}

/**
 * Best-effort display name for the wrapped component.
 * @param component Component being wrapped.
 * @returns Its `displayName`, `name`, or `'Component'`.
 */
function displayNameOf(component: unknown): string {
  const named = component as { displayName?: string; name?: string }
  return named.displayName ?? named.name ?? 'Component'
}

/**
 * Fire the `mount`-trigger haptics once, after the element mounts. Snaps
 * the resolved requests + dispatcher at mount via a `useRef` initializer
 * (evaluated only on the first render), so an unstable inline `onHaptics`
 * doesn't re-fire them and no ref is written during render.
 * @param resolved The resolved className (carries any haptic requests).
 * @param onHaptics The dispatcher from context (or undefined).
 */
function useMountHaptics(resolved: ResolvedCss, onHaptics: OnHaptics | undefined): void {
  const mount = useRef({ resolved, onHaptics })
  useEffect(() => {
    const { resolved: current, onHaptics: dispatch } = mount.current
    if (!dispatch || !current.haptics) return
    for (const entry of current.haptics) if (entry.trigger === 'mount') dispatch(entry.request, 'mount')
  }, [])
}

/**
 * Build the props for the wrapped host: resolved `style`, gradient
 * (`colors`/`start`/`end`), truncate (`numberOfLines`/`ellipsizeMode`),
 * and a chained `onPressIn` that fires press-trigger haptics. Unknown
 * props on a host are simply ignored by RN, so this stays generic.
 * @param rest Forwarded props (incl. `ref`).
 * @param resolved Resolved className result.
 * @param onHaptics Dispatcher from context.
 * @param userOnPressIn Caller-supplied onPressIn to chain after the haptic.
 * @returns The merged prop object for `createElement`.
 */
function buildProps(
  rest: Record<string, unknown>,
  resolved: ResolvedCss,
  onHaptics: OnHaptics | undefined,
  userOnPressIn?: unknown,
): Record<string, unknown> {
  const props: Record<string, unknown> = { ...rest, style: resolved.style }
  if (resolved.colors) {
    props.colors = resolved.colors
    props.start = resolved.start
    props.end = resolved.end
  }
  if (resolved.numberOfLines !== undefined) {
    props.numberOfLines = resolved.numberOfLines
    if (resolved.ellipsizeMode !== undefined) props.ellipsizeMode = resolved.ellipsizeMode
  }
  const pressHaptics = onHaptics && resolved.haptics?.filter((entry) => entry.trigger === 'pressIn')
  if (pressHaptics && pressHaptics.length > 0) {
    const previous = userOnPressIn as ((event: unknown) => void) | undefined
    props.onPressIn = (event: unknown): void => {
      for (const entry of pressHaptics) onHaptics(entry.request, 'pressIn')
      previous?.(event)
    }
  } else if (userOnPressIn !== undefined) {
    props.onPressIn = userOnPressIn
  }
  return props
}

/** Props a leaf receives — the wrapped `as` tag plus forwarded props. */
interface LeafProps {
  readonly as: ComponentType<Record<string, unknown>>
  readonly className?: string
  readonly style?: unknown
  readonly [key: string]: unknown
}

/**
 * Non-interactive leaf: resolve className → style (+ features) and
 * forward. One context read, one molecule/atom resolve.
 * @param props Leaf props.
 * @param props.as
 * @param props.className
 * @param props.style
 * @param props.onPressIn
 * @returns The rendered `as` element.
 */
function PlainLeaf({ as: As, className, style, onPressIn, ...rest }: LeafProps): ReactElement {
  const state = useRnwind()
  const resolved = resolve(className, state, style)
  useMountHaptics(resolved, state.onHaptics)
  return createElement(As, buildProps(rest, resolved, state.onHaptics, onPressIn))
}

/**
 * Interactive leaf: tracks press/focus via `useInteract()`, feeds it into
 * `resolve` so `active:`/`focus:` atoms apply, and chains the
 * press/focus handlers.
 * @param props Leaf props.
 * @param props.as
 * @param props.className
 * @param props.style
 * @param props.onPressIn
 * @param props.onPressOut
 * @param props.onFocus
 * @param props.onBlur
 * @returns The rendered `as` element with interactive wiring.
 */
function InteractiveLeaf({ as: As, className, style, onPressIn, onPressOut, onFocus, onBlur, ...rest }: LeafProps): ReactElement {
  const state = useRnwind()
  const interact = useInteract()
  const resolved = resolve(className, state, style, interact.state)
  useMountHaptics(resolved, state.onHaptics)
  const props = buildProps(rest, resolved, state.onHaptics, onPressIn)
  props.onPressIn = chainPress(props.onPressIn as Parameters<typeof chainPress>[0], interact.onPressIn)
  props.onPressOut = chainPress(onPressOut as Parameters<typeof chainPress>[0], interact.onPressOut)
  props.onFocus = chainFocus(onFocus as Parameters<typeof chainFocus>[0], interact.onFocus)
  props.onBlur = chainFocus(onBlur as Parameters<typeof chainFocus>[0], interact.onBlur)
  return createElement(As, props)
}

/**
 * Wrap a component so its `className` prop resolves to RN `style` (plus
 * gradient / truncate props and haptic dispatch) at render — no matter
 * how className arrived: written directly, spread through `{...rest}`, or
 * forwarded down custom wrappers. The returned component is hook-free; it
 * dispatches to a plain or interactive leaf so non-interactive elements
 * never pay for press/focus state. `ref` (a normal prop in React 19) and
 * all other props forward untouched.
 * @example
 * ```tsx
 * const Pressable = wrap(RNPressable)
 * <Pressable className="active:bg-sky-700 px-4 haptic-light" onPress={fn} />
 * ```
 * @param Component Any component accepting a `style` prop.
 * @returns A component accepting `className`.
 */
export function wrap<P>(Component: ComponentType<P>): ComponentType<P & { className?: string }> {
  const as = Component as unknown as ComponentType<Record<string, unknown>>
  /**
   * The wrapped component — hook-free dispatcher to a leaf.
   * @param props Forwarded props with `className` intercepted.
   * @param props.className
   * @returns The rendered leaf.
   */
  function RnwindWrapped({ className, ...rest }: { className?: string; [key: string]: unknown }): ReactElement {
    if (className !== undefined && hasInteractiveVariant(className)) {
      return createElement(InteractiveLeaf, { as, className, ...rest })
    }
    return createElement(PlainLeaf, { as, className, ...rest })
  }
  RnwindWrapped.displayName = `wrap(${displayNameOf(Component)})`
  return RnwindWrapped as unknown as ComponentType<P & { className?: string }>
}
