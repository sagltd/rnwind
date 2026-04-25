export const BENCHMARK_CONFIG = {
  /** Grid sizes the hook sweeps through, smallest first. */
  SIZES: [10, 1000, 10_000] as const,
  /** Number of timed re-render cycles per size. */
  RUNS_PER_SIZE: 5,
  /** ms between render cycles — lets React + the platform settle. */
  DELAY_BETWEEN_RUNS: 100,
} as const

export interface BenchmarkStats {
  average: number
  min: number
  max: number
  median: number
  stdDev: number
  count: number
}

const average = (values: number[]): number => (values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length)

const stdDev = (values: number[]): number => {
  if (values.length === 0) return 0
  const avg = average(values)
  return Math.sqrt(average(values.map((v) => (v - avg) ** 2)))
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export const calculateStats = (measurements: number[]): BenchmarkStats => ({
  average: average(measurements),
  min: measurements.length === 0 ? 0 : Math.min(...measurements),
  max: measurements.length === 0 ? 0 : Math.max(...measurements),
  median: median(measurements),
  stdDev: stdDev(measurements),
  count: measurements.length,
})
