/**
 * Time-budgeted measurement primitive. Each bench scenario calls this
 * once with a function and a budget — the loop runs warmup iterations
 * discarding the first few samples, then collects `performance.now()`
 * deltas until the wall clock elapses.
 *
 * The shape of the returned {@link BenchResult} is the only number the
 * report ever publishes. Keep the hot loop allocation-free beyond the
 * sample array so measurements aren't dominated by GC noise.
 */

/** One measurement result, serialisable to JSON for the report. */
export interface BenchResult {
  /** Library label shown in the table. */
  library: string
  /** Number of full iterations completed inside the budget. */
  iterations: number
  /** Mean wall-clock milliseconds per iteration. */
  meanMs: number
  /** p95 latency in milliseconds. */
  p95Ms: number
  /** Derived throughput: 1000 / meanMs. */
  opsPerSec: number
  /** Total wall clock the loop spent (ms, ≥ budgetMs). */
  totalMs: number
}

/** Options for {@link runBudget}. */
export interface RunBudgetOptions {
  /** Display label for the library under test. */
  library: string
  /** Wall-clock budget for the measurement window (ms). Default 1000. */
  budgetMs?: number
  /** Warmup iterations executed + discarded before the window. Default 2. */
  warmup?: number
  /** Work function — runs once per iteration. */
  run: () => void | Promise<void>
}

/**
 * Execute `run()` repeatedly, discarding warmup samples, then measure
 * until `budgetMs` has elapsed. Async variant — `await`s each iteration
 * so async library paths don't bleed timing across calls.
 * @param options Bench options.
 * @returns Aggregated measurement.
 */
export async function runBudget(options: RunBudgetOptions): Promise<BenchResult> {
  const budget = options.budgetMs ?? 1000
  const warmup = options.warmup ?? 10

  for (let index = 0; index < warmup; index += 1) {
    await options.run()
  }

  const samples: number[] = []
  const start = performance.now()
  let elapsed = 0
  while (elapsed < budget) {
    const t0 = performance.now()

    await options.run()
    const t1 = performance.now()
    samples.push(t1 - t0)
    elapsed = t1 - start
  }
  const totalMs = elapsed

  if (samples.length === 0) {
    throw new Error(`runBudget(${options.library}): no samples collected in ${budget}ms`)
  }

  const sum = samples.reduce((a, b) => a + b, 0)
  const meanMs = sum / samples.length
  const sorted = samples.toSorted((a, b) => a - b)
  const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
  const p95Ms = sorted[p95Index]!

  return {
    library: options.library,
    iterations: samples.length,
    meanMs,
    p95Ms,
    opsPerSec: meanMs > 0 ? 1000 / meanMs : Number.POSITIVE_INFINITY,
    totalMs,
  }
}

/**
 * Sort results deterministically for report rendering: fastest first
 * (highest ops/sec), ties broken by library name.
 * @param results Per-library bench results for one scenario.
 * @returns New array, ranked.
 */
export function rankResults(results: readonly BenchResult[]): BenchResult[] {
  return results.toSorted((a, b) => {
    if (b.opsPerSec !== a.opsPerSec) return b.opsPerSec - a.opsPerSec
    return a.library.localeCompare(b.library)
  })
}
