import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useWindowDimensions } from 'react-native'
import type { ThemeTables } from '../../core/types'
import type { Scheme } from '../types'
import type { OnHaptics } from '../../core/parser/haptics'
import { activeBreakpointFor, BASE_BREAKPOINT, loadScheme } from '../lookup-css'

/**
 * Per-render safe-area insets snapshot. Bridge from any source
 * (`useSafeAreaInsets()`, expo-router insets, a manually computed
 * value) into the {@link RnwindProvider} — rnwind stays
 * library-agnostic.
 */
export type Insets = Readonly<{
  top: number
  right: number
  bottom: number
  left: number
}>

/**
 * Single value carried by the rnwind context. Every piece of runtime
 * state rnwind needs — scheme, theme tables, insets, font scale,
 * window width, active responsive breakpoint, optional haptic
 * dispatcher — lives on this one bag. Consumers read it via
 * {@link useRnwind} and either destructure or forward straight to
 * `lookupCss` / `useCss`.
 *
 * `activeBreakpoint` is the highest-threshold registered breakpoint
 * whose min-width is `<= windowWidth`, or `'base'` when below the
 * smallest one (mobile-first tier) or when no breakpoints are
 * registered yet (tests, bundles without rnwind-transformed sources).
 * Always a string — never null. Reactive: it updates with
 * `useWindowDimensions().width`, so consumers can branch on it
 * without a separate hook.
 */
export type RnwindState = Readonly<{
  scheme: Scheme
  tables: ThemeTables
  insets: Insets
  onHaptics: OnHaptics | undefined
  fontScale: number
  windowWidth: number
  activeBreakpoint: string
}>

/** Props accepted by {@link RnwindProvider}. */
export type RnwindProviderProps = Readonly<{
  scheme: Scheme
  tables?: ThemeTables
  insets?: Partial<Insets>
  onHaptics?: OnHaptics
  children?: ReactNode
}>

const EMPTY_TABLES: ThemeTables = {}
const ZERO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 }
const DEFAULT_STATE: RnwindState = {
  scheme: 'light' as Scheme,
  tables: EMPTY_TABLES,
  insets: ZERO_INSETS,
  onHaptics: undefined,
  fontScale: 1,
  windowWidth: 0,
  activeBreakpoint: BASE_BREAKPOINT,
}

/**
 * Normalise a `Partial<Insets>` into a complete {@link Insets}, returning
 * the shared {@link ZERO_INSETS} reference when nothing is supplied so
 * downstream memoisation stays stable.
 * @param partial Caller-supplied insets (or undefined).
 * @returns Complete insets record.
 */
function normaliseInsets(partial: Partial<Insets> | undefined): Insets {
  if (!partial) return ZERO_INSETS
  const top = partial.top ?? 0
  const right = partial.right ?? 0
  const bottom = partial.bottom ?? 0
  const left = partial.left ?? 0
  if (top === 0 && right === 0 && bottom === 0 && left === 0) return ZERO_INSETS
  return { top, right, bottom, left }
}

/** Single internal context the runtime reads from. */
const RnwindContext = createContext<RnwindState>(DEFAULT_STATE)

/**
 * Read rnwind's full runtime state — scheme, theme tables, insets,
 * fontScale, windowWidth, onHaptics — in one go. Pass the returned
 * value straight to `lookupCss` / `useCss`, or destructure what you
 * need.
 * @returns Active rnwind state under the nearest {@link RnwindProvider}.
 */
export function useRnwind(): RnwindState {
  return useContext(RnwindContext)
}

/**
 * Provider for rnwind's full runtime state. fontScale + windowWidth
 * come from `useWindowDimensions()` so they react to OS-level
 * orientation / accessibility-text-size changes automatically.
 * @param props Provider props.
 * @param props.scheme Active scheme name.
 * @param props.tables Optional pre-resolved token tables.
 * @param props.insets Optional safe-area insets.
 * @param props.onHaptics Optional haptic dispatcher.
 * @param props.children React subtree.
 * @returns Provider element.
 */
export function RnwindProvider({ scheme, tables, insets, onHaptics, children }: RnwindProviderProps): ReactNode {
  const normalized = normaliseInsets(insets)
  const { fontScale, width } = useWindowDimensions()
  const value = useMemo<RnwindState>(() => {
    loadScheme(scheme)
    return {
      scheme,
      tables: tables ?? EMPTY_TABLES,
      insets: normalized,
      onHaptics,
      fontScale,
      windowWidth: width,
      activeBreakpoint: activeBreakpointFor(width),
    }
  }, [scheme, tables, normalized, onHaptics, fontScale, width])
  return <RnwindContext.Provider value={value}>{children}</RnwindContext.Provider>
}
