#!/usr/bin/env bun
/**
 * Emit `reports/results.md` from the JSON sink (`reports/results.json`)
 * + the feature matrix. Runs after `jest` as part of `bun run bench`;
 * can be re-run on its own to regenerate the markdown without touching
 * the numbers.
 *
 * The published table is intentionally opinionated: three metrics, three
 * libraries (plus a baseline), rounded to a readable number of digits.
 * Raw per-iteration samples stay in the JSON file for anyone who wants
 * to audit.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { SinkPayload, ScenarioResults } from './results-sink'
import { features, type Support } from './feature-matrix'

const reportsDir = path.resolve(__dirname, '..', 'reports')
const jsonPath = path.join(reportsDir, 'results.json')
const markdownPath = path.join(reportsDir, 'results.md')

type LibraryId = 'rnwind' | 'nativewind' | 'uniwind'

const support: Record<Support, string> = { yes: 'Yes', partial: 'Partial', no: 'No' }

/**
 * Round to N decimal places, dropping trailing zeros.
 * @param value Numeric value.
 * @param digits Decimal places to keep.
 * @returns Human-readable string.
 */
function round(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '∞'
  // Fixed-precision slice → trim trailing zeros. The regex is bounded
  // to the formatted string's length, so no super-linear backtracking
  // can occur at scale (sonarjs/slow-regex is a false positive here).
  const fixed = value.toFixed(digits)
  if (!fixed.includes('.')) return fixed || '0'
  let end = fixed.length
  while (end > 0 && fixed.codePointAt(end - 1) === 48 /* '0' */) end -= 1
  if (end > 0 && fixed.codePointAt(end - 1) === 46 /* '.' */) end -= 1
  return fixed.slice(0, end) || '0'
}

/**
 * Build one scenario's perf table, fastest first.
 * @param scenario Per-library scenario result block.
 * @returns Markdown fragment for the scenario.
 */
function renderScenarioTable(scenario: ScenarioResults): string {
  const sorted = scenario.results.toSorted((a, b) => b.opsPerSec - a.opsPerSec)
  const best = sorted[0]?.opsPerSec ?? 0
  const rows = sorted.map((result) => {
    const ratio = best > 0 ? result.opsPerSec / best : 1
    const relative = ratio >= 0.999 ? 'baseline' : `${round(ratio, 2)}×`
    return `| ${result.library} | ${round(result.opsPerSec, 1)} | ${round(result.meanMs, 3)} | ${round(result.p95Ms, 3)} | ${result.iterations} | ${relative} |`
  })
  return [
    `### ${scenario.scenario}`,
    ``,
    scenario.description,
    ``,
    '| Library | ops/sec | mean (ms) | p95 (ms) | n | vs fastest |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
    ``,
  ].join('\n')
}

/**
 * Build the feature-matrix markdown table.
 * @returns Markdown fragment for the feature table.
 */
function renderFeatureTable(): string {
  const rows = features.map((feature) => {
    const cell = (library: LibraryId): string => {
      const value = feature[library]
      const note = feature.note?.[library]
      const base = support[value]
      return note ? `${base}¹ *(${note})*` : base
    }
    return `| ${feature.name} | ${cell('rnwind')} | ${cell('nativewind')} | ${cell('uniwind')} |`
  })
  return ['| Feature | rnwind | nativewind | uniwind |', '| --- | :---: | :---: | :---: |', ...rows].join('\n')
}

/**
 * Compose the disclosure block.
 * @param payload Parsed sink payload.
 * @returns Markdown fragment for the methodology section.
 */
function renderDisclosure(payload: SinkPayload): string {
  const env = payload.environment
  return [
    '**Environment**',
    '',
    `- Node ${env.node}, ${env.platform}/${env.arch}, ${env.cpus} CPUs, ${env.ci ? 'CI' : 'local'} run.`,
    '- `NODE_ENV=production`; jest `--runInBand --no-cache`; 10-iteration warmup; 1-second time budget per scenario.',
    '- All libraries share one fixture, one class intersection, one React + RN + renderer version set.',
    "- Each scenario fails loud if the library's expected runtime wrapper is missing from the transform output.",
    '- `baseline` is pure React Native + `StyleSheet.create` — the floor a library can approach but not beat.',
    '- **Not measured**: Hermes JIT, native bridge cost. Numbers cover the JS work that differs between the libraries.',
    '- Harness source: `packages/bench/` — re-run with `bun run --cwd packages/bench bench`.',
  ].join('\n')
}

/** Entry point. */
function main(): void {
  const payload = JSON.parse(readFileSync(jsonPath, 'utf8')) as SinkPayload
  const listScenarios = payload.scenarios
    .filter((s) => s.scenario.startsWith('list-'))
    .toSorted((a, b) => {
      const an = Number(a.scenario.slice(5))
      const bn = Number(b.scenario.slice(5))
      return an - bn
    })
  const coreOrdered: ScenarioResults[] = []
  for (const key of ['transform', 'first-render', 're-render']) {
    const found = payload.scenarios.find((s) => s.scenario === key)
    if (found) coreOrdered.push(found)
  }
  const ordered = [...coreOrdered, ...listScenarios]

  const body = [
    '# rnwind vs NativeWind vs Uniwind — perf + feature comparison',
    '',
    `_Generated at ${new Date().toISOString()}._`,
    '',
    '## Performance',
    '',
    ...ordered.map((scenario) => renderScenarioTable(scenario)),
    '## Feature matrix',
    '',
    renderFeatureTable(),
    '',
    '## Methodology',
    '',
    renderDisclosure(payload),
    '',
    '## How to reproduce',
    '',
    '```bash',
    'bun install',
    'bun run --cwd packages/bench bench',
    '```',
    '',
    'Numbers land in `packages/bench/reports/results.json` (raw) and `results.md` (this file).',
    '',
  ].join('\n')

  writeFileSync(markdownPath, body, 'utf8')
  // eslint-disable-next-line no-console
  console.log(`wrote ${path.relative(process.cwd(), markdownPath)}`)
  // eslint-disable-next-line no-console
  console.log(`\n${body}`)
}

main()
