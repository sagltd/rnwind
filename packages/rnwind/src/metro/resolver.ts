import { manifestPathFor } from './state'

/** Specifier the transformer prepends — resolves to the scheme manifest. */
const SCHEMES_MODULE = 'rnwind/__generated/schemes'

/** Metro `resolveRequest` callable shape. Loose so we don't bind to Metro's internal types. */
export type ResolveRequestFn = (context: unknown, moduleName: string, platform: string | null) => unknown

/**
 * Sentinel module specifier the transformer prepends to every rewritten
 * file. The resolver maps it to the user's theme CSS so Metro watches
 * that file as a real node in the dependency graph — when the user
 * edits `global.css`, the CSS file's SHA1 changes, and Metro
 * invalidates every JS file that imports the sentinel. The transformer
 * recognises `.css` filenames and returns an empty `export {}` AST so
 * Metro can still bundle it.
 */
export const THEME_SIGNATURE_MODULE = 'rnwind/__generated/theme-signature'

/**
 * Build a Metro `resolveRequest` hook that maps the scheme manifest
 * specifier (and the theme-signature sentinel) to its on-disk path.
 * Delegates every other request to the upstream resolver.
 * @param upstream Previously-registered `resolveRequest` (kept in the chain).
 * @returns Metro-compatible resolver.
 */
export function createRnwindResolver(upstream: ResolveRequestFn | null | undefined): ResolveRequestFn {
  return (context, moduleName, platform) => {
    if (moduleName === SCHEMES_MODULE) return { type: 'sourceFile', filePath: manifestPathFor() }
    if (moduleName === THEME_SIGNATURE_MODULE) {
      const cssPath = process.env.RNWIND_CSS_ENTRY_FILE
      if (cssPath) return { type: 'sourceFile', filePath: cssPath }
    }
    if (upstream) return upstream(context, moduleName, platform)
    const { resolveRequest } = context as { resolveRequest?: ResolveRequestFn }
    if (resolveRequest) return resolveRequest(context, moduleName, platform)
    return null as unknown
  }
}

/** Side-effect import specifier(s) the transformer injects on every rewritten file. */
export const STYLE_SPECIFIERS = [SCHEMES_MODULE] as const
