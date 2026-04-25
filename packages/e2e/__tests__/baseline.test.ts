import { afterEach, describe, expect, it } from 'bun:test'
import { transformAndRegister, type HarnessHandle } from './helpers/harness'

/**
 * Minimum guarantee: a plain `<View className="…">` source file gets
 * rewritten, its chunk is materialised, and the runtime resolves the
 * class string into RN-shaped styles. If this fails every library-specific
 * test below is noise, so run it first.
 */

let harness: HarnessHandle | null = null
afterEach(() => {
  harness?.teardown()
  harness = null
})

describe('rnwind baseline end-to-end', () => {
  it('rewrites className to lookupCss and resolves atoms at runtime', async () => {
    harness = await transformAndRegister(`const V: any = () => null; export default () => <V className="flex-1 p-4" />`)
    expect(harness.transformedSource).toMatch(/style=\{lookupCss\(_c_[0-9a-f]{12}, _s\)\}/)
    expect(harness.chunkSpecifiers.length).toBeGreaterThan(0)
    const styles = harness.resolve('flex-1 p-4') as readonly Record<string, unknown>[]
    const merged = Object.assign({}, ...styles) as Record<string, unknown>
    expect(merged.flex).toBe(1)
    expect(merged.padding).toBe(16)
  })

  it('resolves dynamic className strings (simulates a library call)', async () => {
    // Source contains the classes literally so Oxide picks them up, but
    // the JSX site passes a dynamic expression — exactly how every
    // class-utility library lands in user code.
    harness = await transformAndRegister(
      `const V: any = () => null;
       const compose = (active: boolean): string => active ? "p-4 bg-red-500" : "p-4";
       export default () => <V className={compose(true)} />`,
    )
    // Dynamic className expressions get wrapped in <InteractiveBox> with the
    // raw expression on `_rw.cn`, so the runtime can tokenize the string and
    // attach press/focus handlers if any of the resolved tokens are interactive.
    expect(harness.transformedSource).toMatch(/<InteractiveBox\s+_rw=\{\{[^}]*cn:\s*compose\(true\)/)
    const styles = harness.resolve('p-4 bg-red-500') as readonly Record<string, unknown>[]
    const merged = Object.assign({}, ...styles) as Record<string, unknown>
    expect(merged.padding).toBe(16)
    expect(merged.backgroundColor).toBeDefined()
  })
})
