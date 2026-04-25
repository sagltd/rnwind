/**
 * Tiny helpers that compose rnwind's press / focus handlers with any
 * user-provided ones the JSX site already has. The transformer uses
 * these when it rewrites a `<Pressable onPressIn={user}>` into
 * `<Pressable onPressIn={chainPress(user, _i.onPressIn)}>` so the user's
 * callback keeps firing.
 *
 * Both helpers bail out when the user's handler is `null` / `undefined`,
 * returning rnwind's handler directly — that gives the transformer a
 * cheap uniform rewrite ("always chain") without allocating a new
 * function per render when the user didn't opt in to the handler.
 */
import type { GestureResponderEvent, NativeSyntheticEvent, TargetedEvent } from 'react-native'

type PressHandler = (event: GestureResponderEvent) => void
type FocusHandler = (event: NativeSyntheticEvent<TargetedEvent>) => void

/**
 * Compose a user-supplied press handler with rnwind's internal one.
 * User fires first (its return / side-effects happen pre-gate flip); the
 * rnwind handler then updates the active flag.
 * @param user User-supplied handler from the original JSX (optional).
 * @param ours rnwind's internal active-toggling handler.
 * @returns Combined handler, or `ours` directly when the user didn't provide one.
 */
export function chainPress(user: PressHandler | null | undefined, ours: PressHandler): PressHandler {
  if (user == null) return ours
  return (event: GestureResponderEvent): void => {
    user(event)
    ours(event)
  }
}

/**
 * Compose a user-supplied focus/blur handler with rnwind's internal one.
 * Same ordering rule as {@link chainPress}: user first, rnwind second.
 * @param user User-supplied handler (optional).
 * @param ours rnwind's internal focus-toggling handler.
 * @returns Combined handler, or `ours` directly when the user didn't provide one.
 */
export function chainFocus(user: FocusHandler | null | undefined, ours: FocusHandler): FocusHandler {
  if (user == null) return ours
  return (event: NativeSyntheticEvent<TargetedEvent>): void => {
    user(event)
    ours(event)
  }
}
