/**
 * App-level configuration projected into the type system. Apps extend this
 * interface from their generated `rnwind-types.d.ts` — which rnwind writes
 * alongside the CSS theme on every Metro start — to narrow `Scheme` to the
 * exact scheme names declared in `global.css`.
 *
 * Left empty here so library code stays buildable without a generated
 * augmentation; `Scheme` falls back to `string` under that default.
 * @example
 * ```ts
 * // rnwind-types.d.ts (auto-generated)
 * declare module 'rnwind' {
 *   export interface RnwindConfig {
 *     themes: readonly ['light', 'dark', 'brand']
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RnwindConfig {}

/**
 * Type of the `scheme` prop + the value returned by `useScheme()`. Resolves
 * to the literal union declared on {@link RnwindConfig.themes} when the app
 * provides one via `rnwind-types.d.ts`; falls back to `string` otherwise so
 * consumers without generated types keep compiling.
 */
export type Scheme = RnwindConfig extends { themes: infer T }
  ? T extends readonly (infer S)[]
    ? Extract<S, string>
    : string
  : string
