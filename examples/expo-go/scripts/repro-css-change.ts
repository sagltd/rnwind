/**
 * Repro for the `useCss('enter-fade')` returning `[]` after a
 * theme-CSS edit. Runs two transforms through the SAME shared state (the
 * `state.ts` module-scope statePromise), mutates the CSS between them, and
 * dumps what the rewriter emitted for the `useCss` call each time.
 */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { transform } from '../../../packages/rnwind/src/metro/transformer'

const require = createRequire(import.meta.url)
const generateModule = require('../../../packages/rnwind/node_modules/@babel/generator') as {
  default?: (ast: unknown, opts?: unknown) => { code: string }
}
const generate = generateModule.default ?? (generateModule as unknown as (ast: unknown, opts?: unknown) => { code: string })

const projectRoot = path.resolve(import.meta.dirname, '..')
const cssPath = path.resolve(projectRoot, 'global.css')
const targetPath = path.resolve(projectRoot, 'app/index.tsx')

const originalCss = readFileSync(cssPath, 'utf8')
const source = readFileSync(targetPath, 'utf8')

// Mirror what `withRnwindConfig` publishes so the worker-side state module
// can locate the CSS entry file.
process.env.RNWIND_CSS_ENTRY_FILE = cssPath

const first = await runTransform()
console.log('\n=== FIRST TRANSFORM ===')
dump(first)

const mutations: Array<{ label: string; from: string; to: string }> = [
  { label: 'change --color-bg', from: '--color-bg: #f8fafc', to: '--color-bg: #f0f0f0' },
  { label: 'change --color-primary', from: '--color-primary: #6366f1', to: '--color-primary: #ff0000' },
  {
    label: 'rename a variant color in dark block',
    from: 'dark {\n      --color-bg: #0b1120',
    to: 'dark {\n      --color-bg: #000000',
  },
]

for (const mutation of mutations) {
  try {
    const mutated = originalCss.replace(mutation.from, mutation.to)
    if (mutated === originalCss) {
      console.log(`\n(skip — mutation "${mutation.label}" was a no-op)`)
      continue
    }
    writeFileSync(cssPath, mutated)

    const after = await runTransform()
    console.log(`\n=== AFTER: ${mutation.label} ===`)
    dump(after)
  } finally {
    writeFileSync(cssPath, originalCss)
  }
}

async function runTransform(): Promise<string> {
  const result = await transform({ filename: targetPath, options: { projectRoot }, src: source })
  return generate(result.ast, { retainLines: false }).code
}

function dump(code: string): void {
  const useResolvedLine = code.split('\n').find((line) => /useCss\(/.test(line)) ?? '(no call)'
  const enterFadeLine = code.split('\n').find((line) => /enter-fade/.test(line)) ?? '(no enter-fade)'
  console.log('useCss call →', useResolvedLine.trim())
  console.log('enter-fade registerAtoms entry →', enterFadeLine.trim())
}
