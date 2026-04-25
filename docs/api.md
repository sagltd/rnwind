# API reference

## `rnwind` (runtime)

### Provider

```tsx
<RnwindProvider scheme={Scheme} insets?={Insets} onHaptics?={OnHaptics} tables?={ThemeTables} />
```

### `useRnwind(): RnwindState`

```ts
{
  scheme: Scheme                   // active scheme name (typed)
  tables: ThemeTables              // resolved token tables, per scheme
  insets: Insets                   // safe-area insets
  fontScale: number                // useWindowDimensions().fontScale
  windowWidth: number              // useWindowDimensions().width
  activeBreakpoint: string         // 'sm' | 'md' | … | smallest registered
  onHaptics: OnHaptics | undefined
}
```

### Hooks

| Hook | Returns | Use |
|---|---|---|
| `useRnwind()` | `RnwindState` | Single context read for `lookupCss`. |
| `useCss(class, userStyle?)` | `readonly unknown[]` | `useRnwind() + lookupCss` rolled into one. |
| `useTheme()` | `ThemeTable` | Merged token map for the active scheme. |
| `useToken(name)` | `string \| number \| undefined` | One token by name (`'--color-primary'` or `'color-primary'`). |
| `useColor(name)` | `string \| undefined` | `--color-<name>` shortcut. |
| `useSize(name)` | `number \| string \| undefined` | `--spacing-<name>` shortcut. |
| `useInteract()` | `UseInteractResult` | `state` + press/focus handlers (transformer-injected). |

### Resolvers

```ts
lookupCss(input, ctx, userStyle?, interactState?): readonly unknown[]
//  input: hoisted atom-name array OR raw className string
//  ctx:   useRnwind() result

registerAtoms(scheme, atoms): void          // generated *.style.js call this
registerBreakpoints(map): void              // manifest calls this
registerSchemeLoader(loader | null): void   // manifest calls this
setWindowHeightProvider(fn | null): void    // for `h-screen-safe`

getBreakpoints(): readonly { name; minWidth }[]   // sorted snapshot
activeBreakpointFor(width): string                // imperative variant
```

### Components & helpers

```ts
InteractiveBox                    // wrapper the transformer uses to host useInteract
chainPress(user, ours)            // press-handler chainer
chainFocus(user, ours)            // focus-handler chainer
useMountHaptic(requests)          // mount-time haptic firer
triggerHaptic(onHaptics, req, t)  // event-time haptic firer
```

## `rnwind/metro` (build)

```ts
withRnwindConfig(metroConfig, options)  // one-call Metro integration
transform(args)                          // the babel transformer
createRnwindResolver(upstream)           // resolver chain
configureRnwindState / getRnwindState / resetRnwindState / onThemeChange / manifestPathFor
```

## `rnwind/testing`

```ts
renderWithCss(source, options?)       // transform + render via @testing-library/react-native
renderHookWithCss(callback, options?) // renderHook equivalent
flatten(style)                         // merge a RN style array into one record
```

See [`testing.md`](./testing.md) for usage.

## `rnwind/css`

The Tailwind v4 preset that ships rnwind's `@utility` declarations (`enter-*`, `exit-*`, `layout-*`, `loop-*`, `repeat-*`, `*-safe`, `*-hairline`, `haptic-*`). Import once at the top of your `global.css`.
