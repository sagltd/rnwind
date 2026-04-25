import { beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { TailwindParser, type RNStyle } from '../../../src/core/parser'

/**
 * End-to-end cover for Tailwind v4's `object-fit` utilities. React
 * Native's `<Image>` / `<ImageBackground>` accept `objectFit` in the
 * `style` prop with the same value set as CSS (modern RN). The
 * mapping is one-to-one — Tailwind's utility name → RN `objectFit`:
 *
 *   - `object-contain`    → `{ objectFit: 'contain' }`
 *   - `object-cover`      → `{ objectFit: 'cover' }`
 *   - `object-fill`       → `{ objectFit: 'fill' }`
 *   - `object-none`       → `{ objectFit: 'none' }`
 *   - `object-scale-down` → `{ objectFit: 'scale-down' }`
 *
 * Full list at https://tailwindcss.com/docs/object-fit.
 */

const preset = readFileSync(path.resolve(__dirname, '..', '..', '..', 'preset.css'), 'utf8')
const themeCss = `@import "tailwindcss";\n${preset}`

let parser: TailwindParser

beforeAll(() => {
  parser = new TailwindParser({ themeCss })
})

/**
 * Transform one className through the shared parser and return its
 * base-scheme RN style.
 * @param className Tailwind class name.
 * @returns RN style resolved under the first (base) scheme.
 */
async function resolve(className: string): Promise<RNStyle> {
  const result = await parser.parseAtoms({ content: `<V className="${className}" />`, extension: 'tsx' })
  const schemed = result.atoms.get(className)
  if (!schemed) throw new Error(`atom ${className} missing`)
  const [firstScheme] = Object.keys(schemed)
  return schemed[firstScheme!] as RNStyle
}

describe('object-fit utilities', () => {
  it.each([
    ['object-contain', 'contain'],
    ['object-cover', 'cover'],
    ['object-fill', 'fill'],
    ['object-none', 'none'],
    ['object-scale-down', 'scale-down'],
  ])('%s maps to { objectFit: %s }', async (className, expected) => {
    const style = await resolve(className)
    expect(style.objectFit).toBe(expected)
  })
})
