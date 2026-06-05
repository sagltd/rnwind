import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { parse } from '@babel/parser'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configureRnwindState, resetRnwindState, transform } from '../../src/metro'

let root: string
const common = (): string => {
  const f = path.join(root, '.rnwind', 'common.style.js')
  return existsSync(f) ? readFileSync(f, 'utf8') : '<none>'
}
/**
 * Write a source file then run it through the transformer once — simulates one
 * Metro transform pass so a re-call models a hot-reload edit of the same file.
 * @param file Path relative to the temp project root.
 * @param source File contents to write and transform.
 */
async function tx(file: string, source: string): Promise<void> {
  writeFileSync(path.join(root, file), source)
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  await transform({ filename: path.join(root, file), src: source, options: { projectRoot: root }, ast: ast as never })
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'rnwind-hmr-'))
  writeFileSync(path.join(root, 'global.css'), `@import 'tailwindcss';`)
  configureRnwindState(path.join(root, 'global.css'), path.join(root, '.rnwind'))
})
afterEach(() => { resetRnwindState(); if (existsSync(root)) rmSync(root, { recursive: true, force: true }) })

describe('HMR: new classes register on re-transform', () => {
  it('A) className file — adding a NEW class on re-transform registers it', async () => {
    await tx('A.tsx', `import {View} from 'react-native'\nexport default ()=><View className="p-4"/>`)
    expect(common()).toContain('"p-4"')
    await tx('A.tsx', `import {View} from 'react-native'\nexport default ()=><View className="p-4 m-8"/>`)
    expect(common()).toContain('"m-8"')
  })
  it('B) cva file — classes register', async () => {
    await tx('v.ts', `import {cva} from 'class-variance-authority'\nexport const v = cva("opacity-50 text-base")`)
    expect(common()).toContain('"opacity-50"')
  })
  it('C) cva file — adding a NEW class on re-transform registers it', async () => {
    await tx('v.ts', `import {cva} from 'class-variance-authority'\nexport const v = cva("opacity-50")`)
    await tx('v.ts', `import {cva} from 'class-variance-authority'\nexport const v = cva("opacity-50 rounded-xl")`)
    expect(common()).toContain('"rounded-xl"')
  })
  it('D) clsx + cn + tv files register', async () => {
    await tx('a.ts', `import {clsx} from 'clsx'\nexport const a = () => clsx("gap-3")`)
    await tx('b.ts', `export const b = (cn:any) => cn("tracking-wide")`)
    await tx('c.ts', `import {tv} from 'tailwind-variants'\nexport const c = tv({ base: "leading-7" })`)
    expect(common()).toContain('"gap-3"')
    expect(common()).toContain('"tracking-wide"')
    expect(common()).toContain('"leading-7"')
  })
  it('E) PLAIN const-string file (no className/cva/useCss) registers + hot-reloads', async () => {
    // Content-driven like Tailwind — no helper marker needed.
    await tx('tokens.ts', `export const CARD = "rounded-xl shadow-sm"\nexport const HEAD = "uppercase"`)
    expect(common()).toContain('"rounded-xl"')
    expect(common()).toContain('"uppercase"')
    await tx('tokens.ts', `export const CARD = "rounded-xl shadow-sm tracking-tight"\nexport const HEAD = "uppercase"`)
    expect(common()).toContain('"tracking-tight"')
  })
})
