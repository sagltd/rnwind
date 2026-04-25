/**
 * Haptic-atom extractor.
 *
 * rnwind's haptic utilities are declared in preset.css as `@utility`
 * rules that write a single `--rnwind-haptic: <kind>[-<value>]` custom
 * property. Lightningcss surfaces those custom-property writes on the
 * style rule's declaration list; this module converts the raw marker
 * text into a structured {@link HapticRequest} the transformer can
 * hoist into JSX.
 *
 * Marker vocabulary:
 *
 *   --rnwind-haptic: impact-Light | impact-Medium | impact-Heavy | impact-Soft | impact-Rigid;
 *   --rnwind-haptic: notification-Success | notification-Warning | notification-Error;
 *   --rnwind-haptic: selection;
 *
 * Everything else is returned as `null` so unknown markers don't leak
 * into the transformer's map.
 */

import type { Declaration as LcDeclaration, TokenOrValue } from 'lightningcss'
import { serializeTokens } from './tokens'

/**
 * Structured haptic request the `onHaptics` callback receives. Union
 * members mirror `expo-haptics`'s three entry points 1:1 so consumers
 * can index directly into the enum (`Haptics.ImpactFeedbackStyle[req.style]`).
 */
export type HapticRequest =
  | { readonly kind: 'impact'; readonly style: 'Light' | 'Medium' | 'Heavy' | 'Soft' | 'Rigid' }
  | { readonly kind: 'notification'; readonly type: 'Success' | 'Warning' | 'Error' }
  | { readonly kind: 'selection' }

/** When during a component's lifecycle the haptic was triggered. */
export type HapticTrigger = 'mount' | 'pressIn' | 'pressOut' | 'focus' | 'hover'

/** User-provided callback fired by rnwind when a haptic atom resolves. */
export type OnHaptics = (request: HapticRequest, trigger: HapticTrigger) => void

const IMPACT_STYLES = new Set(['Light', 'Medium', 'Heavy', 'Soft', 'Rigid'] as const)
type ImpactStyle = 'Light' | 'Medium' | 'Heavy' | 'Soft' | 'Rigid'
const NOTIFICATION_TYPES = new Set(['Success', 'Warning', 'Error'] as const)
type NotificationType = 'Success' | 'Warning' | 'Error'

/**
 * Parse the raw marker text (post-serialization) into a
 * {@link HapticRequest}, or `null` when the token is unrecognised.
 * Shape: `impact-<Style>`, `notification-<Type>`, or bare `selection`.
 * @param text Trimmed marker text.
 * @returns Haptic request, or null.
 */
function parseMarker(text: string): HapticRequest | null {
  if (text === 'selection') return { kind: 'selection' }
  if (text.startsWith('impact-')) {
    const style = text.slice('impact-'.length)
    if (IMPACT_STYLES.has(style as ImpactStyle)) return { kind: 'impact', style: style as ImpactStyle }
    return null
  }
  if (text.startsWith('notification-')) {
    const typeText = text.slice('notification-'.length)
    if (NOTIFICATION_TYPES.has(typeText as NotificationType)) {
      return { kind: 'notification', type: typeText as NotificationType }
    }
    return null
  }
  return null
}

/**
 * Inspect a rule's declaration list for a `--rnwind-haptic: <marker>`
 * custom property and return the structured request. Returns `null`
 * for rules that don't carry the marker.
 * @param declarations Declarations from one lightningcss style rule.
 * @returns Parsed haptic request, or null.
 */
function detectHapticAtom(declarations: readonly LcDeclaration[]): HapticRequest | null {
  for (const decl of declarations) {
    if (decl.property !== 'custom') continue
    const custom = decl.value as { name: { name: string } | string; value?: readonly TokenOrValue[] }
    const name = typeof custom.name === 'string' ? custom.name : custom.name.name
    if (name !== '--rnwind-haptic') continue
    const text = serializeTokens(custom.value ?? []).trim()
    return parseMarker(text)
  }
  return null
}

export { detectHapticAtom }
