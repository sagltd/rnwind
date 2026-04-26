# Architecture

How rnwind turns `<View className="flex-1 p-4 bg-primary" />` into a zero-runtime, deduplicated React Native stylesheet — step by step.

If you have never opened the codebase before, read this top-to-bottom. Every section maps to one piece of `packages/rnwind/src/`.

---

## The thirty-second version

1. **Metro starts.** `withRnwindConfig` installs a babel transformer, a resolver hook, writes `rnwind-types.d.ts`, and parks your theme-CSS path + cache dir in env vars so every worker process can find them.
2. **A source file is transformed.** rnwind scans the file for `className=`, resolves each Tailwind candidate into a React Native style object, and mutates the AST in place:
   - `className="flex-1 p-4"` becomes `style={_l(_c<hash>, _t, existingStyle)}` where `_l = lookupCss`.
   - `_c<hash>` is a frozen `Object.freeze(['flex-1', 'p-4'])` array hoisted once per file.
   - `const _t = _r()` (where `_r = useRnwind`) is injected at the top of the enclosing component.
   - `import 'rnwind/__generated/schemes'` is prepended so the file pulls the manifest in via Metro's dep graph.
3. **Per-scheme files are materialized on disk.** `<cacheDir>/common.style.js` carries every atom's canonical value; `<cacheDir>/<variant>.style.js` carries only diffs for that scheme. Each file is `registerAtoms('<scheme>', {...})` — plain JS objects, no `StyleSheet.create` wrapping. The manifest module (`<cacheDir>/schemes.js`) eager-imports `common.style.js`, calls `registerBreakpoints({...})` once with the responsive thresholds Tailwind emitted, and lazy-`require()`s each variant on first `useRnwind({scheme})`.
4. **At runtime, `lookupCss` is a cache lookup.** A frozen atom-name array + `(scheme, stateIndex, fontScale, tier)` cache key → the same `readonly unknown[]` reference every render. React Native's style diff sees no change.

That is it. No runtime parser. No regex on the hot path. No `var(--…)` left unresolved. Everything below explains how the four steps above are implemented.

---

## Directory map

```
packages/rnwind/
├── preset.css                              # built-in enter/exit/layout/loop/safe/haptic/hairline utilities
└── src/
    ├── core/
    │   ├── parser/                         # Tailwind candidate → RN style object
    │   │   ├── tw-parser.ts                # the TailwindParser class (entry point)
    │   │   ├── theme-vars.ts               # extracts @theme / @variant blocks
    │   │   ├── declaration.ts              # one CSS declaration → RN entry
    │   │   ├── color.ts                    # culori-backed color resolution
    │   │   ├── length.ts                   # px / rem / calc → number
    │   │   ├── transform.ts                # composable --tw-translate-x etc.
    │   │   ├── keyframes.ts                # @keyframes → Reanimated step list
    │   │   ├── safe-area.ts                # *-safe atom marker spec
    │   │   ├── haptics.ts                  # haptic-* atom detector
    │   │   ├── gradient.ts                 # gradient role detection (LinearGradient prop emit)
    │   │   └── {typography,shorthand,animation,…}.ts
    │   ├── style-builder/                  # parser output → on-disk per-scheme JS files
    │   │   ├── build-style.ts              # renderSchemeFile, renderManifest, buildSchemeSources
    │   │   ├── union-builder.ts            # UnionBuilder — incremental in-memory atom union
    │   │   └── index.ts
    │   └── types.ts
    ├── metro/                              # Metro integration (not shipped to the app bundle)
    │   ├── with-config.ts                  # withRnwindConfig — user entry point
    │   ├── transformer.ts                  # babel transformer that runs per file
    │   ├── transform-ast.ts                # the JSX rewrite pass
    │   ├── resolver.ts                     # serves rnwind/__generated/schemes
    │   ├── state.ts                        # worker-local parser + builder + env vars
    │   └── dts.ts                          # generates rnwind-types.d.ts
    ├── runtime/                            # runs on the device
    │   ├── lookup-css.ts                   # resolver + atoms/breakpoints/scheme-loader registries
    │   ├── components/
    │   │   └── rnwind-provider.tsx         # RnwindProvider + useRnwind
    │   ├── hooks/
    │   │   ├── use-css.ts                  # useCss — useRnwind() + lookupCss
    │   │   ├── use-scheme.ts               # useTheme / useToken / useColor / useSize
    │   │   └── use-interact.ts             # press/focus state machine
    │   ├── interactive-box.tsx             # transformer-injected wrapper for active:/focus:
    │   ├── chain-handlers.ts               # chainPress / chainFocus
    │   └── haptics.ts                      # useMountHaptic / triggerHaptic
    ├── testing/                            # rnwind/testing — renderWithCss, renderHookWithCss, flatten
    │   └── index.ts
    └── types/                              # ambient .d.ts for upstream modules
```

Two package entry points:

- `rnwind` — the runtime. Pure React + React Native code; no Tailwind, lightningcss, or oxide dependencies. Tree-shakes to what your app actually calls.
- `rnwind/metro` — the build-time surface. Imported only by `metro.config.js`, never by the app.

---

## Build-time pipeline

### `withRnwindConfig` — wiring Metro

`src/metro/with-config.ts`. The only function the user calls. It:

1. Resolves the project root, cache dir (`node_modules/.cache/rnwind` by default), and absolute path to the theme CSS.
2. Creates `<cacheDir>/styles/`.
3. Publishes the theme-CSS path and cache dir to `process.env` (`RNWIND_CSS_ENTRY_FILE`, `RNWIND_CACHE_DIR`). Metro spawns worker subprocesses that inherit this env — `state.ts` reads it to rebuild a worker-local parser + registry without a second config read.
4. Captures whatever `babelTransformerPath` Metro already has (Expo's default, etc.) into `RNWIND_UPSTREAM_TRANSFORMER`. Our transformer chains to it so Flow stripping, expo-router macros, and babel-preset-expo still run downstream.
5. Sets `metroConfig.transformer.babelTransformerPath` to our own transformer.
6. Adds a `resolveRequest` that serves `rnwind/__generated/schemes<id>` virtual imports from `<cacheDir>/styles/<id>.js`.
7. Adds `cacheDir` to `watchFolders` so Metro's haste-map indexes chunk files without `Failed to get SHA-1` races.
8. Runs a **single** `chunkRegistry.gcStaleChunks()` in the master process, before any worker spins up, to reap orphan chunk files from a previous theme or version.
9. Writes `rnwind-types.d.ts` — a `react-native` module augmentation that adds optional `className?: string` to every core component's props, plus a `RnwindConfig.themes` tuple reflecting your declared `@variant` blocks so `useRnwind()` returns the literal union.

### `state.ts` — per-worker initialization

Metro spawns N transformer workers. Each one lazily builds, on first use:

- A `TailwindParser` bound to the theme CSS (reads it from `RNWIND_CSS_ENTRY_FILE`).
- A `UnionBuilder` pointing at `<cacheDir>/styles/`, salted with an 8-char hash of the theme CSS content.

The salt is critical. Every chunk id is `hash(atoms, themeHash)`. When the user edits `global.css`, the hash rotates and every chunk gets a fresh id — Metro sees "new modules" and re-bundles without any cache invalidation wizardry.

### `transformer.ts` — the per-file entry point

For every source file Metro hands us:

```
if (!file ends with .ts/.tsx/.js/.jsx) → upstream
if (file is inside node_modules)       → upstream
if (file does not contain "className=") → upstream (and drop it from registry)
```

Cheap guards first. Only files that pass all three pay the cost of the real transform.

The real transform runs in two phases:

1. **Pre-process the source string.** We parse the raw source (JSX intact!) with `@babel/parser`, run our AST pass, regenerate code via `@babel/generator`, and hand the rewritten string to the upstream transformer as `src`. This ordering matters: the upstream runs JSX-to-`createElement`, at which point there are no `className` JSX attributes left to rewrite. We must go before it.
2. **Delegate to the upstream.** Whatever `babelTransformerPath` was originally configured runs on our pre-processed output. Its result is the AST Metro bundles.

### `transform-ast.ts` — the JSX rewrite

For every `className=` attribute, the transformer emits `style={lookupCss(<ref|expr>, _s, <existingStyle?>)}` and drops the original attribute. There are **two shapes** depending on whether the value is statically knowable at build time or not.

#### Shape 1 — static string (hoisted)

```tsx
// ─── Before ───
<View className="flex-1 p-4" style={{ opacity }} />
```

```tsx
// ─── After (pseudocode, comments added for clarity) ───
import { lookupCss, useRnwind } from 'rnwind'
import 'rnwind/__generated/schemes7f9a2e8b3c0d'   // side-effect chunk import

// Module-scope hoist — one per unique atom set in the file.
const _c_d7e92f3bb81e = Object.freeze(['flex-1', 'p-4'])

export function Screen() {
  const _s = useRnwind()                           // one injection per component
  return <View style={lookupCss(_c_d7e92f3bb81e, _s, { opacity })} />
}
```

The tokenized atom list is **canonicalized** (sorted, joined with `\0`), hashed (sha256, first 12 chars), and stored as a module-scope `const _c_<hash> = Object.freeze([...])`. Two call sites with identical atom sets share one hoisted array, so React's style-prop diff sees stable identity across renders — no native view update.

The sibling `style={{ opacity }}` attribute is removed and forwarded as the third argument so user styles still win (RN style merge is last-write).

#### Precedence rule — user-supplied JSX attrs always win

Some Tailwind utilities expand into discrete JSX props rather than `style` entries — gradient atoms emit `colors=` / `start=` / `end=`; `truncate` / `line-clamp-N` emit `numberOfLines=` / `ellipsizeMode=`. Whenever rnwind would splice a class-derived attribute, **it first checks whether the developer already wrote that attribute on the same element**. If yes, the hand-written value wins and the class-derived value is silently dropped — for that attribute only.

```tsx
// ─── Before ───
const COLORS = ['#000000', '#ffffff']
<LinearGradient
  className="bg-gradient-to-r from-red-500 to-blue-500"
  colors={COLORS}
/>

// ─── After ───
<LinearGradient
  colors={COLORS}                         // user wins — kept verbatim
  start={_gs_<hash>}                      // class-derived; user didn't write it
  end={_ge_<hash>}                        // class-derived; user didn't write it
/>
```

The principle: rnwind augments the JSX, never overrides the developer. If you need rnwind's value, drop your own attr; if you need yours, write it and rnwind steps aside on that single prop. Same rule fires per-attribute — supplying `start={…}` doesn't lock out the class-derived `colors=` / `end=`.

#### Gotcha — third-party hosts that `Object.assign` on `style`

`lookupCss(...)` returns a **style ARRAY** (`[{flex:1}, {backgroundColor:…}]`). React Native flattens those arrays natively at the bridge, so they "just work" on `<View>` / `<Text>` / `<Pressable>` / `<ScrollView>` / etc.

**A handful of third-party hosts pre-process the prop with `Object.assign` before handing it to RN.** `@shopify/flash-list`'s outer wrapper is the canonical example:

```js
// inside @shopify/flash-list
React.createElement(CompatView, {
  style: Object.assign({ flex: 1, overflow: 'hidden' }, style)
})
```

When `style` is an array, `Object.assign({}, [{backgroundColor:'#ffd230'}])` produces `{flex:1, overflow:'hidden', '0': {backgroundColor:'#ffd230'}}` — the inner object lands at numeric key `'0'` and the actual property never reaches the renderer.

**Workaround in your wrapper:** flatten before passing the prop:

```jsx
import { StyleSheet } from 'react-native'

const flat = useMemo(() => style ? StyleSheet.flatten(style) : undefined, [style])
return <FlashList style={flat} {...rest} />
```

Suspect any host where the `style` you set via className appears unapplied while `contentContainerStyle` works fine. Common offenders: `@shopify/flash-list`, components that call `Object.assign` on `style` defensively before forwarding.

#### Shape 2 — dynamic expression (pass-through)

Anything that is **not** a bare string literal — ternary, function call, template literal with interpolations — is forwarded verbatim as the first argument of `lookupCss`. The runtime receives a string and tokenizes it through a capped Map cache (≤ 512 entries, FIFO eviction).

**Ternary:**

```tsx
// ─── Before ───
<Pressable className={active ? 'bg-primary text-surface' : 'bg-transparent text-muted'} />
```

```tsx
// ─── After ───
<Pressable style={lookupCss(active ? 'bg-primary text-surface' : 'bg-transparent text-muted', _s)} />
```

**Conditional via `&&`:**

```tsx
// ─── Before ───
<View className={isPressed && 'opacity-50'} />
```

```tsx
// ─── After ───
<View style={lookupCss(isPressed && 'opacity-50', _s)} />
```

At runtime, `lookupCss` sees either `'opacity-50'` or `false`. A falsy first arg returns an empty frozen array.

**Helper like `mergeClasses(...)`:**

```tsx
// ─── Before ───
<Pressable
  className={mergeClasses(
    'py-4 rounded-xl bg-accent items-center',
    isPressed && 'opacity-50',
  )}
/>
```

```tsx
// ─── After ───
<Pressable
  style={lookupCss(
    mergeClasses('py-4 rounded-xl bg-accent items-center', isPressed && 'opacity-50'),
    _s,
  )}
/>
```

`mergeClasses` runs every render and returns a string. The runtime cache keys on that string — the first render pays the tokenize + resolve cost, subsequent renders with the same result hit the cache.

**Template literal with interpolation:**

```tsx
// ─── Before ───
<Text className={`text-${size} p-${padding}`} />
```

```tsx
// ─── After ───
<Text style={lookupCss(`text-${size} p-${padding}`, _s)} />
```

**Important:** the Tailwind parser scans the **raw source** of the file via `@tailwindcss/oxide`, not the post-AST node types. Any string literal that looks like a Tailwind candidate — even inside `mergeClasses(...)`, a ternary, or a const like `const PILL = 'flex-1 py-2'` — gets resolved and lands in a chunk. The only classes that won't resolve are ones constructed by runtime string concatenation (`'text-' + size`) where the full class name never appears in the source. Those atoms will not exist in any chunk and `lookupCss` will skip them silently at runtime.

#### Shape 3 — static template literal with no interpolation

```tsx
<View className={`flex-1 p-4`} />
```

The AST walker recognises this as equivalent to a plain string literal and emits a hoisted `_c_<hash>` reference, same as shape 1. Only template literals that actually carry `${...}` expressions fall through to shape 2.

#### Cross-cutting rewrites

Two things happen regardless of shape:

- **`useRnwind()` is injected once per component.** `const _s = useRnwind()` is prepended to the body of the enclosing function component (the walker finds it by climbing parent paths until it hits a `function Capital() {}`, `const Capital = () => …`, `forwardRef(...)` / `memo(...)` argument, or `export default function () {}`). One injection per component, idempotent across rewrite calls.
- **Chunk imports are prepended.** For every chunk id this file references (computed from the parser's output, not from which shape the `className` took), `import 'rnwind/__generated/schemes<id>'` goes at the top. These are pure side-effect imports — they populate the runtime atom registry via `registerAtoms({...})` at module init.

### `tw-parser.ts` — Tailwind candidate → RN style

One `TailwindParser` per Metro worker, bound to the theme CSS for its lifetime. A theme edit invalidates the worker (via env hash rotation); the parser state never lies about what it resolved.

Per file, `parseAtoms({ content, extension })`:

1. **Scan.** `@tailwindcss/oxide` (Rust) finds every Tailwind candidate in the source — `flex-1`, `p-4`, `hover:opacity-80`, `text-[14px]`, `bg-primary/50`, etc.
2. **Compile.** `@tailwindcss/node` turns the candidate list into CSS. The theme import gets a `theme(inline)` modifier so `var(--color-primary)` is resolved to a literal hex. `:root { --duration-fast: 120ms; }` blocks are scraped into a side table so unresolved `var()` references can be dereferenced later.
3. **Walk.** `lightningcss` parses the CSS into a typed AST and we visit:
   - `Rule.style` → one per class selector → collected into a per-atom, per-scheme `RNStyle` object.
   - `Rule.keyframes` → an animation name + step list ready for Reanimated v4's CSS engine.
   - `Rule.property` → `@property --foo { initial-value: 0px }` defaults.
4. **Post-pass.** Several RN-specific fixups run per atom:
   - Tailwind v4's composable transforms (`--tw-translate-x`, `--tw-scale-x`, `--tw-skew-y`, …) get synthesized into an RN `transform: [...]` array.
   - `--tw-shadow` and `--tw-shadow-color` are parsed into RN's `shadowColor` / `shadowOffset` / `shadowOpacity` / `shadowRadius` + Android `elevation`.
   - `--tw-ring-color` is approximated as `borderColor` + `borderWidth`.
   - Tailwind's unitless `line-height` (`calc(2.5 / 2.25)`) is multiplied through by the atom's `font-size` to get RN's required pixel value.
   - Nested `&:where(.dark, .dark *)` rules are attributed to their scheme's bucket instead of the base bucket.

The result per call: a `Map<atomName, { [scheme]: RNStyle }>` plus referenced keyframes plus the declared scheme list.

### `style-builder/` — atoms → per-scheme files

After the parser hands back per-atom styles, the `UnionBuilder` (`src/core/style-builder/union-builder.ts`) takes over.

#### Per-scheme dedup rule

The build emits **one file per scheme** plus a single manifest:

- `<cacheDir>/common.style.js` — every atom's **canonical** value (the synthetic `base` scheme from the parser, or the first non-empty scheme entry).
- `<cacheDir>/<variant>.style.js` (one per declared `@variant`) — only atoms whose value under that variant **differs** from canonical. Atoms that inherit canonical are omitted; the runtime falls through via `cache.atoms[scheme]?.[atom] ?? cache.atoms.common[atom]`.
- `<cacheDir>/schemes.js` — the manifest. Eager-imports `common.style.js`, calls `registerBreakpoints({...})` once with the responsive thresholds the parser extracted from Tailwind's `@media` wrappers, and lazy-`require()`s each variant on first `useRnwind({scheme})` via the `registerSchemeLoader(...)` callback.

This keeps the smallest possible diff per scheme (themes that only re-tint a few colors emit ~10 lines into `<scheme>.style.js`) without the operational complexity of per-file content-addressed chunking.

#### Multi-worker coordination

Metro spawns N transformer worker processes. Each worker has its own `UnionBuilder` instance with its own in-memory state. Coordination is achieved through:

1. **Project scan on first access.** Every worker's first `recordFile` / `writeSchemes` call triggers `ensureProjectScanned()` — the oxide Scanner walks all sources once and hydrates the union with the full atom set. From that point on, per-file `recordFile` deltas only re-affirm what the scan already knew.
2. **Idempotent writes.** Each scheme file's source is signature-hashed (SHA-256 prefix). `writeIfChanged` no-ops when the bytes match what's on disk. Two workers racing produce byte-identical output → last writer wins, no corruption.
3. **Atomic file replacement.** Writes go to `<target>.<pid>.<nonce>.tmp` then `rename()` into place — POSIX-atomic, no half-written JS ever visible.

#### Per-atom serialization cache

`UnionBuilder` carries a per-atom `Map<atomName, AtomSerializedEntry>` across `writeSchemes` calls. Each entry stamps the resolved `SchemedStyle` reference (identity-keyed) plus the canonical + per-variant serialized strings. On the typical Fast Refresh save (one className added in one component), only the new atom's value is re-stringified — the other 175+ atoms hit the cache.

#### Manifest output

```js
// <cacheDir>/schemes.js — generated
import { registerSchemeLoader, registerBreakpoints } from 'rnwind'
import './common.style'

registerBreakpoints({ "sm": 640, "md": 768, "lg": 1024, "xl": 1280, "2xl": 1536 })

const LOADERS = {
  "dark":  () => require("./dark.style"),
  "light": () => require("./light.style"),
}

function ensureSchemeLoaded(name) {
  const loader = LOADERS[name]
  if (loader) loader()
}

registerSchemeLoader(ensureSchemeLoaded)
export { ensureSchemeLoaded }
```

#### Per-scheme file output

```js
// <cacheDir>/common.style.js — generated
import { StyleSheet } from 'react-native'
import { registerAtoms } from 'rnwind'

const _s0 = { flex: 1 }
const _s1 = { padding: 16 }
const _s2 = { backgroundColor: '#6366f1' }

registerAtoms('common', {
  'flex-1':     _s0,
  'p-4':        _s1,
  'bg-primary': _s2,
})
```

Plain JS objects — no `StyleSheet.create` wrapping. The values flow through to RN's `style` prop unchanged; RN's flatten step accepts both refs and bare objects equally. Only `*-hairline` atoms get rewritten to `StyleSheet.hairlineWidth` numeric refs (so device density adapts at runtime).

Atoms that reference `@keyframes` (via `animationName`) get the keyframe block inlined directly into their style object as the object shape Reanimated v4's CSS engine expects (`{ '0%': {...}, '100%': {...} }`). Safe-area atoms get pre-enveloped as `{__safeStyle: [['paddingTop', 't', or, offset], …]}` so the runtime resolves them against live insets via a single property check.

### `dts.ts` — the generated types

```ts
// rnwind-types.d.ts — auto-generated, overwritten on every Metro start

declare module 'react-native' {
  interface ViewProps { className?: string }
  interface TextProps { className?: string }
  // …every core RN props interface
}

declare module 'rnwind' {
  export interface RnwindConfig {
    themes: readonly ['light', 'dark', 'brand']
  }
}
```

That's how `<View className="…" />` typechecks without consumers writing any augmentation, and why `useRnwind()` returns `'light' | 'dark' | 'brand'` instead of `string` in apps with declared variants. The `themes` tuple comes from the parser's `declaredSchemes` — a by-product of reading the theme CSS at Metro start, which also doubles as the earliest possible moment we'd surface a malformed theme.

---

## Runtime pipeline

Your app bundle contains these runtime pieces and nothing else from rnwind:

- `lookup-css.ts` — the resolver + registries.
- `scheme-context.tsx` — the React context.
- A handful of small hooks (`useRnwind`, `useCss`, `useTheme`, `useToken`, `useColor`, `useSize`, `useInteract`).

### The atom registry

`lookup-css.ts` holds a process-global `Map<string, AtomValue>`. Every chunk file imported by the bundle calls `registerAtoms({...})` at module init, merging its atoms into the map. Last write wins — a theme-hash rotation that swaps a chunk for a new one cleanly supersedes the old values.

Atoms hold one of:

- A number (RN `StyleSheet` reference id).
- An array of refs (for atoms that expanded into multiple declarations).
- A per-scheme record `{ light: ref, dark: ref, … }`.

### `lookupCss(input, scheme, userStyle?)` — the hot path

Two input shapes, both cached:

- **Hoisted frozen atom array** (`_c_<hash>`) — cached in a `WeakMap` keyed on the array reference. First call walks + freezes. Every subsequent call on the same array returns the same reference. React style-prop diff stays referentially equal → no native view update.
- **Raw string** (from dynamic expressions like `mergeClasses(...)`) — cached in a `Map` keyed on the trimmed string, capped at 512 entries FIFO (LRU-ish — re-inserting on hit moves the entry to MRU under Map's insertion order).

A cache hit is O(1) and allocates nothing. A cache miss walks the atoms, resolves each via the registry (picking the active scheme from per-scheme records), freezes the output, and stores it.

An optional `userStyle` arg is merged via a second WeakMap layer so `style={{ opacity }}` composed with `className="flex-1"` still produces stable identity across renders (as long as `userStyle` is the same object reference).

### The scheme context

`RnwindProvider` is the only React component rnwind exposes. It holds `{ scheme, tables }`:

- `scheme` — the active scheme name, which `useRnwind()` returns.
- `tables` — per-scheme resolved CSS custom properties, consumed by `useTheme()` / `useToken()` / `useColor()` / `useSize()`. You only need `tables` if your code reads theme tokens at runtime (most code doesn't — classNames already carry the final values).

The runtime doesn't import `react-native` here, so the module tree-shakes cleanly in non-RN environments (SSR, testing).

### Hooks

| Hook                                | Returns                                       |
|-------------------------------------|-----------------------------------------------|
| `useRnwind()`                       | The active scheme name (`'light'`, …).        |
| `useRnwind()`                       | Full context: `{ scheme, tables, insets, fontScale, windowWidth, activeBreakpoint, onHaptics }`. |
| `useCss(className, userStyle?)`     | Resolved style array — for dynamic classNames outside JSX. |
| `useTheme()`                        | The full token table for the active scheme.   |
| `useToken('--color-primary')`       | One raw value from the active scheme's table. |
| `useColor('primary')`               | Shorthand for `useToken('--color-primary')`.  |
| `useSize('4')`                      | Shorthand for `useToken('--spacing-4')`.      |
| `useTailwindValue('bg-primary p-4')` | Build-time only — rewritten to a literal tuple. Falls back to `[]` at runtime. |

---

## Data flow, end to end

```
┌────────────────────────────────────────────────────────────┐
│ src/App.tsx                                                │
│   <View className="flex-1 p-4 bg-primary" />               │
└──────────────────────┬─────────────────────────────────────┘
                       │
                       ▼  metro/transformer.ts
          parse source ─→ transform-ast.ts rewrites JSX
                       ─→ parser/tw-parser.ts resolves atoms
                       ─→ chunker/registry.ts partitions + writes chunks
                       ─→ generate rewritten source
                       ─→ hand to upstream (expo / Flow / RN)
                       │
                       ▼
   ┌──────────────────────────────────────────────────────┐
   │ const _c_a1b2 = Object.freeze(['flex-1','p-4','bg-primary']) │
   │ import 'rnwind/__generated/schemes7f9a'              │
   │ import 'rnwind/__generated/schemesc0d1'              │
   │ <View style={lookupCss(_c_a1b2, _s, undefined)} />   │
   └──────────────────────┬───────────────────────────────┘
                          │
                          ▼  metro/resolver.ts
                  serves <cacheDir>/styles/<id>.js for each import
                          │
                          ▼  bundle
   ┌──────────────────────────────────────────────────────┐
   │ // <cacheDir>/styles/7f9a.js                         │
   │ const _base = StyleSheet.create({ s0:{flex:1}, … })  │
   │ registerAtoms({ 'flex-1':[_base.s0], … })            │
   └──────────────────────┬───────────────────────────────┘
                          │
                          ▼  on device
                    runtime/lookup-css.ts
      WeakMap<_c_a1b2, frozen [style refs, per active scheme]>
                          │
                          ▼
                    React Native's native view manager
```

---

## Caching model

Caching is a 3-layer story:

### Metro's cache

Metro already caches transformer outputs keyed by `(source, config, env)`. rnwind does not duplicate this — we rely on Metro to memoize our transform on unchanged sources.

### Disk chunk cache — `<cacheDir>/styles/`

- One JS file per chunk id.
- Content-addressed + theme-salted. Theme edits rotate every id, forcing Metro to see "new modules" and rebuild.
- Atomically written (temp + rename), so concurrent workers never produce half-written files.
- Garbage-collected once at Metro startup; never during transform.
- Defaults to `node_modules/.cache/rnwind` — auto-gitignored, wiped by `bun install --force`.

### Runtime in-memory caches

- `ATOMS` — global registry populated by `registerAtoms({...})` at chunk-import time. Map, ~O(1) per atom.
- `KEYFRAMES` — global registry populated by `registerKeyframes({...})`, consulted by Reanimated.
- `ARRAY_CACHE` — `WeakMap<atomArray, { base: Map<scheme, style[]>, merged: WeakMap<userStyle, style[]> }>`. Lives as long as the hoisted array does (i.e., the module's lifetime).
- `STRING_CACHE` — `Map<className, same cache shape>`, capped at 512 FIFO. For dynamic expressions.

All four are keyed so that a cache hit is referentially identical to the previous hit — React's style-prop diff short-circuits.

---

## What rnwind deliberately does not do

- **No runtime Tailwind.** `@tailwindcss/oxide`, `@tailwindcss/node`, and `lightningcss` are compile-time only. Your production bundle ships none of them.
- **No CSS cascade emulation.** RN has no cascade. Every class resolves to a flat `{ property: value }` map at compile time; precedence is class-list order, same as JavaScript object merge.
- **No `var()` at runtime.** Theme variables are resolved during compile, per scheme. The runtime only sees final values (hex strings, pixel numbers).
- **No selector support outside of `@variant`.** `hover:`, `active:`, and `focus:` work by pressure/focus RN props on compatible components; nested combinators like `&:hover > *` are not representable on RN's view manager and are silently ignored.
- **No global stylesheet.** Styles live in per-file chunks. Adding a file to your app doesn't bloat other files' imports.

---

## Pointers into the codebase

| You want to…                              | Start here                                          |
|-------------------------------------------|-----------------------------------------------------|
| Add a new built-in utility                | `packages/rnwind/preset.css`                        |
| Change how a Tailwind declaration lowers  | `src/core/parser/declaration.ts` + dispatchers      |
| Change the chunk file format              | `src/core/chunker/build-chunk.ts`                   |
| Change the partition algorithm            | `src/core/chunker/partition.ts`                     |
| Change the JSX rewrite                    | `src/metro/transform-ast.ts`                        |
| Wire a new Metro option                   | `src/metro/with-config.ts` + `src/metro/state.ts`   |
| Change the chunk cache location           | `src/metro/with-config.ts` (`cacheDir` option)      |
| Change the generated .d.ts                | `src/metro/dts.ts`                                  |
| Add or change a runtime hook              | `src/runtime/hooks/`                                |
| Touch the resolver                        | `src/runtime/lookup-css.ts`                         |

---

## Further reading

- `README.md` — user-facing overview + wiring guide.
- `packages/rnwind/__tests__/` — per-module test suites. The metro ones (`metro/end-to-end.test.ts`, `metro/transformer-chain.test.ts`) are the best worked examples of the full pipeline.
