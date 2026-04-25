import { beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { TailwindParser, type GradientAtomInfo } from '../../../src/core/parser'

/**
 * Lock the parser's gradient-atom surface. The transformer relies on
 * this map to know which atoms are gradient directions vs colour
 * stops, and which colour each stop carries. Every Tailwind v4
 * shape (`bg-gradient-to-*`, `from-*`, `via-*`, `to-*`) must land in
 * `gradientAtoms` with the right role.
 */

const preset = readFileSync(path.resolve(__dirname, '..', '..', '..', 'preset.css'), 'utf8')
const themeCss = `@import "tailwindcss";\n${preset}`

let parser: TailwindParser

beforeAll(() => {
  parser = new TailwindParser({ themeCss })
})

/**
 * Transform the supplied classes through the shared parser and return
 * the resulting `gradientAtoms` map.
 * @param classes Tailwind class names to feed through oxide.
 * @returns Parser-surfaced gradient metadata, keyed by atom name.
 */
async function parse(classes: readonly string[]): Promise<Map<string, GradientAtomInfo>> {
  const result = await parser.parseAtoms({ content: `<V className="${classes.join(' ')}" />`, extension: 'tsx' })
  return result.gradientAtoms
}

describe('parser — gradientAtoms', () => {
  it('surfaces the resolved colour for from-/via-/to- atoms', async () => {
    const info = await parse(['from-red-500', 'via-green-500', 'to-blue-500'])
    expect(info.get('from-red-500')).toEqual({ role: 'from', color: expect.any(String) } as never)
    expect(info.get('via-green-500')).toEqual({ role: 'via', color: expect.any(String) } as never)
    expect(info.get('to-blue-500')).toEqual({ role: 'to', color: expect.any(String) } as never)
    // Colors are hex strings (cssColorToString normalises oklch → hex).
    expect((info.get('from-red-500') as { color: string }).color).toMatch(/^#/)
  })

  it('surfaces direction for bg-gradient-to-*', async () => {
    const info = await parse(['bg-gradient-to-r', 'bg-gradient-to-br'])
    expect(info.get('bg-gradient-to-r')).toEqual({ role: 'direction', dir: 'to-r' })
    expect(info.get('bg-gradient-to-br')).toEqual({ role: 'direction', dir: 'to-br' })
  })

  it('does not populate the map for non-gradient atoms', async () => {
    const info = await parse(['flex-1', 'p-4', 'bg-red-500'])
    expect(info.size).toBe(0)
  })
})
