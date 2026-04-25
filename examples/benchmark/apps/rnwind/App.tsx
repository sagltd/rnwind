import { useBenchmark } from '@rnwind-bench/hook'
import { ScrollView, Text, View } from 'react-native'

// rnwind Phase 3+: `className` is a first-class prop on every RN primitive
// via TS module augmentation, and the transformer rewrites it directly to
// `style={lookupCss(…)}`. No `wrap()` HOC needed anywhere.

export default function App() {
  const { isComplete, currentSize, currentSizeIdx, currentRun, runsPerSize, sizes, resultsBySize, renderKey } =
    useBenchmark('rnwind')

  return (
    <View className="flex-1 mt-24 px-3">
      <Text className="text-lg text-typography font-bold text-center mb-4">rnwind benchmark</Text>

      {isComplete ? (
        <View className="p-4 bg-gray rounded-lg mb-4">
          <Text className="text-base text-typography font-semibold text-center mb-1">Benchmark complete</Text>
          {resultsBySize.map(({ size, stats }) => (
            <Text key={size} className="text-sm text-typography text-center">
              N={size}: avg {stats.average.toFixed(2)}ms (min {stats.min.toFixed(2)} / max {stats.max.toFixed(2)})
            </Text>
          ))}
        </View>
      ) : (
        <View className="p-4 bg-gray rounded-lg mb-4">
          <Text className="text-base text-typography font-semibold text-center mb-1">
            Size {currentSizeIdx + 1} / {sizes.length} · N={currentSize}
          </Text>
          <Text className="text-sm text-typography text-center">
            Run {currentRun + 1} / {runsPerSize}
          </Text>
        </View>
      )}

      <ScrollView key={renderKey} showsVerticalScrollIndicator={false}>
        <View className="flex-row flex-wrap gap-2">
          {Array.from({ length: currentSize }, (_, index) => (
            <View key={index} className="w-32 h-24 rounded-2xl bg-primary items-center justify-center">
              <Text className="text-typography font-bold text-2xl">{index}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}
