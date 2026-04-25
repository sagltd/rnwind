/**
 * Minimal type shim for `@tailwindcss/node`. The upstream package exposes its
 * types only through package `exports`, which classical `moduleResolution:
 * 'node'` cannot resolve. We only depend on `compile()` so this keeps the
 * surface tight and ESLint-friendly.
 */
declare module '@tailwindcss/node' {
  /**
   * Result of `compile()` — a built CSS stringifier plus source metadata. Only
   * the subset rnwind consumes is typed here.
   */
  export interface TailwindCompiler {
    build: (candidates: string[]) => string
  }

  /**
   * Options accepted by `compile()`. The real type includes more fields (see
   * upstream `CompileOptions`), but rnwind only uses `base` + `onDependency`.
   */
  export interface TailwindCompileOptions {
    base: string
    onDependency: (path: string) => void
  }

  /**
   * Compile a Tailwind CSS source string into a function that can build
   * class-name CSS on demand.
   * @param css Theme CSS source.
   * @param options Compile options (resolution base + dependency sink).
   * @returns Promise resolving to the compiler.
   */
  export function compile(css: string, options: TailwindCompileOptions): Promise<TailwindCompiler>
}
