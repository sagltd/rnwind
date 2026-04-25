import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configureRnwindState, resetRnwindState, transform } from '../../src/metro'
import { __resetUpstreamCache } from '../../src/metro/transformer'

/**
 * Bug repro: when Expo/Metro configures a `babelTransformerPath`
 * (handles Flow types, expo-router macros, expo's own JSX runtime, etc.),
 * setting `babelTransformerPath` to rnwind's transformer REPLACES the
 * upstream rather than chaining. Files written in Flow (any RN core
 * source) then fail to parse with rnwind's `typescript+jsx`-only
 * fallback. This regression manifested as:
 *   `SyntaxError: Unexpected token (13:25)` in `getDevServer.js`
 * during `expo start --clear`.
 *
 * The fix: the env-driven `RNWIND_UPSTREAM_TRANSFORMER` must be honored —
 * when set, our worker delegates parsing/transform to that upstream
 * module first, then runs our pass on the AST it returns.
 */

let projectRoot: string

beforeEach(() => {
  projectRoot = mkdtempSync(path.join(tmpdir(), 'rnwind-chain-'))
  const cssPath = path.join(projectRoot, 'global.css')
  writeFileSync(cssPath, `@import 'tailwindcss';`)
  configureRnwindState(cssPath, path.join(projectRoot, '.cache'))
})

afterEach(() => {
  resetRnwindState()
  delete process.env.RNWIND_UPSTREAM_TRANSFORMER
  __resetUpstreamCache()
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('Metro transformer chaining', () => {
  it('delegates parsing to RNWIND_UPSTREAM_TRANSFORMER so Flow/expo-router files survive', async () => {
    // Build a fake upstream transformer that parses with the Flow plugin.
    const upstreamPath = path.join(projectRoot, 'fake-upstream.cjs')
    writeFileSync(
      upstreamPath,
      `const { parse } = require(${JSON.stringify(require.resolve('@babel/parser'))})
       module.exports.transform = ({ src }) => ({
         ast: parse(src, { sourceType: 'module', plugins: ['flow', 'jsx'] }),
       })`,
    )
    process.env.RNWIND_UPSTREAM_TRANSFORMER = upstreamPath

    // Flow-specific opaque-type syntax (`opaque type Foo = …`) is not
    // valid TypeScript, so rnwind's typescript+jsx fallback parser will
    // reject it. Forces the chaining path.
    const flowSource = `// @flow\nopaque type Token = string;\nconst x: Token = ('hi': Token);\n`
    const filename = path.join(projectRoot, 'flow.js')
    writeFileSync(filename, flowSource)

    const result = await transform({ filename, src: flowSource, options: { projectRoot } })
    expect(result.ast).toBeDefined()
    // No crash → upstream chained successfully.
  })

  it('delegates even for rewrite candidates (className present + Flow source)', async () => {
    const upstreamPath = path.join(projectRoot, 'fake-upstream.cjs')
    writeFileSync(
      upstreamPath,
      `const { parse } = require(${JSON.stringify(require.resolve('@babel/parser'))})
       module.exports.transform = ({ src }) => ({
         ast: parse(src, { sourceType: 'module', plugins: ['flow', 'jsx'] }),
       })`,
    )
    process.env.RNWIND_UPSTREAM_TRANSFORMER = upstreamPath

    const flowSource = `// @flow\nopaque type Token = string;\nimport { View as V } from 'react-native';\nexport default () => <V className="flex-1" />;\n`
    const filename = path.join(projectRoot, 'flow-with-css.js')
    writeFileSync(filename, flowSource)

    const result = await transform({ filename, src: flowSource, options: { projectRoot } })
    expect(result.ast).toBeDefined()
  })
})
