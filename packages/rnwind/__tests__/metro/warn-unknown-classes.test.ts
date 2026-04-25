import { describe, expect, it } from 'bun:test'
import { filterUnknownClassCandidates } from '../../src/metro/warn-unknown-classes'

/**
 * Regression test for the false-positive "unknown class" warnings the
 * user reported. Before this fix, the warning filter was just
 * `/[-:[]/` — anything with a hyphen, colon, or bracket counted as a
 * candidate utility. Oxide also surfaces tokens from:
 *  - Comment markers (`/* \@rnwind-theme=… *\/`),
 *  - Import specifiers (`'expo-router'`, `'react-native'`),
 *  - JSX string prop values (`keyboardType="email-address"`),
 *  - The color suffixes inside compound utilities (`bg-sky-500` → also
 *    surfaces `sky-500` as a bare candidate),
 *
 * all of which match `-` and were wrongly flagged. Legitimate typos
 * (e.g. `bg-srface` vs `bg-surface`) still need to warn — the fix keeps
 * that path intact by restricting candidates to tokens that actually
 * appear as a word inside a `className="…"` literal.
 */
describe('warnUnknownClasses: only warns for candidates that appear as a className token', () => {
  it('suppresses candidates that never appear in any className literal (imports, comments, prop values)', () => {
    const source = `/* @rnwind-theme=04a52690 */
import { Link } from 'expo-router'
import { TextInput } from 'react-native'
export default () => (
  <TextInput keyboardType="email-address" className="px-4 bg-surface" />
)`
    const atoms = new Set(['px-4', 'bg-surface'])
    const candidates = ['@rnwind-theme', 'expo-router', 'react-native', 'email-address', 'px-4', 'bg-surface']
    const unknown = filterUnknownClassCandidates(source, candidates, atoms)
    // None of the non-className tokens survive — nor do the atoms
    // which parsed cleanly. Result is empty.
    expect(unknown).toEqual([])
  })

  it('still reports real typos — an unparsed className token that IS in a className literal', () => {
    const source = `export default () => <View className="flex-1 bg-srface" />`
    const atoms = new Set(['flex-1'])
    const candidates = ['flex-1', 'bg-srface']
    expect(filterUnknownClassCandidates(source, candidates, atoms)).toEqual(['bg-srface'])
  })

  it('ignores bare color tokens oxide surfaces from compound utilities (bg-sky-500 also emits sky-500)', () => {
    // Tailwind oxide scanner lists compound utilities AND their bare
    // suffixes as separate candidates. `sky-500` / `sky-700` are not
    // real utilities on their own; the parser cannot compile them.
    // They never appear as a standalone className token, so the warn
    // filter drops them.
    const source = `export default () => <Pressable className="bg-sky-500 active:bg-sky-700" />`
    const atoms = new Set(['bg-sky-500', 'active:bg-sky-700'])
    const candidates = ['bg-sky-500', 'active:bg-sky-700', 'sky-500', 'sky-700']
    expect(filterUnknownClassCandidates(source, candidates, atoms)).toEqual([])
  })

  it('handles both double-quoted and single-quoted and template-literal classNames', () => {
    const source = `
      const A = <V className="a-1" />
      const B = <V className={'b-2'} />
      const C = <V className={\`c-3\`} />
    `
    const atoms = new Set(['a-1'])
    const candidates = ['a-1', 'b-2', 'c-3', 'not-in-source']
    // Only tokens that appear in SOME className literal get considered.
    // 'b-2' and 'c-3' are in literals but not atoms → unknown.
    // 'not-in-source' is nowhere → filtered out (import, comment, etc.).
    expect(filterUnknownClassCandidates(source, candidates, atoms).toSorted((a, b) => a.localeCompare(b))).toEqual(['b-2', 'c-3'])
  })
})
