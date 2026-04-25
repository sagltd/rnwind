#!/usr/bin/env bun
/**
 * Benchmark orchestrator.
 *
 * Runs `expo export --platform web` in each app directory, measures wall-clock
 * bundle time and the byte size of the emitted JS bundle, then writes REPORT.md.
 *
 * Web export is used because it can run headlessly (no iOS/Android simulator
 * required) while still exercising each library's full Metro transformer +
 * runtime bundle. Numbers are comparable between libraries because every app
 * renders an identical 1000-view grid with the same className pattern.
 *
 * For on-device render timings (like the uni-stack/uniwind-benchmarks repo),
 * launch one of the apps on a simulator with `bun run --cwd apps/<lib> ios`
 * and read the `RNWIND_BENCH_RESULT` line from the Metro logs.
 */
import { spawn } from 'node:child_process'
import { readdir, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

interface BenchResult {
  lib: string
  ok: boolean
  error?: string
  exportMs: number
  jsBytes: number
  bundleFiles: number
}

const ROOT = resolve(import.meta.dir)
const APPS = ['rnwind', 'nativewind5', 'uniwind'] as const

const run = (cmd: string, args: string[], cwd: string): Promise<{ code: number; stderr: string }> =>
  new Promise((res) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stdout?.on('data', () => {})
    child.stderr?.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('close', (code) => res({ code: code ?? 1, stderr }))
  })

async function walkJs(dir: string): Promise<{ bytes: number; files: number }> {
  if (!existsSync(dir)) return { bytes: 0, files: 0 }
  let bytes = 0
  let files = 0
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = await walkJs(full)
      bytes += nested.bytes
      files += nested.files
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.hbc')) {
      const s = await stat(full)
      bytes += s.size
      files += 1
    }
  }
  return { bytes, files }
}

async function benchOne(lib: string): Promise<BenchResult> {
  const cwd = join(ROOT, 'apps', lib)
  const bundleDir = join(cwd, '.bundle')
  console.log(`\n[${lib}] exporting web bundle...`)
  const started = performance.now()
  const { code, stderr } = await run('bun', ['run', 'export:web'], cwd)
  const exportMs = performance.now() - started
  if (code !== 0) {
    return {
      lib,
      ok: false,
      error: stderr.trim().split('\n').slice(-8).join('\n'),
      exportMs,
      jsBytes: 0,
      bundleFiles: 0,
    }
  }
  const { bytes, files } = await walkJs(bundleDir)
  return { lib, ok: true, exportMs, jsBytes: bytes, bundleFiles: files }
}

const kb = (n: number) => (n / 1024).toFixed(1)
const sec = (n: number) => (n / 1000).toFixed(2)

function renderReport(results: BenchResult[]): string {
  const baseline = results.find((r) => r.lib === 'rnwind' && r.ok)
  const lines: string[] = []
  lines.push('# rnwind benchmark report')
  lines.push('')
  lines.push(`_Generated ${new Date().toISOString()}_`)
  lines.push('')
  lines.push('Identical scenario across three styling libraries:')
  lines.push('- 1000 `<View>` items in a wrapping flex grid')
  lines.push('- Same className string per item: `w-32 h-24 rounded-2xl bg-primary items-center justify-center`')
  lines.push('- Identical React / React Native / Expo versions')
  lines.push('')
  lines.push('## Results')
  lines.push('')
  lines.push('| Library | Bundle time | JS size | Files | vs rnwind |')
  lines.push('|---|---:|---:|---:|---:|')
  for (const r of results) {
    if (!r.ok) {
      lines.push(`| ${r.lib} | — | — | — | **FAILED** |`)
      continue
    }
    const ratio = baseline && baseline.ok ? (r.jsBytes / baseline.jsBytes).toFixed(2) + '×' : '—'
    lines.push(`| ${r.lib} | ${sec(r.exportMs)} s | ${kb(r.jsBytes)} KB | ${r.bundleFiles} | ${ratio} |`)
  }
  lines.push('')
  lines.push('## Failures')
  lines.push('')
  const failed = results.filter((r) => !r.ok)
  if (failed.length === 0) {
    lines.push('_None._')
  } else {
    for (const r of failed) {
      lines.push(`### ${r.lib}`)
      lines.push('')
      lines.push('```')
      lines.push(r.error ?? 'unknown error')
      lines.push('```')
      lines.push('')
    }
  }
  lines.push('## How this was measured')
  lines.push('')
  lines.push('- Each app runs `expo export --platform web --clear --output-dir .bundle`.')
  lines.push('- Bundle time is wall-clock for that command.')
  lines.push('- JS size is the total bytes of `.js` + `.hbc` files under `.bundle/`.')
  lines.push('- Re-run with `bun run examples/benchmark/bench`.')
  lines.push('')
  lines.push('## What this does and does not capture')
  lines.push('')
  lines.push('**Captures:** build-time cost (Metro transformer + tailwind compile) and ')
  lines.push('shipped runtime weight of each library. Both directly affect mobile cold-start.')
  lines.push('')
  lines.push('**Does not capture:** on-device render time. For that, launch an app with')
  lines.push('`bun run --cwd examples/benchmark/apps/<lib> ios` and read `RNWIND_BENCH_RESULT`')
  lines.push('lines from the Metro logs (the shared `useBenchmark` hook prints them).')
  lines.push('')
  return lines.join('\n')
}

async function main(): Promise<void> {
  const reportOnly = process.argv.includes('--report-only')
  const results: BenchResult[] = []
  if (reportOnly) {
    for (const lib of APPS) {
      const cwd = join(ROOT, 'apps', lib)
      const bundleDir = join(cwd, '.bundle')
      const { bytes, files } = await walkJs(bundleDir)
      results.push({ lib, ok: bytes > 0, exportMs: 0, jsBytes: bytes, bundleFiles: files })
    }
  } else {
    for (const lib of APPS) {
      results.push(await benchOne(lib))
    }
  }
  const report = renderReport(results)
  const reportPath = join(ROOT, 'REPORT.md')
  await writeFile(reportPath, report, 'utf8')
  console.log(`\nwrote ${reportPath}`)
  console.log('\n' + report)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
