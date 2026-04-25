# Animations

`enter-*` / `exit-*` / `layout-*` / `loop-*` compile to Reanimated v4 CSS keyframes — runs on the UI thread, no JS-thread cost.

## Built-in utilities

```tsx
<Animated.View className="enter-fade" />            {/* 220ms default */}
<Animated.View className="enter-slide-up-fast" />   {/* --duration-fast token */}
<Animated.View className="exit-slide-left-200" />   {/* bare ms */}
<Animated.View className="layout-spring-[450ms]" /> {/* arbitrary time */}
```

Suffix scale: `--duration-instant` / `-fast` / `-normal` / `-slow` / `-slower`, or a bare integer (ms), or an arbitrary `[Xms]` value. Override the named tokens via `@theme { --duration-fast: 120ms; }`.

## Looping animations

```tsx
<Animated.View className="loop-pulse" />        {/* 2s */}
<Animated.View className="loop-spin" />         {/* 1s */}
<Animated.View className="loop-bounce" />       {/* 1s */}
<Animated.View className="loop-pulse-slow" />   {/* --duration-slow */}
<Animated.View className="loop-bounce-800" />   {/* bare ms */}
```

## `repeat-*` modifier

Compose any animation with an iteration count:

```tsx
<Animated.View className="enter-zoom repeat-infinite" />
<Animated.View className="enter-bounce repeat-3" />
<Animated.View className="enter-fade repeat-[5]" />
```

## Custom animations

Add your own via Tailwind v4's `@utility` syntax. rnwind parses user-authored animation utilities the same way as the preset:

```css
@keyframes my-wiggle {
  0%   { transform: rotate(-3deg); }
  50%  { transform: rotate(3deg); }
  100% { transform: rotate(-3deg); }
}

@utility my-wiggle {
  animation-name: my-wiggle;
  animation-duration: 600ms;
  animation-iteration-count: infinite;
}

/* Functional — suffix becomes the duration */
@utility my-wiggle-* {
  animation-name: my-wiggle;
  animation-duration: calc(--value(integer) * 1ms);
  animation-iteration-count: infinite;
}
```

```tsx
<Animated.View className="my-wiggle-400" />
```

## How it works

`@keyframes` blocks are compiled at build time into the Reanimated v4 step-list shape. The animation utility's `animationName` references the inlined block, so the running app never re-parses CSS — just hands the precomputed object to Reanimated.
