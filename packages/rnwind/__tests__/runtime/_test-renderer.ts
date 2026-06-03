import * as ReactTestRenderer from 'react-test-renderer'

/**
 * Minimal `react-test-renderer` surface the runtime hook/provider tests
 * use. React 19 deprecated `react-test-renderer` and `@types/react-test-
 * renderer` now types `create()` in a way that drops `.unmount` / `.update`
 * (and may be hoisted in transitively from app workspaces). We still rely
 * on the runtime API — which is intact — so this re-exports `act` / `create`
 * under a stable, hand-written type. One cast, one place.
 */
export interface TestRenderer {
  /** Tear down the rendered tree. */
  unmount: () => void
  /** Re-render with a new element. */
  update: (element: unknown) => void
  /** Root test instance. */
  root: unknown
}

/** `react-test-renderer`'s `act`, typed for sync and async callbacks. */
export const act = ReactTestRenderer.act as (callback: () => void | Promise<void>) => void

/** `react-test-renderer`'s `create`, typed to the {@link TestRenderer} surface. */
export const create = ReactTestRenderer.create as unknown as (element: unknown) => TestRenderer
