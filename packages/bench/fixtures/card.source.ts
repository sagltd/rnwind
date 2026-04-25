/**
 * Shared bench fixture: a 10-node Card component rendered with classes
 * every library under comparison supports. The perf numbers are only
 * honest if every library transforms the same source — so this file
 * holds one canonical source string and three tiny wrappers that import
 * the runtime each library ships.
 *
 * rnwind and nativewind both rewrite JSX at build time, so their
 * fixtures look identical — standard `<View className="…" />` source.
 * Uniwind takes a different architectural approach: no babel rewrite,
 * you opt in per-component via the `withUniwind` HOC. The uniwind
 * fixture therefore swaps the bare RN imports for `withUniwind(View)`
 * wrappers — that's the shape any real uniwind app renders.
 *
 * Fairness rules for editing this file:
 *
 *  - Never add a class that isn't in the intersection of what rnwind,
 *    nativewind, and uniwind ALL support out of the box.
 *  - Never change the JSX tree shape without updating every wrapper.
 *  - The `ACTIVE_CLASSES` / `IDLE_CLASSES` split powers the re-render
 *    scenario — keep both strings syntactically valid for all three.
 */

/** Classes applied when the card is in its "idle" state. */
export const IDLE_CLASSES = 'flex-1 p-4 bg-gray-100 rounded-lg border border-gray-300'
/** Classes applied when the card flips to "active" — used by the re-render bench. */
export const ACTIVE_CLASSES = 'flex-1 p-4 bg-red-500 rounded-lg border border-red-700'
/** Inner title classes, shared across states. */
export const TITLE_CLASSES = 'text-lg font-semibold text-gray-900'
/** Inner body classes, shared across states. */
export const BODY_CLASSES = 'text-sm text-gray-700 mt-2'
/** Footer row classes. */
export const FOOTER_CLASSES = 'flex-row items-center justify-between mt-4'
/** Footer label. */
export const LABEL_CLASSES = 'text-xs text-gray-500'
/** Footer CTA. */
export const CTA_CLASSES = 'px-3 py-1 bg-blue-500 rounded-md'
/** Footer CTA text. */
export const CTA_TEXT_CLASSES = 'text-sm text-white font-medium'

/**
 * JSX body used by rnwind + nativewind — both libraries rewrite
 * `<View className="…" />` call sites at build time, so the source is
 * unmodified stock React Native.
 *
 * Every className is a literal string — that's the static path every
 * library optimises for. Dynamic className expressions are covered
 * separately in the re-render scenario.
 */
export const JSX_BODY_CLASSNAME = `
export default function Card(): any {
  return (
    <View className="${IDLE_CLASSES}">
      <Text className="${TITLE_CLASSES}">Card title</Text>
      <Text className="${BODY_CLASSES}">Card body copy sits here and runs onto a second line for realism.</Text>
      <View className="${FOOTER_CLASSES}">
        <Text className="${LABEL_CLASSES}">Label</Text>
        <View className="${CTA_CLASSES}">
          <Text className="${CTA_TEXT_CLASSES}">Action</Text>
        </View>
      </View>
    </View>
  )
}
`.trim()

/**
 * JSX body used by uniwind — identical tree, but each host component is
 * wrapped once via `withUniwind(...)` at module scope. That's the
 * idiomatic uniwind pattern; className is resolved by the HOC at render
 * time. Same static class strings as the other libraries' fixture.
 */
export const JSX_BODY_HOC = `
const UWView = withUniwind(View)
const UWText = withUniwind(Text)

export default function Card(): any {
  return (
    <UWView className="${IDLE_CLASSES}">
      <UWText className="${TITLE_CLASSES}">Card title</UWText>
      <UWText className="${BODY_CLASSES}">Card body copy sits here and runs onto a second line for realism.</UWText>
      <UWView className="${FOOTER_CLASSES}">
        <UWText className="${LABEL_CLASSES}">Label</UWText>
        <UWView className="${CTA_CLASSES}">
          <UWText className="${CTA_TEXT_CLASSES}">Action</UWText>
        </UWView>
      </UWView>
    </UWView>
  )
}
`.trim()

/**
 * Compose an import block + class constants + the JSX body into a
 * transform-ready source string.
 * @param importLines Per-library import statements.
 * @param body JSX body shape (`JSX_BODY_CLASSNAME` for babel-rewrite libs,
 *   `JSX_BODY_HOC` for uniwind).
 * @returns Full source string.
 */
export function makeSource(importLines: string, body: string): string {
  return `${importLines}\nconst ACTIVE = '${ACTIVE_CLASSES}'\nconst IDLE = '${IDLE_CLASSES}'\n\n${body}\n`
}

/** Source as it looks to rnwind's Metro transformer. */
export const rnwindSource = makeSource(`import { View, Text } from 'react-native'`, JSX_BODY_CLASSNAME)

/** Source as it looks to nativewind's babel preset. */
export const nativewindSource = makeSource(`import { View, Text } from 'react-native'`, JSX_BODY_CLASSNAME)

/**
 * Source as it looks to uniwind — no babel rewrite, so the HOC is
 * applied in user code via `withUniwind(View)` at module scope.
 */
export const uniwindSource = makeSource(
  `import { View, Text } from 'react-native'\nimport { withUniwind } from 'uniwind'`,
  JSX_BODY_HOC,
)
