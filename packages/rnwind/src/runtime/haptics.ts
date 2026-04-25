/**
 * Runtime helpers the transformer injects for haptic utilities.
 *
 * Two entry points:
 *
 *   useMountHaptic(requests) — fires each request on mount via
 *     `useEffect(() => { ... }, [])`. Used by the transformer for bare
 *     `haptic-*` atoms (no variant prefix).
 *
 *   triggerHaptic(onHaptics, request, trigger) — thin forwarding
 *     helper for event-driven variants (`active:haptic-*`, `focus:...`,
 *     `hover:...`). The transformer emits an inline arrow that calls
 *     this from `onPressIn` / `onFocus` / etc.
 *
 * Both emit a one-shot dev-mode warning when `onHaptics` is missing —
 * so developers get a clear "you forgot to wire <SchemeProvider
 * onHaptics=...>" signal instead of silently dropping the haptic.
 */

import { useEffect } from 'react'
import type { HapticRequest, HapticTrigger, OnHaptics } from '../core/parser/haptics'
import { useRnwind } from './components/rnwind-provider'

/**
 * Module-scope set tracking haptic trigger strings we've already
 * warned about. Prevents the "missing onHaptics" warning from
 * spamming the console when the same class appears on many elements.
 */
const WARNED_MISSING_HAPTICS = new Set<string>()

/**
 * Render a `HapticRequest` as a short descriptive tag for log lines.
 * @param request Haptic request.
 * @returns `impact/Light`, `notification/Success`, or `selection`.
 */
function hapticTag(request: HapticRequest): string {
  if (request.kind === 'impact') return `impact/${request.style}`
  if (request.kind === 'notification') return `notification/${request.type}`
  return 'selection'
}

/**
 * Warn once per haptic trigger kind when a `haptic-*` atom tries to
 * dispatch without an `onHaptics` provider. Dev-mode only — `__DEV__`
 * is a Metro / Expo / RN global that compiles to `false` in release
 * bundles, so no warn code ships to production.
 * @param request The haptic request that had no provider.
 * @param trigger The lifecycle trigger that tried to fire.
 */
function warnMissingOnHaptics(request: HapticRequest, trigger: HapticTrigger): void {
  // `__DEV__` is a RN / Metro global — `false` in release, strips the
  // branch entirely. Guarded in case we're evaluated outside of Metro
  // (tests, node scripts) where the global isn't defined.
  const isDevelopment = typeof __DEV__ === 'undefined' || __DEV__
  if (!isDevelopment) return
  const tag = hapticTag(request)
  const key = `${tag}@${trigger}`
  if (WARNED_MISSING_HAPTICS.has(key)) return
  WARNED_MISSING_HAPTICS.add(key)
  // eslint-disable-next-line no-console
  console.warn(
    `rnwind: a haptic utility fired (${tag}, trigger=${trigger}) but no onHaptics callback is wired on <SchemeProvider>. ` +
      `Pass \`onHaptics\` on the provider to forward this to expo-haptics (or any library of your choice).`,
  )
}

/**
 * Test-only hook — clears the warned-haptics set so successive test
 * runs don't silently swallow their own warnings.
 */
function __resetHapticWarnings(): void {
  WARNED_MISSING_HAPTICS.clear()
}

/**
 * Invoke every request in `requests` on mount (once per component
 * mount), using the `onHaptics` dispatcher from the nearest
 * `<SchemeProvider>`. Missing-provider dev warnings fire via
 * {@link warnMissingOnHaptics}.
 *
 * Uses `useEffect(..., [])` — the requests array is identity-stable
 * (hoisted at module scope by the transformer), so re-firing on
 * re-renders isn't a concern.
 * @param requests Hoisted request list for this component.
 */
function useMountHaptic(requests: readonly HapticRequest[]): void {
  const { onHaptics } = useRnwind()
   
  useEffect(() => {
    for (const request of requests) {
      if (onHaptics) onHaptics(request, 'mount')
      else warnMissingOnHaptics(request, 'mount')
    }
    // requests is a hoisted stable reference — depending on onHaptics
    // identity keeps the effect fresh if the provider remounts with a
    // different dispatcher, while the hoisted const prevents a remount
    // from an inline `onHaptics={(r) => ...}`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onHaptics])
}

/**
 * Fire one haptic request through the provider dispatcher. Emits the
 * missing-provider dev warning when no dispatcher is wired. Designed
 * for the inline arrows the transformer synthesises:
 *
 *   onPressIn={(e) => { triggerHaptic(_h, _HR_xxx, 'pressIn'); user?.(e) }}
 * @param onHaptics Provider dispatcher (may be undefined).
 * @param request Pre-hoisted request object.
 * @param trigger Lifecycle trigger.
 */
function triggerHaptic(onHaptics: OnHaptics | undefined, request: HapticRequest, trigger: HapticTrigger): void {
  if (onHaptics) {
    onHaptics(request, trigger)
    return
  }
  warnMissingOnHaptics(request, trigger)
}

export { useMountHaptic, triggerHaptic, __resetHapticWarnings }
