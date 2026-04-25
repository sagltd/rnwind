import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { TailwindParser } from '../../../src/core/parser'

/**
 * Parser-level haptic detection: every `haptic-*` preset class must
 * surface the corresponding {@link HapticRequest} into
 * `parsed.hapticAtoms` so the transformer can hoist + wire callbacks.
 */

const PRESET = readFileSync(path.resolve(__dirname, '..', '..', '..', 'preset.css'), 'utf8')
const THEME = `@import 'tailwindcss';\n${PRESET}`

/**
 * Compile a single class through the parser and return its haptic
 * metadata, or `null` when the atom isn't registered as a haptic.
 * @param className Class to inspect.
 * @returns Haptic request, or null.
 */
async function haptic(className: string): Promise<unknown> {
  const parser = new TailwindParser({ themeCss: THEME })
  const result = await parser.parseAtoms({
    content: `<div className="${className}" />`,
    extension: 'tsx',
  })
  return result.hapticAtoms.get(className) ?? null
}

describe('parser — haptics', () => {
  it('detects impact styles', async () => {
    expect(await haptic('haptic-light')).toEqual({ kind: 'impact', style: 'Light' })
    expect(await haptic('haptic-medium')).toEqual({ kind: 'impact', style: 'Medium' })
    expect(await haptic('haptic-heavy')).toEqual({ kind: 'impact', style: 'Heavy' })
    expect(await haptic('haptic-soft')).toEqual({ kind: 'impact', style: 'Soft' })
    expect(await haptic('haptic-rigid')).toEqual({ kind: 'impact', style: 'Rigid' })
  })

  it('detects notification types', async () => {
    expect(await haptic('haptic-success')).toEqual({ kind: 'notification', type: 'Success' })
    expect(await haptic('haptic-warning')).toEqual({ kind: 'notification', type: 'Warning' })
    expect(await haptic('haptic-error')).toEqual({ kind: 'notification', type: 'Error' })
  })

  it('detects selection', async () => {
    expect(await haptic('haptic-selection')).toEqual({ kind: 'selection' })
  })

  it('returns null for non-haptic classes', async () => {
    expect(await haptic('bg-red-500')).toBeNull()
  })
})
