import { beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { TailwindParser } from '../../../src/core/parser'

/**
 * Parser-level contract for the `active:` prefix — the mobile-correct
 * variant for press-and-hold styling. Tailwind v4 compiles
 * `active:bg-sky-700` to `.active\:bg-sky-700 { &:active { … } }`;
 * the parser must recognise the prefix, apply the nested `:active`
 * decls across every scheme, and tag the bucket with
 * `__state: 'active'` so the build-side + runtime can gate the style.
 */

const preset = readFileSync(path.resolve(__dirname, '..', '..', '..', 'preset.css'), 'utf8')
const themeCss = `@import "tailwindcss";\n${preset}`

let parser: TailwindParser

beforeAll(() => {
  parser = new TailwindParser({ themeCss })
})

describe('active: prefix — parser recognition', () => {
  it('active:bg-sky-700 produces { __state: "active", base: {...} }', async () => {
    const result = await parser.parseAtoms({
      content: `<V className="active:bg-sky-700" />`,
      extension: 'tsx',
    })
    const schemed = result.atoms.get('active:bg-sky-700') as Record<string, unknown> | undefined
    expect(schemed).toBeDefined()
    expect(schemed!.__state).toBe('active')
    const bucket = schemed!.base as { backgroundColor?: string }
    expect(typeof bucket.backgroundColor).toBe('string')
  })

  it('active:opacity-70 carries the opacity into the bucket', async () => {
    const result = await parser.parseAtoms({
      content: `<V className="active:opacity-70" />`,
      extension: 'tsx',
    })
    const schemed = result.atoms.get('active:opacity-70') as Record<string, unknown> | undefined
    expect(schemed).toBeDefined()
    expect(schemed!.__state).toBe('active')
    const bucket = schemed!.base as { opacity?: number }
    expect(bucket.opacity).toBe(0.7)
  })
})
