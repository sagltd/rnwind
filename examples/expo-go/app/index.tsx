/* @rnwind-theme=89c34cdfe9eda4a5 */
import { Link } from 'expo-router'
import { View, Pressable, ScrollView, Text, useWindowDimensions } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useSchemeController, type Scheme } from './_layout'
import { useCss, useRnwind } from 'rnwind'
import { myNiceClasses } from './my-classes'

const SCHEMES: ReadonlyArray<{ key: Scheme; label: string }> = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
  { key: 'brand', label: 'Brand' },
]

const SWATCH_CLASS = 'h-16 rounded-lg border border-border'
const SWATCHES: ReadonlyArray<{ label: string; cls: string }> = [
  { label: 'bg-primary', cls: `${SWATCH_CLASS} bg-primary` },
  { label: 'bg-accent', cls: `${SWATCH_CLASS} bg-accent` },
  { label: 'bg-surface', cls: `${SWATCH_CLASS} bg-surface` },
  { label: 'bg-border', cls: `${SWATCH_CLASS} bg-border` },
]

const PALETTE: ReadonlyArray<{ label: string; cls: string }> = [
  { label: 'red-500', cls: 'bg-red-500' },
  { label: 'orange-500', cls: 'bg-orange-500' },
  { label: 'amber-400', cls: 'bg-amber-400' },
  { label: 'green-500', cls: 'bg-green-500' },
  { label: 'teal-500', cls: 'bg-teal-500' },
  { label: 'sky-500', cls: 'bg-sky-500' },
  { label: 'indigo-500', cls: 'bg-indigo-500' },
  { label: 'fuchsia-500', cls: 'bg-fuchsia-500' },
]

const BORDERS: ReadonlyArray<{ label: string; cls: string }> = [
  { label: 'border solid', cls: 'border-2 border-solid border-primary' },
  { label: 'border dashed', cls: 'border-2 border-dashed border-accent' },
  { label: 'border dotted', cls: 'border-2 border-dotted border-fuchsia-500' },
  { label: 'border-t-4 only', cls: 'border-t-4 border-sky-500' },
]

// Placeholder colors satisfying LinearGradient's two-color minimum —
// the rnwind transformer rewrites `colors` from className gradient atoms.
const GRADIENT_PLACEHOLDER = ['transparent', 'transparent'] as const

const PILL_BASE_ACTIVE = 'flex-1 items-center py-2 rounded-lg bg-primary'
const PILL_BASE_IDLE = 'flex-1 items-center py-2 rounded-lg bg-transparent'
const PILL_LABEL_ACTIVE = 'text-sm font-semibold text-surface'
const PILL_LABEL_IDLE = 'text-sm font-semibold text-text'

const LABEL_CAPS_WIDE = 'text-muted text-xs uppercase tracking-wider'
const LABEL_CAPS_WIDEST = 'text-muted text-sm uppercase tracking-widest'

function useDebugCss(cls: string) {
  const css = useCss(cls)
  console.log(`${cls}:`, JSON.stringify(css, null, 2))
  return css
}
export default function Home() {
  const { scheme, setScheme } = useSchemeController()
  useDebugCss(`light:bg-sky-200`)
  const config = useRnwind()
  console.log('config:', JSON.stringify(config, null, 2))
  return (
    <View className={`flex-1 ${myNiceClasses}`}>
      <ScrollView className="flex-1" contentContainerClassName="py-safe">
        <View className="px-6 gap-8">
          <View className="gap-2">
            <Text className={LABEL_CAPS_WIDEST}>rnwind</Text>
            <Text className="text-text text-4xl font-bold">Tailwind for React Native</Text>
            <Text className="text-muted text-base leading-6">
              Utility classes compiled to StyleSheet.create at build time. Themes switch at runtime via a single context.
            </Text>
          </View>

          <View className="gap-3">
            <Text className={LABEL_CAPS_WIDE}>Theme</Text>
            <View className="flex-row gap-2 p-1 rounded-xl bg-surface border border-border">
              {SCHEMES.map(({ key, label }) => {
                const active = scheme === key
                return active ? (
                  <Pressable key={key} onPress={() => setScheme(key)} className={PILL_BASE_ACTIVE}>
                    <Text className={PILL_LABEL_ACTIVE}>{label}</Text>
                  </Pressable>
                ) : (
                  <Pressable key={key} onPress={() => setScheme(key)} className={PILL_BASE_IDLE}>
                    <Text className={PILL_LABEL_IDLE}>{label}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>

          <View className="gap-3">
            <Text className={LABEL_CAPS_WIDE}>Theme palette</Text>
            <View className="flex-row gap-3">
              {SWATCHES.map(({ label, cls }) => (
                <View key={label} className="flex-1 gap-2">
                  <View className={cls} />
                  <Text className="text-muted text-xs">{label}</Text>
                </View>
              ))}
            </View>
          </View>

          <View className="gap-3">
            <Text className={LABEL_CAPS_WIDE}>Built-in colors</Text>
            <View className="flex-row flex-wrap gap-2">
              {PALETTE.map(({ label, cls }) => (
                <View key={label} className="w-20 gap-1">
                  <View className={`h-12 rounded-lg ${cls}`} />
                  <Text className="text-muted text-xs">{label}</Text>
                </View>
              ))}
            </View>
          </View>

          <View className="gap-3">
            <Text className={LABEL_CAPS_WIDE}>Borders</Text>
            <View className="gap-3">
              {BORDERS.map(({ label, cls }) => (
                <View key={label} className={`h-12 rounded-lg bg-surface ${cls}`}>
                  <Text className="text-muted text-xs px-3 py-3">{label}</Text>
                </View>
              ))}
            </View>
          </View>

          <View className="gap-3">
            <Text className={LABEL_CAPS_WIDE}>Gradients</Text>
            <Text className="text-muted text-xs leading-5">
              className atoms rewrite into `colors` + `start` + `end` props on any LinearGradient-shaped component.
            </Text>
            <View className="flex-row flex-wrap gap-3">
              <View className="w-[47%] gap-1">
                <LinearGradient
                  colors={GRADIENT_PLACEHOLDER}
                  className="h-20 rounded-xl bg-linear-to-r from-red-500 to-blue-500"
                />
                <Text className="text-muted text-xs">to-r · red → blue</Text>
              </View>
              <View className="w-[47%] gap-1">
                <LinearGradient
                  colors={GRADIENT_PLACEHOLDER}
                  className="h-20 rounded-xl bg-linear-to-b from-sky-400 to-fuchsia-600"
                />
                <Text className="text-muted text-xs">to-b · sky → fuchsia</Text>
              </View>
              <View className="w-[47%] gap-1">
                <LinearGradient
                  colors={GRADIENT_PLACEHOLDER}
                  className="h-20 rounded-xl bg-linear-to-br from-amber-300 to-rose-600"
                />
                <Text className="text-muted text-xs">to-br · amber → rose</Text>
              </View>
              <View className="w-[47%] gap-1">
                <LinearGradient
                  colors={GRADIENT_PLACEHOLDER}
                  className="h-20 rounded-xl bg-linear-to-r from-red-500 via-green-500 to-blue-500"
                />
                <Text className="text-muted text-xs">3-stop · red → green → blue</Text>
              </View>
              <View className="w-[47%] gap-1">
                <LinearGradient
                  colors={GRADIENT_PLACEHOLDER}
                  className="h-20 rounded-xl bg-linear-to-tr from-teal-400 to-indigo-600"
                />
                <Text className="text-muted text-xs">teal → indigo</Text>
              </View>
              <View className="w-[47%] gap-1">
                <LinearGradient
                  colors={GRADIENT_PLACEHOLDER}
                  className="h-20 rounded-xl bg-linear-to-bl from-orange-400 to-purple-700"
                />
                <Text className="text-muted text-xs">orange → purple</Text>
              </View>
            </View>
            <LinearGradient
              colors={GRADIENT_PLACEHOLDER}
              className="p-5 rounded-xl bg-linear-to-r from-indigo-600 via-fuchsia-500 to-amber-400 gap-2">
              <Text className="text-white text-lg font-semibold">Hero gradient</Text>
              <Text className="text-white text-sm leading-5">
                Three-stop gradient flows from indigo → fuchsia → amber, with normal children laid out over the top.
              </Text>
            </LinearGradient>
          </View>

          <View className="gap-3">
            <Text className={LABEL_CAPS_WIDE}>Truncate & line-clamp</Text>
            <Text className="text-muted text-xs leading-5">
              {'`truncate` / `line-clamp-<N>` rewrite into `numberOfLines` + `ellipsizeMode` props on any Text-shaped component.'}
            </Text>
            <View className="p-5 rounded-xl bg-surface border border-border gap-3">
              <View className="gap-1">
                <Text className={LABEL_CAPS_WIDE}>truncate (1 line, tail)</Text>
                <Text className="truncate text-text text-base">
                  This is a very long single-line paragraph that should end with a tail ellipsis because truncate clamps to one
                  line.
                </Text>
              </View>
              <View className="gap-1">
                <Text className={LABEL_CAPS_WIDE}>line-clamp-2</Text>
                <Text className="line-clamp-2 text-text text-base">
                  When the text runs long, line-clamp-2 preserves the first two wrapped lines and ellipsizes the rest. Writers can
                  keep prose long without worrying about layout.
                </Text>
              </View>
              <View className="gap-1">
                <Text className={LABEL_CAPS_WIDE}>line-clamp-3</Text>
                <Text className="line-clamp-3 text-text text-base">
                  Three-line clamp: useful for card teasers and list previews. Keeps the visual height predictable while still
                  showing enough of the sentence to hint at what comes next, avoiding the single-line cramp.
                </Text>
              </View>
              <View className="gap-1">
                <Text className={LABEL_CAPS_WIDE}>line-clamp-2 text-clip</Text>
                <Text className="line-clamp-2 text-clip text-text text-base">
                  text-clip ends at the clamp boundary with no ellipsis — the last visible characters are cut off cleanly instead
                  of showing the three-dot marker.
                </Text>
              </View>
            </View>
          </View>

          <View className="gap-3">
            <Text className={LABEL_CAPS_WIDE}>Cards</Text>
            <View className="p-5 rounded-xl bg-surface border border-border gap-2">
              <Text className="text-text text-lg font-semibold">Zero-runtime styling</Text>
              <Text className="text-muted text-sm leading-5">
                className strings are parsed once, hashed, and emitted as per-file StyleSheet chunks. No runtime parser ships.
              </Text>
            </View>
            <View className="p-5 rounded-xl bg-primary gap-2">
              <Text className="text-surface text-lg font-semibold">Primary surface</Text>
              <Text className="text-surface text-sm leading-5">
                Same className, different scheme — every theme token resolves at render time through SchemeContext.
              </Text>
            </View>
          </View>

          <View className="gap-3">
            <Text className={LABEL_CAPS_WIDE}>Typography</Text>
            <View className="p-5 rounded-xl bg-surface border border-border gap-2">
              <Text className="text-text text-3xl font-bold">Display</Text>
              <Text className="text-text text-xl font-semibold">Heading — slightly bolder</Text>
              <Text className="text-text text-base">Body copy in the active theme&apos;s text color.</Text>
              <Text className="text-text text-sm italic">Italic for emphasis.</Text>
              <Text className="text-text text-base underline decoration-accent">Underlined with decoration-accent.</Text>
              <Text className="text-text text-sm uppercase tracking-widest">Uppercase widest tracking</Text>
              <Text className="text-muted text-xs">Caption · muted</Text>
            </View>
          </View>

          <View className="gap-3">
            <Text className={LABEL_CAPS_WIDE}>Per-scheme variants</Text>
            <View className="p-5 rounded-xl bg-surface border border-border gap-2">
              <Text className="text-text text-base">These atoms only apply when the active scheme matches:</Text>
              <View className="h-12 rounded-lg light:bg-sky-200 dark:bg-indigo-800 brand:bg-fuchsia-700" />
              <Text className="text-muted text-xs">light:bg-sky-200 · dark:bg-indigo-800 · brand:bg-fuchsia-700</Text>
              <Text className="text-text text-base light:text-sky-700 dark:text-indigo-200 brand:text-fuchsia-100">
                This text recolors per scheme.
              </Text>
            </View>
          </View>

          <View className="gap-3">
            <Text className={LABEL_CAPS_WIDE}>Shadows</Text>
            <View className="flex-row gap-3">
              <View className="flex-1 h-20 rounded-lg bg-surface items-center justify-center shadow-sm">
                <Text className="text-muted text-xs">shadow-sm</Text>
              </View>
              <View className="flex-1 h-20 rounded-lg bg-surface items-center justify-center shadow-md">
                <Text className="text-muted text-xs">shadow-md</Text>
              </View>
              <View className="flex-1 h-20 rounded-lg bg-surface items-center justify-center shadow-lg">
                <Text className="text-muted text-xs">shadow-lg</Text>
              </View>
            </View>
            <View className="flex-row gap-3">
              <View className="flex-1 h-20 rounded-lg bg-surface items-center justify-center shadow-xl">
                <Text className="text-muted text-xs">shadow-xl</Text>
              </View>
              <View className="flex-1 h-20 rounded-lg bg-surface items-center justify-center shadow-xl shadow-fuchsia-500">
                <Text className="text-muted text-xs text-center">shadow-fuchsia-500</Text>
              </View>
              <View className="flex-1 h-20 rounded-lg bg-surface items-center justify-center shadow-xl shadow-sky-500">
                <Text className="text-muted text-xs text-center">shadow-sky-500</Text>
              </View>
            </View>
          </View>

          <View className="gap-3">
            <Text className={LABEL_CAPS_WIDE}>Explore</Text>
            <Link href="/interact" asChild>
              <Pressable className="py-4 rounded-xl bg-sky-500 active:bg-sky-700 transition-colors duration-200 items-center">
                <Text className="text-white text-base font-semibold">Active + Focus: →</Text>
              </Pressable>
            </Link>
            <Link href="/animations" asChild className="mt-1">
              <Pressable className="py-6 rounded-xl bg-accent items-center">
                <Text className="text-text text-base font-semibold">Animations →</Text>
              </Pressable>
            </Link>
            <Link href="/transitions" asChild className="mt-1">
              <Pressable className="py-6 rounded-xl bg-primary items-center">
                <Text className="text-text text-base font-semibold">Transitions →</Text>
              </Pressable>
            </Link>
          </View>

          <View className="h-8" />
        </View>
      </ScrollView>
    </View>
  )
}
