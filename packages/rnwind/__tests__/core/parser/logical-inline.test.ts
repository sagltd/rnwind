import { describe, expect, it } from 'bun:test'
import { TailwindParser } from '../../../src/core/parser'

/**
 * Regression: CSS single-sided logical-inline utilities (`ms-*`, `me-*`,
 * `ps-*`, `pe-*`, `start-*`, `end-*`) used to drop to `{}` — only the
 * `*-inline` shorthand (`mx-*`/`px-*`) was mapped. RN exposes the
 * writing-direction Yoga keys directly, so they now resolve.
 */
describe('logical-inline utilities map to RN start/end keys', () => {
  const cases: ReadonlyArray<readonly [string, string, number]> = [
    ['ms-2', 'marginStart', 8],
    ['me-3', 'marginEnd', 12],
    ['ps-2', 'paddingStart', 8],
    ['pe-4', 'paddingEnd', 16],
    ['start-2', 'start', 8],
    ['end-3', 'end', 12],
  ]

  for (const [cls, key, value] of cases) {
    it(`${cls} → { ${key}: ${value} }`, async () => {
      const parser = new TailwindParser({ themeCss: `@import 'tailwindcss';` })
      const result = await parser.parseAtoms({
        content: `export default () => <V className="${cls}" />`,
        extension: 'tsx',
      })
      expect(result.atoms.get(cls)?.base).toEqual({ [key]: value })
    })
  }
})
