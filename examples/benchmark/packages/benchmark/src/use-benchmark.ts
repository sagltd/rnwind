import { useCallback, useLayoutEffect, useState } from 'react'
import { BENCHMARK_CONFIG, type BenchmarkStats, calculateStats } from './config'

export interface UseBenchmarkReturn {
  /** Current grid size rendered in this step. */
  currentSize: number
  /** Index of the current size in the sweep. */
  currentSizeIdx: number
  /** Run number within the current size (0-indexed). */
  currentRun: number
  /** Full results, keyed by size. Populated progressively. */
  resultsBySize: { size: number; measurements: number[]; stats: BenchmarkStats }[]
  /** True once every size has been fully measured. */
  isComplete: boolean
  /** Bumped on each measured render so the child tree re-evaluates. */
  renderKey: number
  /** Sweep config. */
  sizes: readonly number[]
  runsPerSize: number
}

/**
 * Sweep through the configured grid sizes, doing `RUNS_PER_SIZE` forced
 * re-renders per size. Prints one `RNWIND_BENCH_RESULT` line per size so the
 * orchestrator (or a human tailing Metro logs) can capture the numbers.
 *
 * Methodology follows uni-stack/uniwind-benchmarks: wall-clock between
 * `setRenderKey` and the first idle callback after layout. Multi-size sweep
 * exposes per-item scaling cost on top of the fixed startup cost each library
 * pays.
 * @param label Short library identifier printed in the tagged log line.
 * @returns Current sweep state for the hosting component to render.
 */
export function useBenchmark(label: string): UseBenchmarkReturn {
  const [currentSizeIdx, setCurrentSizeIdx] = useState(0)
  const [currentRun, setCurrentRun] = useState(0)
  const [measurements, setMeasurements] = useState<number[]>([])
  const [results, setResults] = useState<{ size: number; measurements: number[]; stats: BenchmarkStats }[]>([])
  const [renderKey, setRenderKey] = useState(0)

  const sizes = BENCHMARK_CONFIG.SIZES
  const runsPerSize = BENCHMARK_CONFIG.RUNS_PER_SIZE
  const isComplete = currentSizeIdx >= sizes.length

  const runBenchmark = useCallback(() => {
    const startTime = performance.now()
    setRenderKey((prev) => prev + 1)
    // @ts-expect-error — global on RN/Hermes + browsers
    requestIdleCallback(() => {
      const duration = performance.now() - startTime
      setMeasurements((prev) => [...prev, duration])
      setCurrentRun((prev) => prev + 1)
    })
  }, [])

  useLayoutEffect(() => {
    if (isComplete) return
    if (currentRun < runsPerSize) {
      const timer = setTimeout(runBenchmark, BENCHMARK_CONFIG.DELAY_BETWEEN_RUNS)
      return () => clearTimeout(timer)
    }
    // Finished this size: record, print tagged line, advance.
    const size = sizes[currentSizeIdx]!
    const stats = calculateStats(measurements)
    console.log(`RNWIND_BENCH_RESULT ${label} ${JSON.stringify({ size, runs: measurements, ...stats })}`)
    setResults((prev) => [...prev, { size, measurements, stats }])
    setMeasurements([])
    setCurrentRun(0)
    setCurrentSizeIdx((prev) => prev + 1)
  }, [currentRun, runBenchmark, isComplete, measurements, label, currentSizeIdx, runsPerSize, sizes])

  const currentSize = sizes[currentSizeIdx] ?? sizes[sizes.length - 1]!
  return {
    currentSize,
    currentSizeIdx,
    currentRun,
    resultsBySize: results,
    isComplete,
    renderKey,
    sizes,
    runsPerSize,
  }
}
