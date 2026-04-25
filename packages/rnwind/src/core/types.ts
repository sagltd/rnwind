/**
 * Resolved values for every CSS custom property in one theme scheme.
 * Keys are the raw custom-property names (e.g. `--color-primary`) as they
 * appear in the theme CSS. Values are the string / number primitives the
 * parser emits after Tailwind compile + lightningcss walk.
 */
export type ThemeTable = Record<string, string | number>

/**
 * Map from scheme name to its resolved {@link ThemeTable}. The scheme name
 * matches the identifier the user declared in `@variant <name> { ... }` —
 * `'light'`, `'dark'`, `'brand'`, etc. A synthetic `'base'` key carries
 * tokens declared outside any variant block.
 */
export type ThemeTables = Record<string, ThemeTable>
