import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'

/**
 * Inline `@import` resolution for the theme entry CSS.
 *
 * rnwind's scheme extractors (`extractThemeVars`, `extractSchemeAliases`,
 * `extractCustomVariantSchemes`) are plain text passes over the entry
 * CSS — they don't follow `@import`. Tailwind's own compiler DOES follow
 * imports, so utilities still compile, but a user who keeps their theme
 * in a separate file and points the entry at it:
 *
 * ```css
 * @import "@acme/ui/theme.css";  // global.css — the cssEntryFile
 * ```
 *
 * would hand the extractors a file with no `@theme` / `@variant` /
 * `@custom-variant` in sight → every scheme collapses to base and theme
 * switching dies. This module flattens those user imports first so the
 * extractors (and the compiler) see the real declarations.
 */

/** Matches a bare `@import "spec";` / `@import 'spec';` (no media/layer suffix). */
const CSS_IMPORT = /@import\s+(["'])([^"']+)\1\s*;/g

/**
 * Specs left untouched for the Tailwind compiler to resolve itself.
 * `tailwindcss` resolves to JS (not inlinable) and `rnwind/css` is the
 * framework preset — both are the compiler's job, not user theme files.
 */
const FRAMEWORK_SPECS = new Set(['tailwindcss', 'rnwind/css', 'rnwind'])

/**
 * Read `filePath` and replace each user `@import "<spec>";` whose spec
 * resolves (Node resolution, honouring `exports` maps and workspace
 * symlinks) to a readable `.css` file with that file's inlined +
 * recursively-resolved contents. Unresolvable specs, non-CSS targets,
 * and {@link FRAMEWORK_SPECS} are left as-is for the compiler.
 * @param filePath Absolute path of the CSS file being inlined.
 * @param seen Visited set guarding against import cycles.
 * @returns CSS text with user imports flattened in place.
 */
function inlineImports(filePath: string, seen: Set<string>): string {
  if (seen.has(filePath)) return ''
  seen.add(filePath)
  let css: string
  try {
    css = readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
  const request = createRequire(filePath)
  return css.replaceAll(CSS_IMPORT, (full: string, _quote: string, spec: string): string => {
    if (FRAMEWORK_SPECS.has(spec)) return full
    let resolved: string
    try {
      resolved = request.resolve(spec)
    } catch {
      return full
    }
    if (!resolved.endsWith('.css') || !existsSync(resolved)) return full
    return inlineImports(resolved, seen)
  })
}

/**
 * Flatten user `@import`s in a theme entry CSS file so rnwind's text-based
 * scheme extractors see the real `@theme` / `@variant` / `@custom-variant`
 * declarations even when the entry only re-exports them via `@import`.
 * @param entryFilePath Absolute path to the theme entry CSS (the cssEntryFile).
 * @returns Inlined CSS, or `''` when the entry can't be read.
 */
export function resolveThemeCss(entryFilePath: string): string {
  return inlineImports(entryFilePath, new Set<string>())
}
