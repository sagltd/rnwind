# rnwind benchmark report

_Generated 2026-04-22T07:39:24.634Z_

Identical scenario across three styling libraries:
- 1000 `<View>` items in a wrapping flex grid
- Same className string per item: `w-32 h-24 rounded-2xl bg-primary items-center justify-center`
- Identical React / React Native / Expo versions

## Results

| Library | Bundle time | JS size | Files | vs rnwind |
|---|---:|---:|---:|---:|
| rnwind | 8.33 s | 330.1 KB | 1 | 1.00× |
| nativewind5 | 9.13 s | 560.6 KB | 1 | 1.70× |
| uniwind | 10.33 s | 1063.6 KB | 1 | 3.22× |

## Failures

_None._
## How this was measured

- Each app runs `expo export --platform web --clear --output-dir .bundle`.
- Bundle time is wall-clock for that command.
- JS size is the total bytes of `.js` + `.hbc` files under `.bundle/`.
- Re-run with `bun run examples/benchmark/bench`.

## What this does and does not capture

**Captures:** build-time cost (Metro transformer + tailwind compile) and 
shipped runtime weight of each library. Both directly affect mobile cold-start.

**Does not capture:** on-device render time. For that, launch an app with
`bun run --cwd examples/benchmark/apps/<lib> ios` and read `RNWIND_BENCH_RESULT`
lines from the Metro logs (the shared `useBenchmark` hook prints them).
