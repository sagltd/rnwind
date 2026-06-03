import { router } from 'expo-router'
import { ScrollView, Text, View, Pressable } from 'react-native'

const LABEL_CAPS = 'text-muted text-xs uppercase tracking-wider'
const CARD = 'p-5 rounded-xl bg-surface border border-border gap-3'

/**
 * Typography demo — custom fonts via the standard Tailwind `--font-*`
 * tokens (see `global.css`). rnwind compiles `font-display` / `font-body`
 * to `{ fontFamily: 'Montserrat_700Bold' | 'Montserrat_400Regular' }`; the
 * typefaces are loaded in `_layout.tsx` with `@expo-google-fonts/montserrat`
 * — but that's just a loader, ANY font source works the same way.
 * @returns The typography screen.
 */
export default function Typography() {
  return (
    <View className="flex-1 bg-bg">
      <ScrollView className="flex-1 py-safe">
        <View className="px-6 gap-8">
          <View className="gap-2">
            <Pressable onPress={() => router.back()}>
              <Text className="text-muted text-sm">← back</Text>
            </Pressable>
            <Text className="text-text text-4xl font-display">Typography</Text>
            <Text className="text-muted text-base leading-6 font-body">
              Custom fonts come from the standard Tailwind <Text className="text-text font-display">--font-*</Text> tokens. rnwind
              only emits <Text className="text-text font-display">fontFamily</Text> — any loader (expo-font, native,
              react-native.config.js) registers the typeface.
            </Text>
          </View>

          <View className="gap-3">
            <Text className={LABEL_CAPS}>font-display — Montserrat 700</Text>
            <View className={CARD}>
              <Text className="text-text text-3xl font-display">The quick brown fox</Text>
              <Text className="text-text text-xl font-display">jumps over the lazy dog</Text>
              <Text className="text-muted text-sm font-body">{`<Text className="font-display" />  →  { fontFamily: 'Montserrat_700Bold' }`}</Text>
            </View>
          </View>

          <View className="gap-3">
            <Text className={LABEL_CAPS}>font-body — Montserrat 400</Text>
            <View className={CARD}>
              <Text className="text-text text-base leading-6 font-body">
                Body copy in Montserrat 400. rnwind collapses the CSS fallback list (`&quot;Montserrat_400Regular&quot;,
                sans-serif`) down to the single family React Native needs.
              </Text>
            </View>
          </View>

          <View className="gap-3">
            <Text className={LABEL_CAPS}>System default (no font utility)</Text>
            <View className={CARD}>
              <Text className="text-text text-base leading-6">
                No `font-*` class → the platform system font. Drop the font loader entirely and the whole app falls back here —
                styling never breaks, only the typeface changes.
              </Text>
            </View>
          </View>

          <View className="h-8" />
        </View>
      </ScrollView>
    </View>
  )
}
