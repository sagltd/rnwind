/* @rnwind-theme=89c34cdfe9eda4a5 */
import { router } from 'expo-router'
import { Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native'

export default function Interact() {
  return (
    <View className="flex-1 bg-bg" onTouchStart={Keyboard.dismiss}>
      <ScrollView className="flex-1 py-safe">
        <View className="px-6 gap-8">
          <View className="gap-2">
            <Text className="text-muted text-sm uppercase tracking-widest">rnwind · interact</Text>
            <Text className="text-text text-4xl font-bold">active: & focus:</Text>
            <Text className="text-muted text-base leading-6">
              Press and focus variants gated by useInteract(). Transitions stay on the element continuously so Reanimated&apos;s
              CSS engine animates color / scale changes smoothly.
            </Text>
          </View>

          <View className="gap-3">
            <Text className="text-muted text-xs uppercase tracking-wider">Pressable buttons</Text>

            <Pressable className="px-5 py-4 rounded-xl bg-sky-500 active:bg-sky-700 transition-colors duration-200 items-center">
              <Text className="text-white text-base font-semibold">Press me — sky-500 → sky-700</Text>
            </Pressable>

            <Pressable className="px-5 py-4 rounded-xl bg-fuchsia-500 active:bg-fuchsia-700 transition-colors duration-300 items-center">
              <Text className="text-white text-base font-semibold">Press me — fuchsia-500 → fuchsia-700</Text>
            </Pressable>

            <Pressable className="px-5 py-4 rounded-xl bg-emerald-500 active:opacity-70 transition-opacity duration-150 items-center">
              <Text className="text-white text-base font-semibold">Press me — opacity fade</Text>
            </Pressable>

            <Pressable className="px-5 py-4 rounded-xl border-2 border-border active:border-primary transition-colors duration-200 items-center">
              <Text className="text-text text-base font-semibold">Press me — border tint</Text>
            </Pressable>
          </View>

          <View className="gap-3">
            <Text className="text-muted text-xs uppercase tracking-wider">Haptics</Text>
            <Text className="text-muted text-sm leading-5">
              Every button below carries an `active:haptic-*` class. Each press-in fires a request through
              `onHaptics` on SchemeProvider, which the demo forwards to `expo-haptics`.
            </Text>

            <View className="flex-row gap-2">
              <Pressable className="flex-1 px-3 py-3 rounded-lg bg-sky-500 active:bg-sky-700 active:haptic-light items-center transition-colors duration-150">
                <Text className="text-white text-sm font-semibold">light</Text>
              </Pressable>
              <Pressable className="flex-1 px-3 py-3 rounded-lg bg-sky-500 active:bg-sky-700 active:haptic-medium items-center transition-colors duration-150">
                <Text className="text-white text-sm font-semibold">medium</Text>
              </Pressable>
              <Pressable className="flex-1 px-3 py-3 rounded-lg bg-sky-500 active:bg-sky-700 active:haptic-heavy items-center transition-colors duration-150">
                <Text className="text-white text-sm font-semibold">heavy</Text>
              </Pressable>
            </View>

            <View className="flex-row gap-2">
              <Pressable className="flex-1 px-3 py-3 rounded-lg bg-indigo-500 active:bg-indigo-700 active:haptic-soft items-center transition-colors duration-150">
                <Text className="text-white text-sm font-semibold">soft</Text>
              </Pressable>
              <Pressable className="flex-1 px-3 py-3 rounded-lg bg-indigo-500 active:bg-indigo-700 active:haptic-rigid items-center transition-colors duration-150">
                <Text className="text-white text-sm font-semibold">rigid</Text>
              </Pressable>
              <Pressable className="flex-1 px-3 py-3 rounded-lg bg-indigo-500 active:bg-indigo-700 active:haptic-selection items-center transition-colors duration-150">
                <Text className="text-white text-sm font-semibold">selection</Text>
              </Pressable>
            </View>

            <View className="flex-row gap-2">
              <Pressable className="flex-1 px-3 py-3 rounded-lg bg-emerald-500 active:bg-emerald-700 active:haptic-success items-center transition-colors duration-150">
                <Text className="text-white text-sm font-semibold">success</Text>
              </Pressable>
              <Pressable className="flex-1 px-3 py-3 rounded-lg bg-amber-500 active:bg-amber-700 active:haptic-warning items-center transition-colors duration-150">
                <Text className="text-white text-sm font-semibold">warning</Text>
              </Pressable>
              <Pressable className="flex-1 px-3 py-3 rounded-lg bg-rose-500 active:bg-rose-700 active:haptic-error items-center transition-colors duration-150">
                <Text className="text-white text-sm font-semibold">error</Text>
              </Pressable>
            </View>
          </View>

          <View className="gap-3">
            <Text className="text-muted text-xs uppercase tracking-wider">TextInput focus</Text>

            <View className="gap-2">
              <Text className="text-text text-sm">Email</Text>
              <TextInput
                placeholder="you@example.com"
                placeholderTextColor="#888"
                keyboardType="email-address"
                autoCapitalize="none"
                className="px-4 py-3 rounded-xl bg-surface border-2 border-border focus:border-primary transition-colors duration-200 text-text"
              />
            </View>

            <View className="gap-2">
              <Text className="text-text text-sm">Password</Text>
              <TextInput
                placeholder="••••••••"
                placeholderTextColor="#888"
                secureTextEntry
                className="px-4 py-3 rounded-xl bg-surface border-2 border-border focus:border-sky-500 transition-colors duration-200 text-text"
              />
            </View>

            <View className="gap-2">
              <Text className="text-text text-sm">Notes</Text>
              <TextInput
                placeholder="Something on your mind?"
                placeholderTextColor="#888"
                multiline
                className="px-4 py-3 rounded-xl bg-surface border-2 border-border focus:border-fuchsia-500 transition-colors duration-200 text-text min-h-24"
              />
            </View>
          </View>

          <Pressable onPress={() => router.back()} className="py-4 rounded-xl bg-accent items-center">
            <Text className="text-text text-base font-semibold">← Back home</Text>
          </Pressable>

          <View className="h-8" />
        </View>
      </ScrollView>
    </View>
  )
}
