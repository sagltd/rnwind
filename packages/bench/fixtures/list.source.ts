/**
 * Shared list fixture — a realistic chat/inbox row rendered N times.
 *
 * Why this shape: it's the archetypal RN screen where className cost
 * compounds — a scrolling list of ~10/100/1000 items, each with layout,
 * color, spacing, and typography classes. Two variants per item
 * (alternating background by index parity) so library caches key on
 * something other than "single string forever" but still hit the hot
 * path after warm-up.
 *
 * Every class below is in the intersection of what rnwind, NativeWind,
 * and Uniwind support out of the box. Adding new classes without
 * checking all three breaks the fairness contract — see
 * `fixtures/card.source.ts` for the same rule.
 */

/** Outer row: layout + padding + hairline separator. */
export const ROW_EVEN_CLASSES = 'flex-row items-center p-3 border-b border-gray-200 bg-white'
/** Alternating row: slightly tinted background to break cache monotony. */
export const ROW_ODD_CLASSES = 'flex-row items-center p-3 border-b border-gray-200 bg-gray-50'
/** Circular avatar placeholder. */
export const AVATAR_CLASSES = 'w-10 h-10 rounded-full bg-blue-500 mr-3'
/** Right-side text column. */
export const BODY_CLASSES = 'flex-1'
/** Row title. */
export const LIST_TITLE_CLASSES = 'text-base font-semibold text-gray-900'
/** Row subtitle. */
export const LIST_SUBTITLE_CLASSES = 'text-sm text-gray-500 mt-1'
/** Right-hand badge container. */
export const BADGE_CLASSES = 'px-2 py-1 rounded bg-green-100 ml-3'
/** Badge text. */
export const BADGE_TEXT_CLASSES = 'text-xs text-green-700 font-medium'

/**
 * Babel-rewrite fixture — rnwind + nativewind. Exports a `List(count)`
 * component that renders `count` `ListItem`s inside a parent View.
 */
export const JSX_LIST_CLASSNAME = `
function ListItem({ index }: { index: number }): any {
  const rowClass = index % 2 === 0 ? '${ROW_EVEN_CLASSES}' : '${ROW_ODD_CLASSES}'
  return (
    <View className={rowClass}>
      <View className="${AVATAR_CLASSES}" />
      <View className="${BODY_CLASSES}">
        <Text className="${LIST_TITLE_CLASSES}">Contact {index}</Text>
        <Text className="${LIST_SUBTITLE_CLASSES}">Last message preview line, short enough to render fast.</Text>
      </View>
      <View className="${BADGE_CLASSES}">
        <Text className="${BADGE_TEXT_CLASSES}">new</Text>
      </View>
    </View>
  )
}

export default function List({ count }: { count: number }): any {
  const items = []
  for (let i = 0; i < count; i++) items.push(<ListItem key={i} index={i} />)
  return <View>{items}</View>
}
`.trim()

/**
 * Uniwind HOC fixture — same tree, every host wrapped through
 * `withUniwind(...)` at module scope (how a Uniwind app is actually
 * written).
 */
export const JSX_LIST_HOC = `
const UWView = withUniwind(View)
const UWText = withUniwind(Text)

function ListItem({ index }: { index: number }): any {
  const rowClass = index % 2 === 0 ? '${ROW_EVEN_CLASSES}' : '${ROW_ODD_CLASSES}'
  return (
    <UWView className={rowClass}>
      <UWView className="${AVATAR_CLASSES}" />
      <UWView className="${BODY_CLASSES}">
        <UWText className="${LIST_TITLE_CLASSES}">Contact {index}</UWText>
        <UWText className="${LIST_SUBTITLE_CLASSES}">Last message preview line, short enough to render fast.</UWText>
      </UWView>
      <UWView className="${BADGE_CLASSES}">
        <UWText className="${BADGE_TEXT_CLASSES}">new</UWText>
      </UWView>
    </UWView>
  )
}

export default function List({ count }: { count: number }): any {
  const items = []
  for (let i = 0; i < count; i++) items.push(<ListItem key={i} index={i} />)
  return <UWView>{items}</UWView>
}
`.trim()

/**
 * Compose a full transform-ready source string for one library.
 * @param importLines Per-library imports the list body depends on.
 * @param body `JSX_LIST_CLASSNAME` or `JSX_LIST_HOC`.
 * @returns Full source.
 */
function makeListSource(importLines: string, body: string): string {
  return `${importLines}\n\n${body}\n`
}

/** Source as it looks to rnwind's Metro transformer. */
export const rnwindListSource = makeListSource(`import { View, Text } from 'react-native'`, JSX_LIST_CLASSNAME)

/** Source as it looks to nativewind's babel preset. */
export const nativewindListSource = makeListSource(`import { View, Text } from 'react-native'`, JSX_LIST_CLASSNAME)

/** Source as it looks to Uniwind — withUniwind HOC, no babel rewrite. */
export const uniwindListSource = makeListSource(
  `import { View, Text } from 'react-native'\nimport { withUniwind } from 'uniwind'`,
  JSX_LIST_HOC,
)
