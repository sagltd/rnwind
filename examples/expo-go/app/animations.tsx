/* @rnwind-theme=89c34cdfe9eda4a5 */
import { router } from 'expo-router'
import { useCallback, useState } from 'react'
import { useCss } from 'rnwind'
import { View, Pressable, ScrollView, Text } from 'react-native'
import Animated from 'react-native-reanimated'

const LABEL_CAPS = 'text-muted text-xs uppercase tracking-wider'
const CARD = 'p-5 rounded-xl bg-surface border border-border gap-3'
const CTA = 'py-2 px-4 rounded-lg bg-primary items-center self-start'
const TILE_LABEL = 'text-surface text-xs font-semibold text-center'

export default function Animations() {
  const [tick, setTick] = useState(0)
  const replay = useCallback(() => setTick((value) => value + 1), [])
  console.log(JSON.stringify(useCss('enter-fade'), null, 2))

  const [isAnimating, setIsAnimating] = useState(false)
  return (
    <View className="flex-1 bg-bg">
      <ScrollView className="flex-1 py-safe">
        <View className="px-6 gap-8">
          <View className="gap-2">
            <Pressable onPress={() => router.back()}>
              <Text className="text-muted text-sm">← back</Text>
            </Pressable>
            <Text className="text-text text-4xl font-bold">Animations</Text>
            <Text className="text-muted text-base leading-6">
              Enter / exit / layout utilities from <Text className="text-text font-semibold">rnwind/css</Text>. Everything runs on
              the UI thread via Reanimated v4&apos;s CSS engine.
            </Text>
          </View>

          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text className={LABEL_CAPS}>Enter presets</Text>
              <Pressable onPress={replay} className={CTA}>
                <Text className="text-surface text-xs font-semibold">Replay</Text>
              </Pressable>
            </View>
            <View className={CARD}>
              <View className="flex-row gap-2 flex-wrap" key={`row-a-${tick}`}>
                <Animated.View className="h-16 flex-1 rounded-lg bg-primary items-center justify-center enter-fade">
                  <Text className={TILE_LABEL}>enter-fade</Text>
                </Animated.View>
                <Animated.View className="h-16 flex-1 rounded-lg bg-primary items-center justify-center enter-zoom">
                  <Text className={TILE_LABEL}>enter-zoom</Text>
                </Animated.View>
              </View>
              <View className="flex-row gap-2 flex-wrap" key={`row-b-${tick}`}>
                <Animated.View className="h-16 flex-1 rounded-lg bg-primary items-center justify-center enter-slide-up">
                  <Text className={TILE_LABEL}>slide-up</Text>
                </Animated.View>
                <Animated.View className="h-16 flex-1 rounded-lg bg-primary items-center justify-center enter-slide-down">
                  <Text className={TILE_LABEL}>slide-down</Text>
                </Animated.View>
              </View>
              <View className="flex-row gap-2 flex-wrap" key={`row-c-${tick}`}>
                <Animated.View className="h-16 flex-1 rounded-lg bg-primary items-center justify-center enter-slide-left">
                  <Text className={TILE_LABEL}>slide-left</Text>
                </Animated.View>
                <Animated.View className="h-16 flex-1 rounded-lg bg-primary items-center justify-center enter-slide-right">
                  <Text className={TILE_LABEL}>slide-right</Text>
                </Animated.View>
              </View>
              <View className="flex-row gap-2 flex-wrap" key={`row-d-${tick}`}>
                <Animated.View className="h-16 flex-1 rounded-lg bg-primary items-center justify-center enter-bounce">
                  <Text className={TILE_LABEL}>enter-bounce</Text>
                </Animated.View>
              </View>
            </View>
          </View>

          <View className="gap-3">
            <Text className={LABEL_CAPS}>Looping animations</Text>
            <View className={CARD}>
              <Text className="text-muted text-sm leading-5">
                `loop-*` utilities keep playing forever. Compose your own enter animations with `repeat-infinite` or
                `repeat-&lt;n&gt;` to iterate a finite count.
              </Text>
              <View className="flex-row gap-2 flex-wrap">
                <Animated.View className="h-16 flex-1 rounded-lg bg-primary items-center justify-center loop-pulse">
                  <Text className={TILE_LABEL}>loop-pulse</Text>
                </Animated.View>
                <Animated.View className="h-16 flex-1 rounded-lg bg-primary items-center justify-center loop-spin">
                  <Text className={TILE_LABEL}>loop-spin</Text>
                </Animated.View>
                <Animated.View className="h-16 flex-1 rounded-lg bg-primary items-center justify-center loop-bounce">
                  <Text className={TILE_LABEL}>loop-bounce</Text>
                </Animated.View>
              </View>
              <View className="flex-row gap-2 flex-wrap">
                <Animated.View className="h-16 flex-1 rounded-lg bg-accent items-center justify-center enter-zoom-1000 repeat-infinite">
                  <Text className={TILE_LABEL}>enter-zoom-1000 repeat-infinite</Text>
                </Animated.View>
                <Animated.View className="h-16 flex-1 rounded-lg bg-accent items-center justify-center enter-bounce-1000 repeat-infinite">
                  <Text className={TILE_LABEL}>enter-bounce-1000 repeat-infinite</Text>
                </Animated.View>
              </View>
            </View>
          </View>

          <View className="gap-3">
            <Text className={LABEL_CAPS}>Duration scale</Text>
            <View className={CARD}>
              <Text className="text-muted text-sm leading-5">
                Every preset accepts a suffix — named tokens, bare integers, or arbitrary CSS time values.
              </Text>
              <View className="flex-row gap-2 flex-wrap" key={`row-dur-${tick}`}>
                <Animated.View className="h-16 flex-1 rounded-lg bg-primary items-center justify-center enter-fade-fast">
                  <Text className={TILE_LABEL}>fast (120ms)</Text>
                </Animated.View>
                <Animated.View className="h-16 flex-1 rounded-lg bg-primary items-center justify-center enter-fade-slow">
                  <Text className={TILE_LABEL}>slow (420ms)</Text>
                </Animated.View>
              </View>
              <View className="flex-row gap-2 flex-wrap" key={`row-dur2-${tick}`}>
                <Animated.View className="h-16 flex-1 rounded-lg bg-primary items-center justify-center enter-fade-700">
                  <Text className={TILE_LABEL}>700 (ms)</Text>
                </Animated.View>
                <Animated.View className="h-16 flex-1 rounded-lg bg-primary items-center justify-center enter-fade-[1200ms]">
                  <Text className={TILE_LABEL}>[1200ms]</Text>
                </Animated.View>
              </View>
            </View>
          </View>

          <View className="h-8" />
        </View>
      </ScrollView>
    </View>
  )
}
