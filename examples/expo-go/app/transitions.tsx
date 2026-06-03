/* @rnwind-theme=89c34cdfe9eda4a5 */
import { router } from 'expo-router'
import { useState, type ReactNode } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Pressable, ScrollView, Text, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { useCss } from 'rnwind'

/**
 * Reanimated v4 ships a CSS-transitions engine that watches the `style`
 * prop and animates property changes when the element also carries
 * `transitionProperty` / `transitionDuration` / `transitionTimingFunction`
 * / `transitionDelay` style props.
 *
 * rnwind lowers Tailwind's `transition-*` / `duration-*` / `ease-*` /
 * `delay-*` utilities to those exact RN style props, so any
 * `Animated.View` with a Tailwind `transition-*` class animates real RN
 * style mutations on the UI thread — no driver, no `useAnimatedStyle`,
 * no `withTiming` wrapper.
 *
 * Each demo tile owns its own `on` state — tap the tile to run its
 * specific transition.
 */

const LABEL_CAPS = 'text-muted text-xs uppercase tracking-wider'
const CARD = 'p-5 rounded-xl bg-surface border border-border gap-3'
const HINT = 'text-muted text-xs italic'

/**
 * Wrapper for a single demo tile. Holds its own toggle state so each
 * tile animates independently. The render-prop receives the current
 * `on` value so the caller can swap classes per state.
 * @param props.children Render prop receiving the current `on` value.
 * @returns A pressable that toggles its inner state on tap.
 */
function ToggleTile({ children }: { children: (on: boolean) => ReactNode }) {
  const [on, setOn] = useState(false)
  return (
    <Pressable onPress={() => setOn((value) => !value)} className="active:opacity-80">
      {children(on)}
    </Pressable>
  )
}

/**
 * Standard label + hint header above each demo tile so users know to tap.
 * @param props.title Section heading text.
 * @param props.description Subtitle / explanation.
 * @returns The header element.
 */
function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <View className="gap-1">
      <Text className={LABEL_CAPS}>{title}</Text>
      <Text className="text-muted text-sm leading-5">{description}</Text>
      <Text className={HINT}>Tap the tile to play.</Text>
    </View>
  )
}

export default function Transitions() {
  console.log(JSON.stringify(useCss('transition-colors duration-500 ease-in-out'), null, 2), 'OMG')
  return (
    <View className="flex-1 bg-bg">
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView className="flex-1">
          <View className="px-6 gap-8">
            <View className="gap-2">
              <Pressable onPress={() => router.back()}>
                <Text className="text-muted text-sm">← back</Text>
              </Pressable>
              <Text className="text-text text-4xl font-bold">Transitions</Text>
              <Text className="text-muted text-base leading-6">
                Tailwind&apos;s <Text className="text-text font-semibold">transition-*</Text> /{' '}
                <Text className="text-text font-semibold">duration-*</Text> /{' '}
                <Text className="text-text font-semibold">ease-*</Text> / <Text className="text-text font-semibold">delay-*</Text>{' '}
                utilities lower to RN style props Reanimated v4&apos;s CSS engine consumes — every property change runs on the UI
                thread.
              </Text>
            </View>

            <View className="gap-3">
              <SectionHeader
                title="transition-colors"
                description="Animates color-family properties (background-color / border-color / fill / stroke)."
              />
              <View className={CARD}>
                <ToggleTile>
                  {(on) => (
                    <Animated.View
                      className={`h-20 rounded-lg transition-colors duration-500 ease-in-out ${
                        on ? 'bg-fuchsia-500' : 'bg-sky-500'
                      }`}
                    />
                  )}
                </ToggleTile>
                <ToggleTile>
                  {(on) => (
                    <Animated.View
                      className={`h-12 rounded-lg border-4 transition-colors duration-500 ${
                        on ? 'border-amber-500 bg-amber-50' : 'border-teal-500 bg-teal-50'
                      }`}
                    />
                  )}
                </ToggleTile>
              </View>
            </View>

            <View className="gap-3">
              <SectionHeader
                title="transition-opacity"
                description="Just opacity — fade-in / fade-out without affecting layout."
              />
              <View className={CARD}>
                <ToggleTile>
                  {(on) => (
                    <Animated.View
                      className={`h-20 rounded-lg bg-primary transition-opacity duration-300 ease-out ${
                        on ? 'opacity-100' : 'opacity-30'
                      }`}
                    />
                  )}
                </ToggleTile>
              </View>
            </View>

            <View className="gap-3">
              <SectionHeader
                title="transition-transform"
                description="Animates rotate / scale / translate. Reanimated handles the transform array diff."
              />
              <View className={CARD}>
                <ToggleTile>
                  {(on) => (
                    <View className="h-24 items-center justify-center">
                      <Animated.View
                        className={`w-16 h-16 rounded-lg bg-accent transition-transform duration-500 ease-in-out ${
                          on ? 'rotate-45 scale-150' : 'rotate-0 scale-100'
                        }`}
                      />
                    </View>
                  )}
                </ToggleTile>
                <ToggleTile>
                  {(on) => (
                    <View className="h-24 items-center justify-center">
                      <Animated.View
                        className={`w-12 h-12 rounded-full bg-fuchsia-500 transition-transform duration-700 ease-out ${
                          on ? 'translate-x-16' : '-translate-x-16'
                        }`}
                      />
                    </View>
                  )}
                </ToggleTile>
              </View>
            </View>

            <View className="gap-3">
              <SectionHeader
                title="transition-all (multiple props at once)"
                description="Combine color + opacity + transform — every changed prop animates in lockstep."
              />
              <View className={CARD}>
                <ToggleTile>
                  {(on) => (
                    <View className="h-32 items-center justify-center">
                      <Animated.View
                        className={`w-20 h-20 rounded-2xl transition-all duration-700 ease-in-out ${
                          on ? 'bg-fuchsia-500 opacity-100 rotate-45 scale-150' : 'bg-sky-500 opacity-50 rotate-0 scale-100'
                        }`}
                      />
                    </View>
                  )}
                </ToggleTile>
              </View>
            </View>

            <View className="gap-3">
              <SectionHeader
                title="Duration scale"
                description="Same animation, four different durations — Tailwind's duration-* utilities map to ms values."
              />
              <View className={CARD}>
                <View className="flex-row gap-2">
                  {['duration-150', 'duration-300', 'duration-500', 'duration-1000'].map((cls) => (
                    <View key={cls} className="flex-1 gap-2">
                      <ToggleTile>
                        {(on) => (
                          <Animated.View
                            className={`h-12 rounded-lg transition-colors ${cls} ease-in-out ${
                              on ? 'bg-amber-400' : 'bg-primary'
                            }`}
                          />
                        )}
                      </ToggleTile>
                      <Text className="text-muted text-xs">{cls}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>

            <View className="gap-3">
              <SectionHeader
                title="Easing curves"
                description="Reanimated v4 CSS engine accepts the predefined easing keywords."
              />
              <View className={CARD}>
                <View className="gap-2">
                  {[
                    { ease: 'ease-linear', label: 'linear' },
                    { ease: 'ease-in', label: 'ease-in' },
                    { ease: 'ease-out', label: 'ease-out' },
                    { ease: 'ease-in-out', label: 'ease-in-out' },
                  ].map(({ ease, label }) => (
                    <View key={ease} className="gap-1">
                      <Text className="text-muted text-xs">{label}</Text>
                      <ToggleTile>
                        {(on) => (
                          // Fixed track + cursor widths so the translate distance
                          // (track-width − cursor-width) lands the cursor flush
                          // with the right edge: 240 − 32 = 208 → translate-x-52.
                          <View className="h-8 bg-border rounded-md overflow-hidden w-32">
                            <Animated.View
                              className={`h-8 w-8 rounded-md bg-primary transition-transform duration-200 ${ease} ${
                                on ? 'translate-x-24' : 'translate-x-0'
                              }`}
                            />
                          </View>
                        )}
                      </ToggleTile>
                    </View>
                  ))}
                </View>
              </View>
            </View>

            <View className="gap-3">
              <SectionHeader
                title="Delays"
                description="delay-* adds a head-start. Tap to fire all four at once and watch them cascade."
              />
              <View className={CARD}>
                <ToggleTile>
                  {(on) => (
                    <View className="gap-2">
                      {['delay-0', 'delay-150', 'delay-300', 'delay-500'].map((delay) => (
                        <View key={delay} className="flex-row items-center gap-3">
                          <Animated.View
                            className={`w-10 h-10 rounded-md bg-accent transition-opacity duration-300 ${delay} ${
                              on ? 'opacity-100' : 'opacity-20'
                            }`}
                          />
                          <Text className="text-muted text-xs">{delay}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </ToggleTile>
              </View>
            </View>

            <View className="h-8" />
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  )
}
