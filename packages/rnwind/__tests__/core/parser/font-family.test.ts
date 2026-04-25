import { describe, expect, it } from 'bun:test'
import { TailwindParser } from '../../../src/core/parser'

/**
 * Regression: theme-declared font tokens carry their CSS quote
 * characters all the way to the runtime style, so RN ends up looking
 * for a typeface literally named `'SFMono-Regular'` (with quotes) and
 * silently falls back to the system font. The user reported tabular
 * mono numbers rendering in the wrong typeface even though the atom
 * was clearly resolving — see /Users' mobile-expanse mono-number.tsx.
 *
 * Theme:
 * ```css
 * @theme {
 *   --font-sans: 'Inter-Medium';
 *   --font-mono: "ui-monospace";
 *   --font-mono-num: 'SFMono-Regular';
 * }
 * ```
 *
 * Tailwind compiles `font-mono-num` to `font-family: var(--font-mono-num);`
 * which goes through rnwind's unparsed-substitution path. The substitution
 * pulls the raw value text from `:root` — quotes included — so without
 * an explicit unquote step the RN style ends up as
 * `{ fontFamily: "'SFMono-Regular'" }` and RN can't match the registered
 * font. The unquote step strips matched outer `'…'` / `"…"` once.
 */
describe('font-family — theme tokens with CSS quoted strings', () => {
  const themeCss = `
    @import 'tailwindcss';
    @theme {
      --font-sans: 'Inter-Medium';
      --font-mono: "ui-monospace";
      --font-mono-num: 'SFMono-Regular';
    }
  `

  it('font-sans resolves to the bare typeface name (no surrounding quotes)', async () => {
    const parser = new TailwindParser({ themeCss })
    const result = await parser.parseAtoms({
      content: `export default () => <V className="font-sans" />`,
      extension: 'tsx',
    })
    const atom = result.atoms.get('font-sans')?.base as Record<string, unknown> | undefined
    expect(atom?.fontFamily).toBe('Inter-Medium')
  })

  it('font-mono resolves to the bare typeface name (double-quoted CSS source)', async () => {
    const parser = new TailwindParser({ themeCss })
    const result = await parser.parseAtoms({
      content: `export default () => <V className="font-mono" />`,
      extension: 'tsx',
    })
    const atom = result.atoms.get('font-mono')?.base as Record<string, unknown> | undefined
    expect(atom?.fontFamily).toBe('ui-monospace')
  })

  it('font-mono-num (custom token) resolves to the bare typeface name', async () => {
    const parser = new TailwindParser({ themeCss })
    const result = await parser.parseAtoms({
      content: `export default () => <V className="font-mono-num" />`,
      extension: 'tsx',
    })
    const atom = result.atoms.get('font-mono-num')?.base as Record<string, unknown> | undefined
    expect(atom?.fontFamily).toBe('SFMono-Regular')
    // Strict guard against the regression: literal quote chars must NOT
    // appear in the resolved font family.
    expect(atom?.fontFamily as string).not.toContain("'")
    expect(atom?.fontFamily as string).not.toContain('"')
  })
})
