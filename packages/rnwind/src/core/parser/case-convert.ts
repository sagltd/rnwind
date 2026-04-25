import { KEBAB_BOUNDARY_REGEX } from './constants'

/**
 * Kebab-case to camelCase — `border-radius` → `borderRadius`.
 * @param name Kebab-case CSS property name.
 * @returns camelCase RN key.
 */
export function kebabToCamel(name: string): string {
  return name.replaceAll(KEBAB_BOUNDARY_REGEX, (_, c: string) => c.toUpperCase())
}
