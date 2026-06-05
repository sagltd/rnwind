import { beforeAll, describe, expect, it } from 'bun:test'
import { TailwindParser, type RNStyle } from '../../../src/core/parser'

/**
 * Round-3 polish fixes:
 *  - opacity-suffixed colors emit a rounded alpha (no `0.20000000298…` f32 noise)
 *  - `env(safe-area-inset-*, <fallback>)` captures the fallback as the `or`
 *    floor instead of silently dropping it (collapsing to 0 at runtime)
 */
let parser: TailwindParser

beforeAll(async () => {
  parser = new TailwindParser({ themeCss: `@import "tailwindcss";\n@theme { --color-ok: oklch(0.6 0.2 25); }` })
  await parser.parseAtoms({ content: '<V className="flex-1" />', extension: 'tsx' })
})

/**
 * Resolve the base-scheme RN style for one class.
 * @param cls Tailwind utility.
 * @returns Base-scheme style, or undefined.
 */
async function styleOf(cls: string): Promise<RNStyle | undefined> {
  const r = await parser.parseAtoms({ content: `<V className="${cls}" />`, extension: 'tsx' })
  const [scheme] = r.schemes
  return scheme ? r.atoms.get(cls)?.[scheme] : undefined
}

describe('opacity-suffixed colors round the alpha channel', () => {
  it('text-<oklch token>/20 → rgba with a clean 0.2 alpha', async () => {
    expect(await styleOf('text-ok/20')).toEqual({ color: 'rgba(222, 59, 61, 0.2)' })
  })
  it('bg-red-500/50 → clean 0.5 alpha', async () => {
    expect(await styleOf('bg-red-500/50')).toEqual({ backgroundColor: 'rgba(251, 44, 54, 0.5)' })
  })
})

describe('env(side, fallback) keeps the fallback as the safe-area floor', () => {
  it('pt-[env(safe-area-inset-top,12px)] → {__safe:"t", or:12}', async () => {
    expect(await styleOf('pt-[env(safe-area-inset-top,12px)]')).toEqual({ paddingTop: { __safe: 't', or: 12 } })
  })
  it('rem fallback scales to px', async () => {
    expect(await styleOf('pt-[env(safe-area-inset-top,1rem)]')).toEqual({ paddingTop: { __safe: 't', or: 16 } })
  })
  it('bare env (no fallback) stays a plain marker', async () => {
    expect(await styleOf('pt-[env(safe-area-inset-top)]')).toEqual({ paddingTop: { __safe: 't' } })
  })
})
