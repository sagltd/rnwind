# Color schemes

Tailwind v4 `@variant` blocks map straight to runtime schemes. Any number of schemes — not just `light` / `dark`.

## Declaring schemes

```css
/* global.css */
@import 'tailwindcss';
@import 'rnwind/css';

@custom-variant light (&:where(.scheme-light, .scheme-light *));
@custom-variant dark  (&:where(.scheme-dark, .scheme-dark *));
@custom-variant brand (&:where(.scheme-brand, .scheme-brand *));

@layer theme {
  :root {
    @variant light { --color-bg: #fff; --color-text: #0f172a; }
    @variant dark  { --color-bg: #000; --color-text: #f8fafc; }
    @variant brand { --color-bg: #6366f1; --color-text: #fff; }
  }
}
```

## Switching at runtime

```tsx
import { RnwindProvider } from 'rnwind'

<RnwindProvider scheme="brand">
  {/* every `bg-bg` / `text-text` resolves under the brand scheme */}
</RnwindProvider>
```

Wire it to `useColorScheme()` for system-driven light/dark:

```tsx
import { useColorScheme } from 'react-native'

const system = useColorScheme()
return <RnwindProvider scheme={system === 'dark' ? 'dark' : 'light'}>{children}</RnwindProvider>
```

## Reading tokens directly

```tsx
import { useColor, useSize, useToken, useTheme } from 'rnwind'

const primary = useColor('primary')         // resolves --color-primary for the active scheme
const md      = useSize('4')                // resolves --spacing-4
const dur     = useToken('--duration-fast') // any custom property
const tokens  = useTheme()                  // full record for the active scheme
```

## Typed schemes

rnwind narrows `Scheme` to your declared variants via TypeScript module augmentation. The generated `rnwind-types.d.ts` (written next to your CSS by `withRnwindConfig`) does this automatically:

```ts
// rnwind-types.d.ts (generated)
declare module 'rnwind' {
  export interface RnwindConfig {
    themes: readonly ['light', 'dark', 'brand']
  }
}
```

Now `useRnwind().scheme` is `'light' | 'dark' | 'brand'` — and `<RnwindProvider scheme="typo" />` is a TS error.

## Scheme-prefixed atoms

```tsx
<View className="bg-bg dark:bg-black brand:bg-primary">
  <Text className="text-text">Content</Text>
</View>
```

Each scheme variant emits its own per-atom override into the corresponding `<scheme>.style.js` file at build time. The runtime resolves via `cache.atoms[scheme]?.[atom] ?? cache.atoms.common[atom]` — two property reads, no branching cost beyond that.
