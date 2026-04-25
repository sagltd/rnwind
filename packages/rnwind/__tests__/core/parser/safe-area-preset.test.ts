import { beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { TailwindParser } from '../../../src/core/parser'

/**
 * Lock in that the full rnwind preset (including every `*-safe` /
 * `*-safe-or-*` / `*-safe-offset-*` utility) round-trips through
 * Tailwind v4 + lightningcss without emitting an `Invalid custom
 * property` error. Covers the theme-vars walker regression fix where
 * `--value(integer)` inside `max(...)` / `calc(...)` was being treated
 * as a top-level custom-property declaration and spilled into the
 * extracted theme block.
 *
 * The real value encoding of `env(...)` is NOT asserted here — that's
 * handled by the parser/detector tests in SA 2/7.
 */

const preset = readFileSync(path.resolve(__dirname, '..', '..', '..', 'preset.css'), 'utf8')
const themeCss = `@import "tailwindcss";\n${preset}`

let parser: TailwindParser

beforeAll(() => {
  parser = new TailwindParser({ themeCss })
})

describe('safe-area preset', () => {
  it.each([
    'p-safe',
    'px-safe',
    'py-safe',
    'ps-safe',
    'pe-safe',
    'pt-safe',
    'pr-safe',
    'pb-safe',
    'pl-safe',
    'm-safe',
    'mx-safe',
    'my-safe',
    'ms-safe',
    'me-safe',
    'mt-safe',
    'mr-safe',
    'mb-safe',
    'ml-safe',
    'inset-safe',
    'inset-x-safe',
    'inset-y-safe',
    'top-safe',
    'right-safe',
    'bottom-safe',
    'left-safe',
    'start-safe',
    'end-safe',
    'h-screen-safe',
    'min-h-screen-safe',
    'max-h-screen-safe',
  ])('compiles plain %s without error', async (className) => {
    const result = await parser.parseAtoms({ content: `<V className="${className}" />`, extension: 'tsx' })
    expect(result.atoms.has(className)).toBe(true)
  })

  it.each([
    'pt-safe-or-4',
    'mx-safe-or-4',
    'p-safe-or-2',
    'inset-safe-or-0',
    'top-safe-or-8',
    'mt-safe-or-[2px]',
    'pl-safe-or-[1rem]',
    'inset-x-safe-or-[10%]',
  ])('compiles fallback %s without error', async (className) => {
    const result = await parser.parseAtoms({ content: `<V className="${className}" />`, extension: 'tsx' })
    expect(result.atoms.has(className)).toBe(true)
  })

  it.each([
    'pt-safe-offset-4',
    'mt-safe-offset-8',
    'p-safe-offset-2',
    'inset-safe-offset-0',
    'top-safe-offset-[2px]',
    'ps-safe-offset-[1rem]',
  ])('compiles offset %s without error', async (className) => {
    const result = await parser.parseAtoms({ content: `<V className="${className}" />`, extension: 'tsx' })
    expect(result.atoms.has(className)).toBe(true)
  })
})

describe('theme-vars walker regression', () => {
  it('does not interpret --foo inside var() / nested calls as a top-level declaration', async () => {
    // This CSS previously broke the walker — `--spacing` inside var(...)
    // and `--value(integer)` inside calc/max were extracted as fake theme
    // vars, spilling into the compiled @theme block and producing invalid
    // CSS that Tailwind rejected on compile.
    const custom = `@import "tailwindcss";
      @utility fx-* {
        margin: calc(var(--spacing) * --value(integer));
        padding: max(env(safe-area-inset-top), --value([*]));
      }`
    const localParser = new TailwindParser({ themeCss: custom })
    // Shouldn't throw — that's the regression coverage.
    await expect(localParser.parseAtoms({ content: `<V className="fx-4 fx-[2px]" />`, extension: 'tsx' })).resolves.toBeDefined()
  })

  it('ignores @utility bodies when extracting theme vars', async () => {
    // A fresh parser built from a theme that only declares a --foo token
    // inside a @utility (not @theme) block should NOT see --foo in any
    // scheme. Utility bodies are not theme scopes.
    const custom = `@import "tailwindcss";
      @utility fx-* {
        --not-a-theme-var: 42;
        margin: calc(var(--spacing) * --value(integer));
      }`
    const localParser = new TailwindParser({ themeCss: custom })
    await expect(localParser.parseAtoms({ content: `<V className="fx-4" />`, extension: 'tsx' })).resolves.toBeDefined()
  })
})
