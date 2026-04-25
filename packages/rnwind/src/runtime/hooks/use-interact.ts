import { useCallback, useMemo, useState } from 'react'
import type { GestureResponderEvent, NativeSyntheticEvent, TargetedEvent } from 'react-native'
import type { InteractState } from '../lookup-css'

/**
 * Idle state reference reused across every non-interactive render —
 * when neither `active` nor `focus` is true, every call site returns
 * the exact same object. That's the ~99 % path for a typical list row,
 * so sharing the ref is a legitimate allocation elimination.
 */
const IDLE_STATE: InteractState = { active: false, focus: false }

/**
 * Live interact-state snapshot plus the press/focus handlers the
 * transformer wires onto the JSX opening element. The state object is
 * referentially stable across renders when the underlying `active` /
 * `focus` flags don't change, which keeps `lookupCss` cache hits
 * aligned with React's render cadence (same state ref → same
 * resolved-array cache key → same reference back, no React diff
 * triggered).
 */
export interface UseInteractResult {
  /** Current interact flags — forwarded as the 4th arg to `lookupCss`. */
  state: InteractState
  /** Wired by the transformer onto `<Pressable onPressIn={…}>` etc. */
  onPressIn: (event: GestureResponderEvent) => void
  /** Wired by the transformer onto `<Pressable onPressOut={…}>` etc. */
  onPressOut: (event: GestureResponderEvent) => void
  /** Wired by the transformer onto `<TextInput onFocus={…}>` etc. */
  onFocus: (event: NativeSyntheticEvent<TargetedEvent>) => void
  /** Wired by the transformer onto `<TextInput onBlur={…}>` etc. */
  onBlur: (event: NativeSyntheticEvent<TargetedEvent>) => void
}

/**
 * React hook driving `active:` / `focus:` variants at runtime. The
 * transformer injects exactly one call per JSX element that uses an
 * interactive classname, caching the hook's result into a component-
 * local `_i` binding so every `lookupCss(…, _i.state)` site shares the
 * same snapshot per render.
 *
 * React Native's `Pressable` fires `onPressIn` / `onPressOut` on touch
 * down / release — the touch-device analogue of CSS `:active`. Text
 * fields use `onFocus` / `onBlur`. Both pairs drive `useState` Booleans;
 * unused handlers on elements that don't emit the corresponding event
 * are harmless no-ops.
 *
 * Result stability: both `state` and the returned wrapper object stay
 * reference-equal across renders unless `active` / `focus` actually
 * flip. Downstream `React.memo` + `lookupCss` caches hit on equal refs.
 * @returns Stable state + handler bundle.
 */
export function useInteract(): UseInteractResult {
  const [active, setActive] = useState(false)
  const [focus, setFocus] = useState(false)
  const onPressIn = useCallback(() => setActive(true), [])
  const onPressOut = useCallback(() => setActive(false), [])
  const onFocus = useCallback(() => setFocus(true), [])
  const onBlur = useCallback(() => setFocus(false), [])
  const state = useMemo<InteractState>(() => {
    if (!active && !focus) return IDLE_STATE
    return { active, focus }
  }, [active, focus])
  return useMemo(() => ({ state, onPressIn, onPressOut, onFocus, onBlur }), [state, onPressIn, onPressOut, onFocus, onBlur])
}
