# rnwind vs NativeWind vs Uniwind — perf + feature comparison

_Generated at 2026-04-23T17:09:42.466Z._

## Performance

### transform

Full babel/metro transform of the shared Card fixture.

| Library | ops/sec | mean (ms) | p95 (ms) | n | vs fastest |
| --- | ---: | ---: | ---: | ---: | ---: |
| nativewind | 525.4 | 1.903 | 2.342 | 526 | baseline |
| uniwind | 451.3 | 2.216 | 2.508 | 452 | 0.86× |
| baseline | 300.5 | 3.327 | 4.8 | 301 | 0.57× |
| rnwind | 135.8 | 7.362 | 14.443 | 136 | 0.26× |

### first-render

Mount the Card fixture via @testing-library/react-native.

| Library | ops/sec | mean (ms) | p95 (ms) | n | vs fastest |
| --- | ---: | ---: | ---: | ---: | ---: |
| rnwind | 7018.9 | 0.142 | 0.255 | 7013 | baseline |
| baseline | 6807.4 | 0.147 | 0.262 | 6801 | 0.97× |
| nativewind | 6769.1 | 0.148 | 0.251 | 6763 | 0.96× |
| uniwind | 5832.8 | 0.171 | 0.339 | 5829 | 0.83× |

### re-render

rerender() a mounted Card — measures per-library className→style resolution on the hot path.

| Library | ops/sec | mean (ms) | p95 (ms) | n | vs fastest |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 21419.7 | 0.047 | 0.052 | 21362 | baseline |
| rnwind | 20574.5 | 0.049 | 0.066 | 20521 | 0.96× |
| nativewind | 18475.6 | 0.054 | 0.123 | 18427 | 0.86× |
| uniwind | 13152.6 | 0.076 | 0.147 | 13130 | 0.61× |

### list-10

Mount + unmount a list of 10 realistic items (avatar + 2 text lines + badge).

| Library | ops/sec | mean (ms) | p95 (ms) | n | vs fastest |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 1641.8 | 0.609 | 0.734 | 1643 | baseline |
| rnwind | 1636.2 | 0.611 | 0.755 | 1639 | 1× |
| nativewind | 1483.2 | 0.674 | 1.922 | 1483 | 0.9× |
| uniwind | 969.5 | 1.031 | 2.856 | 971 | 0.59× |

### list-100

Mount + unmount a list of 100 realistic items (avatar + 2 text lines + badge).

| Library | ops/sec | mean (ms) | p95 (ms) | n | vs fastest |
| --- | ---: | ---: | ---: | ---: | ---: |
| nativewind | 173.7 | 5.755 | 6.84 | 174 | baseline |
| rnwind | 169.7 | 5.893 | 7.629 | 170 | 0.98× |
| baseline | 165.3 | 6.05 | 15.828 | 166 | 0.95× |
| uniwind | 90.8 | 11.018 | 31.435 | 91 | 0.52× |

### list-1000

Mount + unmount a list of 1000 realistic items (avatar + 2 text lines + badge).

| Library | ops/sec | mean (ms) | p95 (ms) | n | vs fastest |
| --- | ---: | ---: | ---: | ---: | ---: |
| nativewind | 17.9 | 55.725 | 151.294 | 18 | baseline |
| baseline | 17.6 | 56.807 | 134.16 | 18 | 0.98× |
| rnwind | 15.9 | 63.013 | 142.855 | 16 | 0.88× |
| uniwind | 9.7 | 103.131 | 182.092 | 10 | 0.54× |

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
