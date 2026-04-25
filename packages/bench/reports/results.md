# rnwind vs NativeWind vs Uniwind — perf + feature comparison

_Generated at 2026-04-24T06:06:49.287Z._

## Performance

### transform

Full babel/metro transform of the shared Card fixture.

| Library | ops/sec | mean (ms) | p95 (ms) | n | vs fastest |
| --- | ---: | ---: | ---: | ---: | ---: |
| nativewind | 542.2 | 1.844 | 1.953 | 550 | baseline |
| uniwind | 538.8 | 1.856 | 1.99 | 539 | 0.99× |
| baseline | 366.9 | 2.726 | 4.183 | 367 | 0.68× |
| rnwind | 150.3 | 6.654 | 10.139 | 151 | 0.28× |

### first-render

Mount the Card fixture via @testing-library/react-native.

| Library | ops/sec | mean (ms) | p95 (ms) | n | vs fastest |
| --- | ---: | ---: | ---: | ---: | ---: |
| nativewind | 7083.1 | 0.141 | 0.244 | 7078 | baseline |
| baseline | 6858.4 | 0.146 | 0.253 | 6853 | 0.97× |
| rnwind | 6666.7 | 0.15 | 0.245 | 6662 | 0.94× |
| uniwind | 5598.4 | 0.179 | 0.333 | 5595 | 0.79× |

### re-render

rerender() a mounted Card — measures per-library className→style resolution on the hot path.

| Library | ops/sec | mean (ms) | p95 (ms) | n | vs fastest |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 19031.6 | 0.053 | 0.057 | 18989 | baseline |
| rnwind | 18614.8 | 0.054 | 0.059 | 18574 | 0.98× |
| nativewind | 18445 | 0.054 | 0.057 | 18402 | 0.97× |
| uniwind | 12330.1 | 0.081 | 0.087 | 12313 | 0.65× |

### list-10

Mount + unmount a list of 10 realistic items (avatar + 2 text lines + badge).

| Library | ops/sec | mean (ms) | p95 (ms) | n | vs fastest |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 1503.2 | 0.665 | 0.715 | 1503 | baseline |
| nativewind | 1455.1 | 0.687 | 1.25 | 1455 | 0.97× |
| rnwind | 1449.2 | 0.69 | 1.648 | 1449 | 0.96× |
| uniwind | 915 | 1.093 | 2.769 | 917 | 0.61× |

### list-100

Mount + unmount a list of 100 realistic items (avatar + 2 text lines + badge).

| Library | ops/sec | mean (ms) | p95 (ms) | n | vs fastest |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 167.6 | 5.967 | 8.542 | 169 | baseline |
| nativewind | 165.7 | 6.037 | 6.567 | 166 | 0.99× |
| rnwind | 156.2 | 6.402 | 14.503 | 157 | 0.93× |
| uniwind | 97.6 | 10.245 | 20.406 | 98 | 0.58× |

### list-1000

Mount + unmount a list of 1000 realistic items (avatar + 2 text lines + badge).

| Library | ops/sec | mean (ms) | p95 (ms) | n | vs fastest |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 17 | 58.988 | 134.485 | 17 | baseline |
| nativewind | 16.5 | 60.515 | 142.919 | 17 | 0.97× |
| rnwind | 15.6 | 64.166 | 174.761 | 16 | 0.92× |
| uniwind | 9.8 | 102.485 | 182.543 | 10 | 0.58× |

## Feature matrix

| Feature | rnwind | nativewind | uniwind |
| --- | :---: | :---: | :---: |
| Tailwind v4 theme + variants | Yes | No¹ *(NativeWind v4.2 tracks Tailwind v3.)* | Yes |
| Build-time JSX rewrite | Yes | Yes | No¹ *(Runtime HOC (`withUniwind(...)`) instead of a babel rewrite.)* |
| Styles live in StyleSheet.create | Yes | Partial¹ *(Goes through `react-native-css-interop` runtime first.)* | Yes |
| Multiple scheme variants (not just light/dark) | Yes | No | Yes |
| Interactive variants (hover:, focus:) | Yes | Yes | Partial¹ *(Pressed/hover variants via data attributes, covered by runtime HOC.)* |
| CSS keyframe animations | Yes | Yes | Yes |
| Reanimated CSS animations | Yes | Partial¹ *(Works but not on the UI thread by default.)* | Partial¹ *(Some CSS animation features still landing.)* |
| Arbitrary values (`[12px]`, `[#abc]`) | Yes | Yes | Yes |
| Custom utilities via `@utility` | Yes | No | Yes |
| Safe-area utilities (`pt-safe`, …) | Yes | No | Partial¹ *(Requires opting into runtime-backed variables.)* |
| TS autocomplete on every RN component | Yes | Yes | Partial¹ *(Only on components wrapped with `withUniwind(...)`.)* |
| Zero runtime className parsing | Yes | Partial¹ *(css-interop resolves at render via runtime tables.)* | No¹ *(HOC parses className on every render.)* |

## Methodology

**Environment**

- Node v24.11.1, darwin/arm64, 11 CPUs, local run.
- `NODE_ENV=production`; jest `--runInBand --no-cache`; 10-iteration warmup; 1-second time budget per scenario.
- All libraries share one fixture, one class intersection, one React + RN + renderer version set.
- Each scenario fails loud if the library's expected runtime wrapper is missing from the transform output.
- `baseline` is pure React Native + `StyleSheet.create` — the floor a library can approach but not beat.
- **Not measured**: Hermes JIT, native bridge cost. Numbers cover the JS work that differs between the libraries.
- Harness source: `packages/bench/` — re-run with `bun run --cwd packages/bench bench`.

## How to reproduce

```bash
bun install
bun run --cwd packages/bench bench
```

Numbers land in `packages/bench/reports/results.json` (raw) and `results.md` (this file).
