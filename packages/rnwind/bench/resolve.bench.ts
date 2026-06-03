/**
 * Micro-benchmark for the runtime resolver hot path.
 *
 * Compares, per className resolution:
 *  - molecule (warm) — steady-state re-render: build-time pre-merged object
 *    returned by reference through the resolve cache.
 *  - atom (warm) — same, but the className was never pre-merged into a
 *    molecule, so the FIRST resolve merged atoms; later renders are cached.
 *  - molecule (cold) — first resolve of a unique-state molecule: one map
 *    lookup, no merge.
 *  - atom (cold) — first resolve of a unique-state className: tokenise +
 *    per-atom merge via lookupCss.
 *  - lookupCss raw string — the uncached merge molecules eliminate.
 *
 * Run: `bun run --cwd packages/rnwind bench`
 */
import { Bench } from 'tinybench'
import {
  __resetResolveState,
  registerMolecules,
  resolve,
} from '../src/runtime/resolve'
import { __resetLookupCssState, lookupCss, registerAtoms } from '../src/runtime/lookup-css'
import type { RnwindState } from '../src/runtime/components/rnwind-provider'

/** Minimal context — one scheme, no insets, default font scale. */
function makeState(scheme: string, windowWidth = 0): RnwindState {
  return {
    scheme,
    tables: {},
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    onHaptics: undefined,
    fontScale: 1,
    windowWidth,
    activeBreakpoint: 'base',
  } as unknown as RnwindState
}

const CLASSNAME = 'flex-1 p-4 bg-primary rounded-lg'
const MERGED = { flex: 1, padding: 16, backgroundColor: '#6366f1', borderRadius: 8 }

const ATOMS: Record<string, unknown> = {
  'flex-1': { flex: 1 },
  'p-4': { padding: 16 },
  'bg-primary': { backgroundColor: '#6366f1' },
  'rounded-lg': { borderRadius: 8 },
}

/** Seed the atom + molecule registries the benches resolve against. */
function seed(withMolecule: boolean): void {
  __resetResolveState()
  __resetLookupCssState()
  registerAtoms('common', ATOMS)
  if (withMolecule) registerMolecules('common', { [CLASSNAME]: MERGED })
}

async function main(): Promise<void> {
  const bench = new Bench({ time: 600 })

  // Warm molecule: first call merges (by ref), the rest hit the resolve cache.
  let stateA = makeState('light')
  bench.add('resolve molecule — warm (cached, by-ref)', () => {
    resolve(CLASSNAME, stateA)
  }, { beforeAll: () => { seed(true); stateA = makeState('light'); resolve(CLASSNAME, stateA) } })

  // Warm atom: no molecule; first call merges via lookupCss, rest cached.
  let stateB = makeState('light')
  bench.add('resolve atom — warm (cached)', () => {
    resolve(CLASSNAME, stateB)
  }, { beforeAll: () => { seed(false); stateB = makeState('light'); resolve(CLASSNAME, stateB) } })

  // Cold molecule: vary windowWidth each call → cache miss → molecule lookup, no merge.
  let widthM = 0
  bench.add('resolve molecule — cold (cache miss, map lookup)', () => {
    widthM = (widthM + 1) & 1023
    resolve(CLASSNAME, makeState('light', widthM))
  }, { beforeAll: () => { seed(true); widthM = 0 } })

  // Cold atom: vary windowWidth each call → cache miss → tokenize + merge.
  let widthA = 0
  bench.add('resolve atom — cold (cache miss, per-atom merge)', () => {
    widthA = (widthA + 1) & 1023
    resolve(CLASSNAME, makeState('light', widthA))
  }, { beforeAll: () => { seed(false); widthA = 0 } })

  // Raw uncached merge — the work a molecule removes from the first render.
  const stateC = makeState('light')
  bench.add('lookupCss raw string (always merges)', () => {
    lookupCss(CLASSNAME, stateC)
  }, { beforeAll: () => seed(false) })

  await bench.run()

  // eslint-disable-next-line no-console
  console.log(`\nrnwind resolve() — ${CLASSNAME.split(' ').length} atoms per className\n`)
  // eslint-disable-next-line no-console
  console.table(
    bench.tasks.map((task) => {
      const stats = task.result && 'throughput' in task.result ? task.result : null
      const hz = stats ? stats.throughput.mean : 0
      return {
        name: task.name,
        'ops/sec': hz ? Math.round(hz).toLocaleString() : 'n/a',
        'ns/op': hz ? Math.round(1e9 / hz) : 'n/a',
      }
    }),
  )
}

void main()
