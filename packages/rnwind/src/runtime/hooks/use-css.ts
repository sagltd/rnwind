import { useRnwind } from '../components/rnwind-provider'
import { resolve } from '../resolve'

/**
 * Resolve a className to a React Native `style` value against the active
 * rnwind context (scheme, insets, fontScale, breakpoint). Molecule-fast:
 * a literal className the scanner saw returns a pre-merged object by
 * reference; anything else falls back to per-atom resolution. The escape
 * hatch for custom components that hold a `className` prop:
 *
 * ```tsx
 * function Card({ className, style, ...rest }) {
 *   return <RNView style={useCss(className, style)} {...rest} />
 * }
 * ```
 * @param className Raw className string.
 * @param userStyle Optional caller-supplied style appended last (wins).
 * @returns RN `style` value (a single object or an array).
 */
export function useCss(className?: string | null, userStyle?: unknown): unknown {
  return resolve(className, useRnwind(), userStyle).style
}
