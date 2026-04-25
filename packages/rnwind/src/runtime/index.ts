



export {
  lookupCss,
  registerAtoms,
  registerBreakpoints,
  registerSchemeLoader,
  setWindowHeightProvider,
  getBreakpoints,
  activeBreakpointFor,
  lookupCss as _l,
} from './lookup-css'
export { useR_ } from './components/rnwind-provider'
export type { HoistedClassName, InteractState, LookupInsets, SafeMarkerSpec } from './lookup-css'
export { useCss } from './hooks/use-css'
export { useInteract } from './hooks/use-interact'
export type { UseInteractResult } from './hooks/use-interact'
export { chainPress, chainFocus } from './chain-handlers'
export { InteractiveBox, InteractiveBox as _ib } from './interactive-box'
export type { InteractiveBoxProps, InteractiveSpec } from './interactive-box'
export { RnwindProvider, useRnwind } from './components/rnwind-provider'
export type { RnwindProviderProps, RnwindState, Insets } from './components/rnwind-provider'
export { useMountHaptic, triggerHaptic, triggerHaptic as _ht, useMountHaptic as _hm } from './haptics'

// ──────────────────────────────────────────────────────────────────────
// Internal aliases the babel transformer uses. Underscore-prefixed so
// user code (which imports the public names above) can never collide
// with what we inject at JSX sites — even if the user shadows
// `lookupCss` / `useHaptics` / `InteractiveBox` with a local symbol,
// the transformer's emitted code still references the private alias.
// Don't import these in app code.
// ──────────────────────────────────────────────────────────────────────
/** @internal */

/** @internal */

/** @internal */

/** @internal */

export type { HapticRequest, HapticTrigger, OnHaptics } from '../core/parser/haptics'
export type { AsLinearGradientProps, LinearGradientPoint } from './gradient-types'
export type { ThemeTable, ThemeTables } from '../core/types'
export { useTheme, useToken, useColor, useSize } from './hooks/use-scheme'
export type { Scheme, RnwindConfig } from './types'

/**
 * Installed rnwind version, inlined at publish time. Compare against a pinned
 * string when integrating with build tooling that may see multiple rnwind
 * copies (e.g. workspace overrides).
 */
export const VERSION = '0.0.1' as const
