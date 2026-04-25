import type { ParsedComponent } from 'lightningcss'

/**
 * Serialize an `@property --x { initial-value: … }` body to plain text —
 * enough for the downstream var() resolver to use as a fallback.
 * @param initial Parsed-component AST node (or null when absent).
 * @returns CSS-value string, or `null` when missing / unsupported shape.
 */
export function serializeInitialValue(initial: ParsedComponent | null | undefined): string | null {
  if (!initial) return null
  if (initial.type === 'literal') return initial.value
  if (initial.type === 'custom-ident') return initial.value
  if (initial.type === 'string') return initial.value
  return null
}
