import { useRnwind } from '../components/rnwind-provider'
import { lookupCss } from '../lookup-css'

/**
 * Convenience hook: `useRnwind()` + `lookupCss()` rolled into one. Use
 * inside any component that wants the resolved style array without
 * threading the rnwind context manually. JSX-heavy components should
 * still call `useRnwind()` once and pass it to `lookupCss(...)` per
 * element so React only does a single context read per render.
 * @param className Raw className string or transformer-hoisted atom-name array.
 * @param userStyle Optional caller-supplied style appended last.
 * @returns Frozen style array for React Native's `style` prop.
 */
export function useCss(className?: string | readonly string[] | null, userStyle?: unknown): readonly unknown[] {
  return lookupCss(className, useRnwind(), userStyle)
}
