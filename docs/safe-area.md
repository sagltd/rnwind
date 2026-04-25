# Safe-area utilities

`*-safe` atoms resolve at render time against live insets — no remount when the keyboard opens or the device rotates.

## Wire the provider once

```tsx
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { RnwindProvider } from 'rnwind'

const insets = useSafeAreaInsets()
return <RnwindProvider scheme="light" insets={insets}>{children}</RnwindProvider>
```

## Utilities

```tsx
<View className="pt-safe pb-safe pl-safe pr-safe" />   {/* per-side */}
<View className="p-safe" />                            {/* all four */}
<View className="pt-safe-or-4" />                      {/* max(insets.top, 16) */}
<View className="pt-safe-offset-4" />                  {/* insets.top + 16 */}
<View className="h-screen-safe" />                     {/* height - top - bottom */}
```

`*-safe-or-N` falls back to N (px) when the inset is smaller. `*-safe-offset-N` adds N on top of the inset.

For `h-screen-safe` to work, register a window-height provider once:

```tsx
import { setWindowHeightProvider } from 'rnwind'
import { Dimensions } from 'react-native'

setWindowHeightProvider(() => Dimensions.get('window').height)
```

(Or call it inside a component that subscribes to `useWindowDimensions()` and updates on change.)

## How it works

The build encodes each safe atom as `{__safeStyle: [['paddingTop', 't', or, offset], …]}` — a precomputed spec. The runtime detects the envelope via a single property check and resolves the spec against live insets without walking the value's keys. Atoms with safe specs skip the result-cache (insets vary per render).
