# Responsive design

Tailwind's mobile-first responsive model — fully wired to React Native's `useWindowDimensions().width`.

## Breakpoint variants

```tsx
<View className="p-2 md:p-4 lg:p-8">
  <Text className="text-sm md:text-base lg:text-lg">Adapts to width</Text>
</View>
```

Mobile-first: unprefixed atoms apply at every width, and `sm:` / `md:` / `lg:` / `xl:` / `2xl:` gate the higher tier from that minimum width up. Last className wins on overlap, matching RN's style-flatten semantics.

## Default breakpoints

| Prefix | Min width | CSS |
|---|---|---|
| `sm` | 640px (40rem) | `@media (width >= 40rem)` |
| `md` | 768px (48rem) | `@media (width >= 48rem)` |
| `lg` | 1024px (64rem) | `@media (width >= 64rem)` |
| `xl` | 1280px (80rem) | `@media (width >= 80rem)` |
| `2xl` | 1536px (96rem) | `@media (width >= 96rem)` |

These ship out of the box — no config needed.

## Custom breakpoints

Override or extend via `@theme`:

```css
@theme {
  --breakpoint-md: 720px;     /* tighter md */
  --breakpoint-3xl: 120rem;   /* new tier */
}
```

```tsx
<View className="3xl:flex-row" />
```

## Reading the active tier from JS

```tsx
import { useRnwind } from 'rnwind'

const { activeBreakpoint, windowWidth } = useRnwind()
if (activeBreakpoint === 'lg') return <DesktopLayout />
```

`activeBreakpoint` is the highest matching breakpoint name. Below the smallest, it's the smallest registered name (so consumers always have a real string to branch on, never `null`).

Reactive: it updates with `useWindowDimensions().width` every time the OS reports a change (rotation, split-screen, foldables).

## How it works

The Metro transformer reads each `@media (width >= Xrem)` wrapper out of Tailwind v4's compiled CSS, registers the threshold as `<prefix> → px` in a runtime breakpoint table, and gates each `<prefix>:atom` lookup on `windowWidth >= threshold`. The cache key includes a bounded `tier` index — at most `breakpointCount + 1` rows per `(scheme, state, fontScale)` — so per-pixel cache explosion is impossible.

See [`docs/architecture.md`](./architecture.md) for the full pipeline.
