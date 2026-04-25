/**
 * Full bench suite — all scenarios run in a single jest file so the
 * expensive setup (module load, per-library transforms) is paid once
 * and amortised across every metric. Each scenario is still capped at a
 * **1-second** measurement budget per library.
 *
 * Why one file: each separate `*.test.ts` file pays ~2s of jest
 * startup + babel-jest transpilation. Six scenarios × 4 libraries hit
 * that cost six times if split. Consolidated, the whole run is roughly
 * (startup) + 6 × 4 × 1 s ≈ 25 s.
 */

import { createElement, type FC } from 'react'
import { render } from '@testing-library/react-native'
import { runBudget, type BenchResult } from '../src/run-budget'
import { evaluateTransformed, pickDefault } from '../src/evaluate'
import { transformBaseline, transformBaselineList } from '../src/transforms/baseline'
import { transformRnwind, transformRnwindList } from '../src/transforms/rnwind'
import { transformNativewind, transformNativewindList } from '../src/transforms/nativewind'
import { transformUniwind, transformUniwindList } from '../src/transforms/uniwind'
import { writeScenario } from '../src/results-sink'

type CardComponent = () => unknown
type ListComponent = (props: { count: number }) => unknown

/** Four libraries under test — including the zero-library baseline. */
const LIBRARIES = ['baseline', 'rnwind', 'nativewind', 'uniwind'] as const
type Library = (typeof LIBRARIES)[number]

const cardTransforms: Record<Library, () => Promise<string>> = {
  baseline: transformBaseline,
  rnwind: transformRnwind,
  nativewind: transformNativewind,
  uniwind: transformUniwind,
}

const listTransforms: Record<Library, () => Promise<string>> = {
  baseline: transformBaselineList,
  rnwind: transformRnwindList,
  nativewind: transformNativewindList,
  uniwind: transformUniwindList,
}

/**
 * Transform + evaluate every library's Card or List fixture.
 * @param transforms Per-library transform wrappers.
 * @param cacheSuffix Appended to the in-process eval cache key.
 * @returns Mapping library → component.
 */
async function loadComponents<T>(
  transforms: Record<Library, () => Promise<string>>,
  cacheSuffix: string,
): Promise<Record<Library, T>> {
  const out = {} as Record<Library, T>
  for (const library of LIBRARIES) {
    const source = await transforms[library]()
    const module_ = evaluateTransformed(`${library}${cacheSuffix}`, source)
    const Component = pickDefault(module_) as T | undefined
    if (typeof Component !== 'function') throw new Error(`${library}: transformed module has no default export`)
    out[library] = Component
  }
  return out
}

/**
 * Measure a scenario across all four libraries, storing per-library
 * results and writing the scenario into the results sink.
 * @param scenario Scenario key for the report.
 * @param description Human-readable caption for the scenario.
 * @param make Builds the per-library `run` function.
 * @param warmup Override the runBudget warmup count (defaults to 2).
 */
async function benchScenario(
  scenario: string,
  description: string,
  make: (library: Library) => () => void | Promise<void>,
  warmup?: number,
): Promise<void> {
  const results: BenchResult[] = []
  for (const library of LIBRARIES) {
    results.push(await runBudget({ library, warmup, run: make(library) }))
  }
  writeScenario({ scenario, description, finishedAt: new Date().toISOString(), results })
  for (const r of results) expect(r.iterations).toBeGreaterThan(0)
}

/**
 * Fairness gate — every library must render a non-null tree once before
 * the timing loop runs. A null tree means the fixture didn't bootstrap.
 * @param cards Per-library Card components.
 */
function fairnessGate(cards: Record<Library, CardComponent>): void {
  for (const library of LIBRARIES) {
    const probe = render(createElement(cards[library] as unknown as FC))
    if (probe.toJSON() === null) throw new Error(`${library}: card render is null`)
    probe.unmount()
  }
}

describe('rnwind bench', () => {
  it('runs every scenario under a 1s budget per library', async () => {
    // --- Scenario 1: transform cost ---
    await benchScenario('transform', 'Full babel/metro transform of the shared Card fixture.', (library) => async () => {
      await cardTransforms[library]()
    })

    // --- Load components for the render scenarios ---
    const cards = await loadComponents<CardComponent>(cardTransforms, '')
    const lists = await loadComponents<ListComponent>(listTransforms, '-list')
    fairnessGate(cards)

    // --- Scenario 2: first render ---
    await benchScenario('first-render', 'Mount the Card fixture via @testing-library/react-native.', (library) => () => {
      const tree = render(createElement(cards[library] as unknown as FC))
      tree.unmount()
    })

    // --- Scenario 3: re-render ---
    const rerenderTrees = {} as Record<Library, ReturnType<typeof render>>
    for (const library of LIBRARIES) {
      rerenderTrees[library] = render(createElement(cards[library] as unknown as FC))
    }
    try {
      await benchScenario(
        're-render',
        'rerender() a mounted Card — measures per-library className→style resolution on the hot path.',
        (library) => () => {
          rerenderTrees[library].rerender(createElement(cards[library] as unknown as FC))
        },
      )
    } finally {
      for (const library of LIBRARIES) rerenderTrees[library].unmount()
    }

    // --- Scenarios 4–6: list render at N = 10 / 100 / 1000 ---
    for (const count of [10, 100, 1000] as const) {
      await benchScenario(
        `list-${count}`,
        `Mount + unmount a list of ${count} realistic items (avatar + 2 text lines + badge).`,
        (library) => () => {
          const tree = render(createElement(lists[library] as unknown as FC<{ count: number }>, { count }))
          tree.unmount()
        },
        count <= 100 ? 2 : 1,
      )
    }
  }, 120_000)
})
