/**
 * Baseline fixture — zero-library React Native.
 *
 * Every className-based library we bench compiles down to roughly
 * `<View style={…}>` with a `StyleSheet.create`-backed object. The
 * baseline IS that shape, authored directly: one `StyleSheet.create`
 * at module scope, `style={styles.key}` at each JSX site, same tree
 * topology and same resolved values as the Card / List fixtures.
 *
 * This fixture answers "what does pure React Native cost on this tree
 * without any className library at all?" — the honest floor. Every
 * library must approach this number to claim it's free at render time.
 *
 * Values here come from the same Tailwind classes every other library
 * uses, resolved to their RN-compatible forms:
 *   flex-1        → { flex: 1 }
 *   p-4           → { padding: 16 }
 *   bg-gray-100   → { backgroundColor: '#f3f4f6' }
 *   rounded-lg    → { borderRadius: 8 }
 *   border        → { borderWidth: 1 }
 *   border-gray-300 → { borderColor: '#d1d5db' }
 *   text-lg       → { fontSize: 18, lineHeight: 28 }
 *   font-semibold → { fontWeight: '600' }
 *   text-gray-900 → { color: '#111827' }
 *   text-sm       → { fontSize: 14, lineHeight: 20 }
 *   text-gray-700 → { color: '#374151' }
 *   mt-2          → { marginTop: 8 }
 *   flex-row      → { flexDirection: 'row' }
 *   items-center  → { alignItems: 'center' }
 *   justify-between → { justifyContent: 'space-between' }
 *   mt-4          → { marginTop: 16 }
 *   text-xs       → { fontSize: 12, lineHeight: 16 }
 *   text-gray-500 → { color: '#6b7280' }
 *   px-3          → { paddingHorizontal: 12 }
 *   py-1          → { paddingVertical: 4 }
 *   bg-blue-500   → { backgroundColor: '#3b82f6' }
 *   rounded-md    → { borderRadius: 6 }
 *   text-white    → { color: '#ffffff' }
 *   font-medium   → { fontWeight: '500' }
 */

/** Card fixture as pure RN — `StyleSheet.create` hoisted at module scope. */
export const JSX_CARD_BASELINE = `
const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, backgroundColor: '#f3f4f6', borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db' },
  title: { fontSize: 18, lineHeight: 28, fontWeight: '600', color: '#111827' },
  body: { fontSize: 14, lineHeight: 20, color: '#374151', marginTop: 8 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  label: { fontSize: 12, lineHeight: 16, color: '#6b7280' },
  cta: { paddingHorizontal: 12, paddingVertical: 4, backgroundColor: '#3b82f6', borderRadius: 6 },
  ctaText: { fontSize: 14, lineHeight: 20, color: '#ffffff', fontWeight: '500' },
})

export default function Card(): any {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Card title</Text>
      <Text style={styles.body}>Card body copy sits here and runs onto a second line for realism.</Text>
      <View style={styles.footer}>
        <Text style={styles.label}>Label</Text>
        <View style={styles.cta}>
          <Text style={styles.ctaText}>Action</Text>
        </View>
      </View>
    </View>
  )
}
`.trim()

/** List fixture as pure RN — same tree as list.source.ts, values resolved. */
export const JSX_LIST_BASELINE = `
const styles = StyleSheet.create({
  rowEven: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', backgroundColor: '#ffffff' },
  rowOdd: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', backgroundColor: '#f9fafb' },
  avatar: { width: 40, height: 40, borderRadius: 9999, backgroundColor: '#3b82f6', marginRight: 12 },
  body: { flex: 1 },
  title: { fontSize: 16, lineHeight: 24, fontWeight: '600', color: '#111827' },
  subtitle: { fontSize: 14, lineHeight: 20, color: '#6b7280', marginTop: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, backgroundColor: '#d1fae5', marginLeft: 12 },
  badgeText: { fontSize: 12, lineHeight: 16, color: '#047857', fontWeight: '500' },
})

function ListItem({ index }: { index: number }): any {
  const rowStyle = index % 2 === 0 ? styles.rowEven : styles.rowOdd
  return (
    <View style={rowStyle}>
      <View style={styles.avatar} />
      <View style={styles.body}>
        <Text style={styles.title}>Contact {index}</Text>
        <Text style={styles.subtitle}>Last message preview line, short enough to render fast.</Text>
      </View>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>new</Text>
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
 * Build the full baseline source string for one fixture.
 * @param body One of `JSX_CARD_BASELINE` / `JSX_LIST_BASELINE`.
 * @returns Full source ready to feed into the baseline babel pipeline.
 */
function makeBaselineSource(body: string): string {
  return `import { View, Text, StyleSheet } from 'react-native'\n\n${body}\n`
}

/** Card source as the baseline transform sees it. */
export const baselineCardSource = makeBaselineSource(JSX_CARD_BASELINE)

/** List source as the baseline transform sees it. */
export const baselineListSource = makeBaselineSource(JSX_LIST_BASELINE)
