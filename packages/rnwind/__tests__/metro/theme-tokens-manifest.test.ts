import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { parse } from '@babel/parser'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configureRnwindState, resetRnwindState, transform } from '../../src/metro'

let root: string

const manifest = (): string => {
  const f = path.join(root, '.rnwind', 'schemes.js')
  return existsSync(f) ? readFileSync(f, 'utf8') : '<none>'
}

/**
 * Write a source file and run it through the transformer once.
 * @param file Path relative to the temp project root.
 * @param source File contents.
 */
async function tx(file: string, source: string): Promise<void> {
  writeFileSync(path.join(root, file), source)
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  await transform({ filename: path.join(root, file), src: source, options: { projectRoot: root }, ast: ast as never })
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'rnwind-tok-manifest-'))
})
afterEach(() => {
  resetRnwindState()
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

describe('manifest registers theme tokens so useColor/useToken work out of the box', () => {
  it('emits registerThemeTokens with --color-* lowered to sRGB, per scheme', async () => {
    writeFileSync(
      path.join(root, 'global.css'),
      `@import 'tailwindcss';
@custom-variant light (&:where(.light, .light *));
@custom-variant dark (&:where(.dark, .dark *));
@theme { --color-on-background: oklch(0.2 0.01 60); --color-brand: #ef4444; }
@layer base { .dark { --color-on-background: #fafafa; } }`,
    )
    configureRnwindState(path.join(root, 'global.css'), path.join(root, '.rnwind'))
    await tx('A.tsx', `import {Text} from 'react-native'\nexport default ()=><Text className="text-on-background"/>`)

    const out = manifest()
    expect(out).toContain('registerThemeTokens')
    expect(out).toContain('--color-on-background')
    // oklch lowered to sRGB hex (not a raw oklch string).
    expect(out).not.toContain('oklch(')
    // light/base default + dark override both present and distinct.
    expect(out).toContain('#fafafa') // dark override
    expect(out).toContain('--color-brand')
  })

  it('omits registerThemeTokens for a theme with no user tokens', async () => {
    writeFileSync(path.join(root, 'global.css'), `@import 'tailwindcss';`)
    configureRnwindState(path.join(root, 'global.css'), path.join(root, '.rnwind'))
    await tx('A.tsx', `import {View} from 'react-native'\nexport default ()=><View className="p-4"/>`)
    expect(manifest()).not.toContain('registerThemeTokens')
  })
})
