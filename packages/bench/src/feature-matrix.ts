/**
 * Hand-maintained feature comparison across rnwind, NativeWind, and
 * Uniwind. Kept as a TS data table so the report renderer can emit it
 * straight to Markdown without a templating layer.
 *
 * Conservative scoring rules:
 *  - `yes`  — the library documents and ships the capability.
 *  - `partial` — supported but with notable caveats (noted in `note`).
 *  - `no`   — not supported, or requires external work the others don't.
 *
 * When a library's story changes, update the row AND re-run the bench
 * so the perf table and feature matrix ship together.
 */

/** Tri-state capability value. */
export type Support = 'yes' | 'partial' | 'no'

/** One capability row. */
export interface Feature {
  name: string
  description: string
  rnwind: Support
  nativewind: Support
  uniwind: Support
  /** Per-library caveats — keyed by library name when present. */
  note?: Partial<Record<'rnwind' | 'nativewind' | 'uniwind', string>>
}

export const features: readonly Feature[] = [
  {
    name: 'Tailwind v4 theme + variants',
    description: '`@theme`, `@custom-variant`, `@utility name-*` from a user CSS entry.',
    rnwind: 'yes',
    nativewind: 'no',
    uniwind: 'yes',
    note: { nativewind: 'NativeWind v4.2 tracks Tailwind v3.' },
  },
  {
    name: 'Build-time JSX rewrite',
    description: 'Babel/metro rewrites `<View className="…" />` call sites at build time.',
    rnwind: 'yes',
    nativewind: 'yes',
    uniwind: 'no',
    note: { uniwind: 'Runtime HOC (`withUniwind(...)`) instead of a babel rewrite.' },
  },
  {
    name: 'Styles live in StyleSheet.create',
    description: 'Resolved atoms compiled into numbered `StyleSheet.create` entries.',
    rnwind: 'yes',
    nativewind: 'partial',
    uniwind: 'yes',
    note: { nativewind: 'Goes through `react-native-css-interop` runtime first.' },
  },
  {
    name: 'Multiple scheme variants (not just light/dark)',
    description: 'Arbitrary scheme names declared in theme CSS and switched at runtime.',
    rnwind: 'yes',
    nativewind: 'no',
    uniwind: 'yes',
  },
  {
    name: 'Interactive variants (hover:, focus:)',
    description: 'Class-level pseudo-state variants that only apply on hover/focus.',
    rnwind: 'yes',
    nativewind: 'yes',
    uniwind: 'partial',
    note: { uniwind: 'Pressed/hover variants via data attributes, covered by runtime HOC.' },
  },
  {
    name: 'CSS keyframe animations',
    description: 'User-authored `@keyframes` compiled to RN style animations.',
    rnwind: 'yes',
    nativewind: 'yes',
    uniwind: 'yes',
  },
  {
    name: 'Reanimated CSS animations',
    description: '`animationName` / `animationDuration` driven by Reanimated on the UI thread.',
    rnwind: 'yes',
    nativewind: 'partial',
    uniwind: 'partial',
    note: {
      nativewind: 'Works but not on the UI thread by default.',
      uniwind: 'Some CSS animation features still landing.',
    },
  },
  {
    name: 'Arbitrary values (`[12px]`, `[#abc]`)',
    description: 'Tailwind arbitrary-value syntax inside class names.',
    rnwind: 'yes',
    nativewind: 'yes',
    uniwind: 'yes',
  },
  {
    name: 'Custom utilities via `@utility`',
    description: 'Author-defined utilities with suffix matching, picked up by Tailwind IntelliSense.',
    rnwind: 'yes',
    nativewind: 'no',
    uniwind: 'yes',
  },
  {
    name: 'Safe-area utilities (`pt-safe`, …)',
    description: 'Utilities that read `react-native-safe-area-context` at runtime.',
    rnwind: 'yes',
    nativewind: 'no',
    uniwind: 'partial',
    note: { uniwind: 'Requires opting into runtime-backed variables.' },
  },
  {
    name: 'TS autocomplete on every RN component',
    description: '`className=` prop typed across `View`, `Text`, `Pressable`, etc.',
    rnwind: 'yes',
    nativewind: 'yes',
    uniwind: 'partial',
    note: { uniwind: 'Only on components wrapped with `withUniwind(...)`.' },
  },
  {
    name: 'Zero runtime className parsing',
    description: 'Class strings resolved at build time; render-time work is a cache lookup.',
    rnwind: 'yes',
    nativewind: 'partial',
    uniwind: 'no',
    note: {
      nativewind: 'css-interop resolves at render via runtime tables.',
      uniwind: 'HOC parses className on every render.',
    },
  },
]
