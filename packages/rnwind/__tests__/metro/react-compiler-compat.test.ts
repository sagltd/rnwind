import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from '@babel/core'

/**
 * Host apps that adopt React 19's compiler will run `babel-plugin-react-compiler`
 * over rnwind's runtime. The compiler auto-memoizes components/hooks, which is
 * only sound when each function obeys the Rules of React. It reports a
 * `CompileError` (or `PipelineError`) via its `logger` whenever a function
 * breaks those rules and bails out of optimization. This suite feeds rnwind's
 * runtime hot path through the compiler and asserts a clean compile — proof the
 * compiler can optimize the runtime instead of skipping it.
 */

/** Package root, resolved from this test file (two levels up from `__tests__/metro`). */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** A single event emitted by the compiler's `logger.logEvent`. */
interface CompilerEvent {
  readonly kind: string
  readonly fnName: string | null
  readonly reason: string | null
}

/** Outcome of compiling one source through the compiler. */
interface CompileOutcome {
  /** Names of functions the compiler successfully memoized. */
  readonly compiled: readonly string[]
  /** `CompileError` / `PipelineError` events — must be empty for compatibility. */
  readonly errors: readonly CompilerEvent[]
}

/**
 * Pull the human-readable reason off a logger event, tolerating the few shapes
 * the compiler uses across its event kinds (`detail.reason`, a printed message,
 * or the bare `reason` on skip events).
 * @param event Raw logger event payload.
 * @returns A reason string, or null when the event carries none.
 */
function reasonOf(event: Record<string, unknown>): string | null {
  const detail = event.detail as { reason?: string; printedMessage?: string } | undefined
  return detail?.reason ?? detail?.printedMessage ?? (event.reason as string | undefined) ?? null
}

/**
 * Run one TSX/TS source through `babel-plugin-react-compiler`, capturing every
 * logger event. `panicThreshold: 'none'` keeps the compiler from throwing on a
 * bail so we observe the reported error instead of an exception; the syntax
 * plugins let Babel parse JSX + TypeScript without resolving any imports (the
 * compiler analyses the AST per-function, so unresolved `react` / sibling
 * imports are fine).
 * @param source Source text to compile.
 * @param filename Virtual filename (drives the compiler's diagnostics).
 * @returns The compiled function names and any error events.
 */
function compileWithReactCompiler(source: string, filename: string): CompileOutcome {
  const events: CompilerEvent[] = []
  const logger = {
    /**
     * Sink for the compiler's per-function events.
     * @param _filename Emitting file (ignored — we key on the call site).
     * @param event The logged event.
     */
    logEvent(_filename: string, event: Record<string, unknown>): void {
      events.push({ kind: event.kind as string, fnName: (event.fnName as string | undefined) ?? null, reason: reasonOf(event) })
    },
  }
  transformSync(source, {
    filename,
    configFile: false,
    babelrc: false,
    plugins: [
      ['babel-plugin-react-compiler', { target: '19', panicThreshold: 'none', logger }],
      '@babel/plugin-syntax-jsx',
      ['@babel/plugin-syntax-typescript', { isTSX: true }],
    ],
  })
  return {
    compiled: events.filter((event) => event.kind === 'CompileSuccess').map((event) => event.fnName ?? '<anonymous>'),
    errors: events.filter((event) => event.kind === 'CompileError' || event.kind === 'PipelineError'),
  }
}

/**
 * Read a package-relative source file and compile it through the compiler.
 * @param relativePath Path under the package root.
 * @returns The compile outcome.
 */
function compileSourceFile(relativePath: string): CompileOutcome {
  const filename = path.resolve(PACKAGE_ROOT, relativePath)
  return compileWithReactCompiler(readFileSync(filename, 'utf8'), filename)
}

/** Runtime hot-path sources every rnwind app renders through on every frame. */
const RUNTIME_HOT_PATH = [
  'src/runtime/wrap.tsx',
  'src/runtime/components/rnwind-provider.tsx',
  'src/runtime/hooks/use-scheme.ts',
  'src/runtime/hooks/use-interact.ts',
  'src/runtime/hooks/use-css.ts',
] as const

/**
 * The shape the Metro transformer emits: a `wrap()`-ed host bound to a hoisted
 * style atom (`_rnw0`), rendered with `style={[…]}`. Verifying this compiles
 * clean proves the *generated* output is compiler-safe, not just the runtime.
 */
const TRANSFORMED_COMPONENT = `
const View = _rnwWrap(_rnw0)
export const C = () => <View style={[{ padding: 16 }]} />
`

describe('React Compiler compatibility — runtime hot path compiles clean', () => {
  for (const relativePath of RUNTIME_HOT_PATH) {
    it(`compiles ${relativePath} with no CompileError / PipelineError`, () => {
      const { compiled, errors } = compileSourceFile(relativePath)
      // Meaningful, not vacuous: every file must yield at least one memoized
      // function AND zero error events. A file the compiler couldn't parse
      // would report neither, so the `compiled` floor guards against that.
      expect(errors).toEqual([])
      expect(compiled.length).toBeGreaterThan(0)
    })
  }

  it('memoizes the wrap component and the interact / theme hooks', () => {
    const wrap = compileSourceFile('src/runtime/wrap.tsx')
    const interact = compileSourceFile('src/runtime/hooks/use-interact.ts')
    const scheme = compileSourceFile('src/runtime/hooks/use-scheme.ts')
    expect(wrap.compiled).toContain('RnwindWrapped')
    expect(interact.compiled).toContain('useInteract')
    expect(scheme.compiled).toContain('useTheme')
  })

  it('compiles the transformer-emitted component shape with no errors', () => {
    const { compiled, errors } = compileWithReactCompiler(TRANSFORMED_COMPONENT, 'transformed-output.tsx')
    expect(errors).toEqual([])
    expect(compiled.length).toBeGreaterThan(0)
  })

  it('the harness actually fails on a Rules-of-React violation (guards against a vacuous pass)', () => {
    const violating = `
      import { useRef } from 'react'
      export function Broken() {
        const ref = useRef(null)
        ref.current = Math.random()
        if (Math.random() > 0.5) useRef(0)
        return ref.current
      }
    `
    const { errors } = compileWithReactCompiler(violating, 'broken.tsx')
    expect(errors.length).toBeGreaterThan(0)
  })
})
