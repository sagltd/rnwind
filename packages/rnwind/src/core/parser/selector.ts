import type { SelectorComponent } from 'lightningcss'

/**
 * Pull a bare class name out of a lightningcss selector-part array. Accepts
 * only the simple shape — one `{type: 'class', name}` component — since
 * Tailwind utility rules land as flat single-class selectors once variants
 * are folded in. Compound or pseudo selectors return `null` so the caller
 * skips them.
 * @param selector One selector's component array.
 * @returns Bare class name, or `null` when the selector is anything more complex.
 */
export function classNameFromSelector(selector: readonly SelectorComponent[]): string | null {
  if (selector.length !== 1) return null
  const [head] = selector
  if (head?.type !== 'class') return null
  return head.name
}
