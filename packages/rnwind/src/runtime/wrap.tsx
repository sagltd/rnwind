import { createElement, useEffect, useRef, type ComponentType, type ReactElement } from 'react'
import { chainFocus, chainPress } from './chain-handlers'
import { useInteract } from './hooks/use-interact'
import { useRnwind } from './components/rnwind-provider'
import type { RnwindState } from './components/rnwind-provider'
import type { InteractState } from './lookup-css'
import { resolve, type ResolvedCss } from './resolve'
import type { OnHaptics } from '../core/parser/haptics'

/** Matches a leading `active:` / `focus:` variant token (`\b` excludes `inactive:`). */
const INTERACTIVE_VARIANT = /\b(?:active|focus):/

/** One-shot guard so the missing-`onHaptics` warning logs once per session. */
let warnedMissingOnHaptics = false

/**
 * Dev-only warning when a className carries a haptic utility but no
 * `onHaptics` dispatcher is wired on the nearest `<RnwindProvider>` — the
 * haptic would silently drop otherwise. Fires once per session.
 * @param onHaptics The dispatcher from context (or undefined).
 * @param haptics The resolved haptic requests (or undefined).
 */
function warnIfHapticsUnwired(onHaptics: OnHaptics | undefined, haptics: ResolvedCss['haptics']): void {
  if (onHaptics || !haptics || haptics.length === 0) return
  const isDevelopment = typeof __DEV__ === 'undefined' || __DEV__
  if (!isDevelopment || warnedMissingOnHaptics) return
  warnedMissingOnHaptics = true
  // eslint-disable-next-line no-console
  console.warn(
    'rnwind: a `haptic-*` utility resolved but no `onHaptics` callback is wired on <RnwindProvider>. ' +
      'Pass `onHaptics` on the provider to forward the request to expo-haptics (or any library).',
  )
}

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

/** Suffix marking a secondary class-prop (`contentContainerClassName`, …). */
const CLASSNAME_SUFFIX = 'ClassName'

/**
 * Resolve every secondary `<prefix>ClassName` prop (e.g.
 * `contentContainerClassName` on a ScrollView / FlatList) into its
 * matching `<prefix>Style`, in place. Any existing `<prefix>Style` is
 * appended last (caller wins). The original `*ClassName` prop is deleted
 * so RN never sees an unknown attribute. The primary `className` is
 * handled separately by the leaf and never reaches here.
 * @param props Mutable prop object being assembled for the host.
 * @param state Rnwind context for resolution.
 * @param interactState Live press/focus state so `active:`/`focus:` variants
 *   on a secondary class prop resolve too (undefined for non-interactive).
 */
function applyContainerClassNames(
  props: Record<string, unknown>,
  state: RnwindState,
  interactState?: InteractState,
): void {
  for (const key of Object.keys(props)) {
    if (!key.endsWith(CLASSNAME_SUFFIX)) continue
    const value = props[key]
    if (typeof value !== 'string') continue
    const styleKey = `${key.slice(0, -CLASSNAME_SUFFIX.length)}Style`
    props[styleKey] = resolve(value, state, props[styleKey], interactState).style
    delete props[key]
  }
}

/**
 * Build the props for the wrapped host: resolved `style`, gradient
 * (`colors`/`start`/`end`), truncate (`numberOfLines`/`ellipsizeMode`),
 * secondary `<prefix>ClassName` → `<prefix>Style`, and a chained
 * `onPressIn` that fires press-trigger haptics. Unknown props on a host
 * are simply ignored by RN, so this stays generic.
 * @param rest Forwarded props (incl. `ref`).
 * @param resolved Resolved className result.
 * @param state Rnwind context — used to resolve secondary class props.
 * @param onHaptics Dispatcher from context.
 * @param userOnPressIn Caller-supplied onPressIn to chain after the haptic.
 * @param interactState Live press/focus state for secondary class props.
 * @returns The merged prop object for `createElement`.
 */
function buildProps(
  rest: Record<string, unknown>,
  resolved: ResolvedCss,
  state: RnwindState,
  onHaptics: OnHaptics | undefined,
  userOnPressIn?: unknown,
  interactState?: InteractState,
): Record<string, unknown> {
  warnIfHapticsUnwired(onHaptics, resolved.haptics)
  const props: Record<string, unknown> = { ...rest, style: resolved.style }
  applyContainerClassNames(props, state, interactState)
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

/** Props the wrapped renderer accepts — `className` plus forwarded props. */
interface WrappedProps {
  readonly className?: string
  readonly style?: unknown
  readonly onPressIn?: unknown
  readonly onPressOut?: unknown
  readonly onFocus?: unknown
  readonly onBlur?: unknown
  readonly [key: string]: unknown
}

/**
 * Wrap a component so its `className` prop resolves to RN `style` (plus
 * gradient / truncate props and haptic dispatch) at render — no matter
 * how className arrived: written directly, spread through `{...rest}`, or
 * forwarded down custom wrappers. `ref` (a normal prop in React 19) and all
 * other props forward untouched.
 *
 * A SINGLE stable component does the work and always calls `useInteract()`,
 * so its identity never changes when `className` flips between interactive
 * (`active:`/`focus:`) and not — swapping the rendered component type would
 * unmount + remount the whole host subtree (lost state, effect re-runs,
 * visual flash). `useInteract` is cheap and shares one idle-state ref, so the
 * always-on cost is a couple of `useState` cells; the press/focus handlers
 * and live state only wire in when the className actually needs them.
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
   * The wrapped component. Stable identity + unconditional hooks; branches
   * internally on whether the className carries an interactive variant.
   * @param props Forwarded props with `className` intercepted.
   * @param props.className Raw className string.
   * @param props.style Caller-supplied style, merged under the resolved style.
   * @param props.onPressIn Caller onPressIn — chained after haptics / interact.
   * @param props.onPressOut Caller onPressOut — chained with interact when active.
   * @param props.onFocus Caller onFocus — chained with interact when active.
   * @param props.onBlur Caller onBlur — chained with interact when active.
   * @returns The rendered `as` element.
   */
  function RnwindWrapped({ className, style, onPressIn, onPressOut, onFocus, onBlur, ...rest }: WrappedProps): ReactElement {
    const state = useRnwind()
    const interact = useInteract()
    const isInteractive = className !== undefined && hasInteractiveVariant(className)
    const interactState = isInteractive ? interact.state : undefined
    const resolved = resolve(className, state, style, interactState)
    useMountHaptics(resolved, state.onHaptics)
    const props = buildProps(rest, resolved, state, state.onHaptics, onPressIn, interactState)
    if (isInteractive) {
      props.onPressIn = chainPress(props.onPressIn as Parameters<typeof chainPress>[0], interact.onPressIn)
      props.onPressOut = chainPress(onPressOut as Parameters<typeof chainPress>[0], interact.onPressOut)
      props.onFocus = chainFocus(onFocus as Parameters<typeof chainFocus>[0], interact.onFocus)
      props.onBlur = chainFocus(onBlur as Parameters<typeof chainFocus>[0], interact.onBlur)
    } else {
      // Forward the caller's press/focus handlers untouched (onPressIn is
      // already set by buildProps, possibly haptic-chained).
      if (onPressOut !== undefined) props.onPressOut = onPressOut
      if (onFocus !== undefined) props.onFocus = onFocus
      if (onBlur !== undefined) props.onBlur = onBlur
    }
    return createElement(as, props)
  }
  RnwindWrapped.displayName = `wrap(${displayNameOf(Component)})`
  return RnwindWrapped as unknown as ComponentType<P & { className?: string }>
}

/**
 * Whether a namespace member name denotes a component to wrap —
 * PascalCase and not a React context (`*Context`). Lowercase utilities /
 * hooks (`createAnimatedComponent`, `spring`) pass through untouched.
 * @param name Member key.
 * @returns True when the member should be `wrap()`-ed.
 */
function isComponentMember(name: string): boolean {
  return /^[A-Z]/.test(name) && !name.endsWith('Context')
}

/**
 * Wrap a component NAMESPACE (a default/namespace import like reanimated's
 * `Animated`) so member access — `Animated.View`, `Animated.ScrollView` —
 * returns a `wrap()`-ed component whose `className` resolves at render.
 * Returns a Proxy: component members are wrapped lazily and memoised so
 * each access yields the SAME wrapped component (stable identity — React
 * would remount otherwise). Non-component members (`createAnimatedComponent`,
 * config objects) pass straight through.
 * @example
 * ```tsx
 * const Animated = wrapNamespace(RNReanimated)
 * <Animated.View className="enter-fade" />
 * ```
 * @param namespace The imported namespace object.
 * @returns A Proxy that wraps component members on access.
 */
export function wrapNamespace<T extends object>(namespace: T): T {
  const cache = new Map<string, unknown>()
  return new Proxy(namespace, {
    get(target, key, receiver): unknown {
      const value = Reflect.get(target, key, receiver)
      if (typeof key !== 'string' || !isComponentMember(key)) return value
      if (!value || (typeof value !== 'function' && typeof value !== 'object')) return value
      let wrapped = cache.get(key)
      if (wrapped === undefined) {
        wrapped = wrap(value as ComponentType<unknown>)
        cache.set(key, wrapped)
      }
      return wrapped
    },
  })
}
