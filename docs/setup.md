# Setup

## Install

```bash
bun add rnwind tailwindcss
```

| Optional peer | When |
|---|---|
| `react-native-reanimated` | for `enter-*` / `exit-*` / `loop-*` / `layout-*` |
| `react-native-safe-area-context` | for `*-safe` inset utilities |
| `@testing-library/react-native` | for `rnwind/testing` |

## Metro

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config')
const { withRnwindConfig } = require('rnwind/metro')

module.exports = withRnwindConfig(getDefaultConfig(__dirname), {
  cssEntryFile: './global.css',          // required
  cacheDir: '.rnwind',                    // default: <root>/node_modules/.cache/rnwind
  dtsFile: './rnwind-types.d.ts',         // pass `false` to disable
  classNamePrefixes: ['contentContainer'], // extra JSX prop names to rewrite
})
```

`withRnwindConfig` chains your existing `babelTransformerPath` (Expo's default, etc.), installs the resolver hook, writes the `.d.ts`, and parks `RNWIND_CSS_ENTRY_FILE` / `RNWIND_CACHE_DIR` in env so worker subprocesses inherit them.

## global.css

```css
@import 'tailwindcss';
@import 'rnwind/css';

@custom-variant light (&:where(.scheme-light, .scheme-light *));
@custom-variant dark  (&:where(.scheme-dark, .scheme-dark *));

@theme {
  --color-bg: #f8fafc;
  --color-fg: #0f172a;
}

@layer theme {
  :root {
    @variant dark { --color-bg: #0b1120; --color-fg: #f8fafc; }
  }
}
```

## Provider

```tsx
import { RnwindProvider } from 'rnwind'
import { useColorScheme } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function Root({ children }) {
  const system = useColorScheme()
  const insets = useSafeAreaInsets()
  return (
    <RnwindProvider scheme={system === 'dark' ? 'dark' : 'light'} insets={insets}>
      {children}
    </RnwindProvider>
  )
}
```

## Monorepos

For workspaces, scope each app's IntelliSense to its CSS:

```json
{
  "tailwindCSS.experimental.configFile": {
    "apps/mobile/global.css": "apps/mobile/**",
    "apps/admin/global.css":  "apps/admin/**"
  },
  "tailwindCSS.classAttributes": ["class", "className"]
}
```

Metro's `watchFolders` get scanned automatically — atoms declared in shared UI packages flow into the union.

## Cache hygiene

Chunks are content-addressed and salted with a hash of your theme CSS, so any edit rotates every id automatically. The cache dir is auto-gitignored, safely wiped by `bun install --force`, and garbage-collected once at Metro startup.

## Debug

Start Metro with `RNWIND_DEBUG=1` to log transformer + resolver decisions.
