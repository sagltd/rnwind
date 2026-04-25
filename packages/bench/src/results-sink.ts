/**
 * Tests don't print their bench numbers — they append them to a shared
 * JSON file under `reports/`. The report emitter (`src/report.ts`) is
 * the only consumer, and it runs after the jest process exits. Writing
 * to disk instead of stdout keeps the jest test log readable and lets
 * the report be regenerated from stored results without re-running the
 * bench.
 *
 * The sink is keyed by scenario name (`transform`, `first-render`,
 * `re-render`) so each metric test owns exactly one slot. A `clearSink`
 * call at the start of the first test per process wipes stale data.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import path from 'node:path'
import type { BenchResult } from './run-budget'

/** One scenario's per-library results. */
export interface ScenarioResults {
  /** Scenario key (e.g. `transform`). */
  scenario: string
  /** Human-readable description rendered into the report. */
  description: string
  /** Per-library bench results. */
  results: BenchResult[]
  /** ISO timestamp the scenario finished (for the disclosure footer). */
  finishedAt: string
}

/** Full sink payload persisted to disk. */
export interface SinkPayload {
  /** Machine that produced the numbers; the report's disclosure block prints this. */
  environment: {
    node: string
    platform: NodeJS.Platform
    arch: string
    cpus: number
    ci: boolean
  }
  /** One entry per scenario key. */
  scenarios: ScenarioResults[]
}

const reportsDir = path.resolve(__dirname, '..', 'reports')
const sinkPath = path.join(reportsDir, 'results.json')

/**
 * Read the current sink, or return an empty payload when none exists.
 * @returns Parsed sink contents.
 */
export function readSink(): SinkPayload {
  if (!existsSync(sinkPath)) return emptyPayload()
  try {
    return JSON.parse(readFileSync(sinkPath, 'utf8')) as SinkPayload
  } catch {
    return emptyPayload()
  }
}

/**
 * Overwrite the sink with a fresh payload. Idempotent.
 */
export function clearSink(): void {
  mkdirSync(reportsDir, { recursive: true })
  writeFileSync(sinkPath, JSON.stringify(emptyPayload(), undefined, 2), 'utf8')
}

/**
 * Append (or replace) one scenario's results in the sink.
 * @param scenario Results block for a single scenario key.
 */
export function writeScenario(scenario: ScenarioResults): void {
  mkdirSync(reportsDir, { recursive: true })
  const payload = readSink()
  const filtered = payload.scenarios.filter((s) => s.scenario !== scenario.scenario)
  filtered.push(scenario)
  const next: SinkPayload = { environment: snapshotEnv(), scenarios: filtered }
  writeFileSync(sinkPath, JSON.stringify(next, undefined, 2), 'utf8')
}

/**
 * Produce a zero-state sink with the current environment snapshotted in.
 * @returns Empty payload.
 */
function emptyPayload(): SinkPayload {
  return { environment: snapshotEnv(), scenarios: [] }
}

/**
 * Capture the subset of env state the report discloses. Kept minimal so
 * anyone reading a `results.md` knows what machine the numbers came from.
 * @returns Environment snapshot.
 */
function snapshotEnv(): SinkPayload['environment'] {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: cpus().length,
    ci: process.env.CI === 'true' || process.env.CI === '1',
  }
}
