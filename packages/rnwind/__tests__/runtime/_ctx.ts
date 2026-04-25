import type { RnwindState } from '../../src/runtime/components/rnwind-provider'

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 } as const

/**
 * Build a complete {@link RnwindState} for tests that exercise
 * `lookupCss(input, ctx, ...)`. Defaults to `'common'` scheme,
 * `fontScale: 1`, zero insets.
 * @param scheme Optional scheme override.
 * @param overrides Partial state to merge over the defaults.
 * @returns Full RnwindState.
 */
export function ctx(scheme: string = 'common', overrides: Partial<RnwindState> = {}): RnwindState {
  return {
    scheme: scheme as RnwindState['scheme'],
    tables: {},
    insets: ZERO_INSETS,
    onHaptics: undefined,
    fontScale: 1,
    windowWidth: 0,
    activeBreakpoint: 'base',
    ...overrides,
  }
}
