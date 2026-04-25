# CLAUDE.md

Guidance for Claude Code working in this repo.

## What rnwind does

Tailwind v4 for React Native, zero runtime cost. A Metro transformer scans each source file, compiles its `className="…"` utilities through `@tailwindcss/oxide` + `@tailwindcss/node`, rewrites the JSX to `style={[…]}`, and emits a per-file `StyleSheet.create` map. Shared atoms dedupe across files, modern color spaces (`oklch`, `color-mix`, `display-p3`) are normalised to sRGB via `culori`, optional animated / safe-area / haptics utilities light up when their peer deps are installed.

## Tooling — Bun only

Everything runs through Bun: `bun install`, `bun run build`, `bun test`, `bun run typecheck`, `bun run --cwd packages/rnwind lint`, `bun run --cwd packages/rnwind code-check`. No npm / yarn / pnpm / node. If Bun has an equivalent, use it.

## How we write code

### Discovery first — never create before searching

Before writing any new function, type, hook, or component: `grep` for the name, the purpose, and similar patterns. Decide **reuse → extend → compose → create** in that order. If existing code is ≥70% of what you need, extend it (add a param/option) instead of duplicating.

### File layout — helpers on top, exports at the bottom

Non-exported helpers, private constants, and internal types come first. Exported types and functions live at the end of the file so the reader sees the public surface last. See `src/metro/transformer.ts` for the canonical shape: private `rewriteSource`, `injectThemeSignatureImport`, `loadUpstream` first; exported `transform`, `getCacheKey` last.

### Guard clauses over nesting

Early-return on invalid state, error cases, and preconditions. No pyramid `if`s — flat is scannable.

### Names are explicit

No abbreviations outside this allow-list: `idx`, `doc`, `props`, `param`, `params`, `ref`, `db`, `cb`, `ctx`, `args`, `vars`, `env`, `class`. Booleans carry a verb prefix: `isActive`, `hasTheme`, `canMutate`.

### Small modules

200-line soft limit per file. Over that → split by responsibility (helpers, types, sub-modules).

### Rule of three

First use: inline. Second: note it. Third: extract.

### Comments are for *why*, not *what*

JSDoc is required on every export (enforced by `eslint-plugin-jsdoc`). Inline comments explain non-obvious motivation, invariants, or gotchas — not what the next line already says.

### Formatter / linter settings

Prettier: no semicolons, single quotes, trailing commas, 130-char width. ESLint flat config with React Hooks, Unicorn, SonarJS, JSDoc rules.

### Testing

`bun:test` with Happy DOM preloaded via `bunfig.toml`. Tests live in `packages/rnwind/__tests__/*.test.ts(x)`. Prefer inline typed fixture arrays (`Fixture[]` in a `.ts` file) over `.txt` + `.expected.json` pairs.

### Caching

Rely on Metro's own transform cache + dep-graph invalidation — don't reimplement it. rnwind only keeps the process-scoped class→style + chunk-dedup state.

### Git

The user drives git. Never run `git commit`, `git push`, `git add`, `git checkout`, `git merge`, `git rebase`, `git stash`. Read-only (`git status`, `diff`, `log`, `branch`) is fine.

## Verification gate

Before claiming a change is done: `bun run --cwd packages/rnwind code-check` (typecheck → lint → test) must pass.
