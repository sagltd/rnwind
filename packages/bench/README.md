# @rnwind/bench

Fair perf + feature comparison across **rnwind**, **NativeWind**, and **Uniwind**.

## One command

```bash
bun install
bun run --cwd packages/bench bench
```

Writes the full report to [`reports/results.md`](./reports/results.md) and the raw numbers to [`reports/results.json`](./reports/results.json).

## What it measures

Three scenarios per library, each run for one second after a 10-iteration warmup:

| Scenario | What it measures |
|---|---|
| `transform` | The library's real babel/metro pipeline on a shared `Card` fixture source. |
| `first-render` | Mounting the transformed `Card` component via `@testing-library/react-native`. |
| `re-render` | Calling `rerender()` on a mounted `Card` — isolates the library's render-hot-path cost from React's mount overhead. |

Plus a hand-maintained feature matrix (scheme switching, Reanimated, custom utilities, arbitrary values, TS types, …).

## Fairness contract

Before the bench will publish a number:

- One fixture source, identical class strings across all three libraries (intersection of supported classes).
- Same tree topology; rendered trees asserted non-null per library before timing.
- Pinned React + RN + test-renderer versions.
- Each library's real babel/metro pipeline runs — no mocks, no shortcuts. A missing expected runtime wrapper in the transform output fails the run loudly.
- `NODE_ENV=production`, `jest --runInBand --no-cache`, 10-iteration warmup, 1s time budget.
- `performance.now()` is the only timer.
- If a library wins a metric, it wins. The harness publishes whatever numbers come out.

## What it does NOT measure

- Hermes JIT / native bridge cost — this runs on Node.
- App-level scroll FPS on device — separate benchmark domain, not reproducible enough for a README number.
- Features any single library supports on its own — those go in the feature matrix, not the perf table.

## File layout

```
packages/bench/
├── fixtures/
│   └── card.source.ts        # shared JSX sources (rnwind/nativewind babel-rewrite + uniwind HOC)
├── src/
│   ├── run-budget.ts         # time-budgeted bench loop
│   ├── evaluate.ts           # in-process eval of transformed output
│   ├── assert-transform.ts   # fail-loud wrapper-presence check
│   ├── rewrite-requires.ts   # redirects `require('react-native')` to the bench shim
│   ├── rn-shim.compiled.cjs  # minimal RN stand-in (identical for every library)
│   ├── transforms/
│   │   ├── rnwind.ts         # drives rnwind's Metro transformer
│   │   ├── nativewind.ts     # drives NativeWind's babel preset
│   │   └── uniwind.ts        # stock babel; Uniwind rewrites CSS, not JSX
│   ├── results-sink.ts       # tests write per-scenario results to reports/results.json
│   ├── feature-matrix.ts     # hand-maintained capability table
│   └── report.ts             # renders reports/results.md from the JSON sink
└── __tests__/
    ├── transform.test.ts
    ├── first-render.test.ts
    └── re-render.test.ts
```
