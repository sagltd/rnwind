import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configureRnwindState, resetRnwindState, transform } from '../../src/metro'
import { THEME_SIGNATURE_MODULE } from '../../src/metro/resolver'

/**
 * Stability regression: a forwarder component has NO literal atoms but DOES
 * forward className via `{...props}`. It travels the wrap-only path, so before
 * the fix it received no `import 'rnwind/__generated/theme-signature'` and held
 * no dep-graph edge to the theme CSS — it was never re-transformed when the
 * theme changed, leaving stale renders. The injected import is what carries
 * that edge, so it MUST be present even when the file records no atoms.
 */
let root: string

/**
 * Render the transformed source to its generated code string.
 * @param filename
 * @param source
 */
const codeOf = async (filename: string, source: string): Promise<string> => {
  const result = await transform({ filename, src: source, options: { projectRoot: root } })
  const { default: generate } = await import('@babel/generator')
  const run = (generate as unknown as { default?: typeof generate }).default ?? generate
  return run(result.ast as never).code
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'rnwind-wrap-edge-'))
  const cssPath = path.join(root, 'global.css')
  writeFileSync(cssPath, `@import 'tailwindcss';`)
  configureRnwindState(cssPath, path.join(root, '.rnwind'))
})

afterEach(() => {
  resetRnwindState()
  rmSync(root, { recursive: true, force: true })
})

describe('wrap-only forwarder holds a theme-signature dep edge', () => {
  it('injects the theme-signature import for a {...props} forwarder with no literal atoms', async () => {
    const filename = path.join(root, 'Forwarder.tsx')
    const source = `import {View} from 'react-native'\nexport default (props)=><View {...props} />`
    const code = await codeOf(filename, source)
    expect(code).toContain(THEME_SIGNATURE_MODULE)
  })

  it('still injects exactly once on the hasAtoms path (no double import)', async () => {
    const filename = path.join(root, 'WithAtoms.tsx')
    const source = `import {View} from 'react-native'\nexport default ()=><View className="flex-1" />`
    const code = await codeOf(filename, source)
    const occurrences = code.split(THEME_SIGNATURE_MODULE).length - 1
    expect(occurrences).toBe(1)
  })
})
