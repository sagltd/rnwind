import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { GradientAtomInfo, HapticRequest, KeyframeBlock, SchemedStyle, TailwindParser } from '../parser'
import { buildSchemeSources, type AtomSerializedCache } from './build-style'

/** Manifest module basename — the file SchemeProvider imports via the resolver. */
const MANIFEST_BASENAME = 'schemes.js'

/**
 * Atomic file write — stage to a `.tmp.<pid>.<nonce>` sibling, then
 * `rename()` into place. Skips the write entirely when the existing
 * content matches.
 * @param target Final destination path.
 * @param content Bytes to write.
 * @returns Whether the file was actually rewritten.
 */
function writeIfChanged(target: string, content: string): boolean {
  if (existsSync(target)) {
    try {
      if (readFileSync(target, 'utf8') === content) return false
    } catch {
      // Unreadable — fall through to rewrite.
    }
  }
  mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    writeFileSync(temporary, content, 'utf8')
    renameSync(temporary, target)
    return true
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

/**
 * SHA-256 prefix of a string — cheap signature used to detect whether a
 * per-scheme file's source has changed since the last write.
 * @param text Input text.
 * @returns 16-char hex digest.
 */
function signatureOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/**
 * Compare two `Set<string>`s for equality — same size + every element
 * of `a` present in `b`.
 * @param a First set.
 * @param b Second set.
 * @returns Whether the two sets contain identical values.
 */
function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}

/**
 * Compute the absolute path of a per-scheme style file under the cache dir.
 * @param cacheDir Absolute cache directory.
 * @param scheme Registry key (`'common'` or a variant name).
 * @returns Absolute path, e.g. `<cacheDir>/dark.style.js`.
 */
function schemeFilePath(cacheDir: string, scheme: string): string {
  return path.join(cacheDir, `${scheme}.style.js`)
}

/**
 * In-memory atom union + per-scheme style-file emitter.
 *
 * Correctness under multi-worker Metro relies on `ensureProjectScanned`:
 * the FIRST `recordFile` / `writeSchemes` call in every worker drives
 * the oxide Scanner across ALL project sources and hydrates the union
 * with the complete set of candidates. Subsequent per-file
 * `recordFile` calls only layer in atoms the scan already knew about,
 * so writes are idempotent — different workers can't clobber each
 * other's scheme files with partial views.
 *
 * Per-file deltas (atom set unchanged → early return) skip
 * serialization entirely. On a theme-CSS change, `getRnwindState`
 * builds a fresh parser + builder; the next call re-runs
 * `ensureProjectScanned` against the new parser, producing scheme
 * files with the new theme values.
 */
class UnionBuilder {
  private readonly cacheDir: string
  private readonly parser: TailwindParser
  private readonly unionAtoms = new Map<string, SchemedStyle>()
  private readonly unionKeyframes = new Map<string, KeyframeBlock>()
  /** atom name → gradient role/colour, surfaced into the manifest's `registerGradients`. */
  private readonly unionGradients = new Map<string, GradientAtomInfo>()
  /** atom name → haptic request, surfaced into the manifest's `registerHaptics`. */
  private readonly unionHaptics = new Map<string, HapticRequest>()
  /**
   * Distinct literal className strings seen across all files, pre-merged
   * into per-scheme molecules at write time. Accumulate-only (like
   * `unionAtoms`): orphaned literals just yield unused molecules and get
   * reaped on the next cold start, so no refcount is needed.
   */
  private readonly unionLiterals = new Set<string>()
  /**
   * Responsive breakpoints captured from the parser. Refreshed on every
   * `recordFile` / `ensureProjectScanned` so user-defined
   * `--breakpoint-*` overrides land in the manifest the next time it's
   * written. Identical for every parser call within one parser instance
   * (theme is fixed for the parser's lifetime), so storing the latest
   * snapshot is sufficient.
   */
  private breakpoints: ReadonlyMap<string, number> = new Map()
  /** file → set of atom names this file currently contributes. */
  private readonly fileAtomSets = new Map<string, Set<string>>()
  /** atom name → how many files currently contribute it (refcount). */
  private readonly atomRefCount = new Map<string, number>()
  /** scheme → last-written source SHA. Skips re-writing unchanged schemes. */
  private readonly schemeSignatures = new Map<string, string>()
  /**
   * Per-atom serialized-value cache — identity-keyed on each atom's
   * SchemedStyle reference. Carried across `writeSchemes` calls so the
   * typical "user added one className" FR case re-stringifies ONE atom
   * instead of all 175+. Cleared on `ensureProjectScanned` (full
   * rescan replaces every reference) and individually invalidated for
   * any atom `applyDiff` mutates.
   */
  private readonly serializedCache: AtomSerializedCache = new Map()
  /** Running count of stringify passes (cache misses). Test telemetry. */
  private serializedMissesCount = 0
  /** Set after `ensureProjectScanned` completes. */
  private projectScanned = false
  /** Promise guard so concurrent first-calls await ONE scan. */
  private pendingScan: Promise<void> | null = null

  constructor(cacheDir: string, parser: TailwindParser) {
    this.cacheDir = cacheDir
    this.parser = parser
    mkdirSync(this.cacheDir, { recursive: true })
  }

  /** Absolute path of the manifest module (`rnwind/__generated/schemes`). */
  public get manifestPath(): string {
    return path.join(this.cacheDir, MANIFEST_BASENAME)
  }

  /** Cumulative cache-miss count — exposed for tests to assert cache behaviour. */
  public get serializedMisses(): number {
    return this.serializedMissesCount
  }

  /**
   * Absolute path of one scheme's style file.
   * @param scheme Registry key.
   * @returns Absolute path.
   */
  public schemePath(scheme: string): string {
    return schemeFilePath(this.cacheDir, scheme)
  }

  /**
   * One-shot oxide scan + compile across every source the parser was
   * configured with. Idempotent — safe to call from any entry point.
   * Concurrent callers share the same in-flight promise.
   */
  public async ensureProjectScanned(): Promise<void> {
    if (this.projectScanned) return
    if (this.pendingScan) return this.pendingScan
    this.pendingScan = (async () => {
      const parsed = await this.parser.parseProject()
      for (const [name, style] of parsed.atoms) this.unionAtoms.set(name, style)
      for (const [name, kf] of parsed.keyframes) this.unionKeyframes.set(name, kf)
      for (const [name, gradient] of parsed.gradientAtoms) this.unionGradients.set(name, gradient)
      for (const [name, haptic] of parsed.hapticAtoms) this.unionHaptics.set(name, haptic)
      this.breakpoints = parsed.breakpoints
      this.projectScanned = true
    })()
    try {
      await this.pendingScan
    } finally {
      this.pendingScan = null
    }
  }

  /**
   * Record one source file's resolved atoms + keyframes. Short-circuits
   * when the file's atom name set hasn't changed — the common case on
   * every Fast Refresh save of a file whose className literals are
   * unchanged.
   * @param file Absolute source file path.
   * @param atoms Per-atom resolved schemed styles from this transform.
   * @param keyframes Keyframe blocks referenced by this file's atoms.
   * @param literals
   * @returns `{ changed: true }` when the union shifted (new atom name,
   *   removed atom name, or new keyframe) — the transformer uses this
   *   to skip the serializer + `writeSchemes` when nothing changed.
   */
  public async recordFile(
    file: string,
    atoms: ReadonlyMap<string, SchemedStyle>,
    keyframes: ReadonlyMap<string, KeyframeBlock>,
    literals: readonly string[] = [],
  ): Promise<{ changed: boolean }> {
    await this.ensureProjectScanned()
    const literalAdded = this.recordLiterals(literals)
    const newAtomNames = new Set(atoms.keys())
    const previous = this.fileAtomSets.get(file)
    if (previous && setsEqual(previous, newAtomNames)) {
      // Atom set unchanged — skip the unionAtoms update entirely. The
      // project scan already populated them, and re-setting a fresh
      // object ref here would invalidate the per-atom serialization
      // cache on every FR save for no gain (values are identical).
      // Theme edits go through `getRnwindState` → new builder → fresh
      // scan, so stale cache is impossible.
      let keyframeAdded = false
      for (const [name, kf] of keyframes) {
        if (!this.unionKeyframes.has(name)) keyframeAdded = true
        this.unionKeyframes.set(name, kf)
      }
      return { changed: keyframeAdded || literalAdded }
    }
    this.applyDiff(file, newAtomNames, atoms, keyframes)
    return { changed: true }
  }

  /**
   * Merge a file's literal classNames into the union. A literal the
   * union hasn't seen flips `changed` so `writeSchemes` re-emits the
   * scheme files with the new molecule.
   * @param literals Distinct literal className strings.
   * @returns Whether any literal was new to the union.
   */
  private recordLiterals(literals: readonly string[]): boolean {
    let added = false
    for (const literal of literals) {
      if (this.unionLiterals.has(literal)) continue
      this.unionLiterals.add(literal)
      added = true
    }
    return added
  }

  /**
   * Forget one source file's contribution. Idempotent — repeated calls
   * for a file that's already dropped are no-ops. Does NOT remove the
   * atom from the union when another file (or the project scan) still
   * references it.
   * @param file Absolute source file path.
   */
  public dropFile(file: string): void {
    const previous = this.fileAtomSets.get(file)
    if (!previous) return
    for (const name of previous) {
      const count = (this.atomRefCount.get(name) ?? 0) - 1
      if (count <= 0) this.atomRefCount.delete(name)
      else this.atomRefCount.set(name, count)
    }
    this.fileAtomSets.delete(file)
  }

  /**
   * Serialize the union into per-scheme files + manifest, writing only
   * files whose source bytes changed. Called after every `recordFile`
   * from the transformer — and once at Metro startup via
   * `ensureFilesExist` to seed disk from the project scan alone.
   * @returns List of scheme keys whose files were rewritten (empty
   *   when the union is byte-identical to the last flush).
   */
  public async writeSchemes(): Promise<{ changedSchemes: readonly string[] }> {
    await this.ensureProjectScanned()
    const sortedAtomNames = [...this.unionAtoms.keys()].toSorted((a, b) => a.localeCompare(b))
    const result = buildSchemeSources(sortedAtomNames, this.unionAtoms, this.unionKeyframes, this.serializedCache, this.breakpoints, this.unionGradients, this.unionHaptics, [...this.unionLiterals])
    this.serializedMissesCount += result.serializedMisses
    const { schemeSources, manifestSource } = result

    const changed: string[] = []
    for (const [scheme, source] of Object.entries(schemeSources)) {
      const signature = signatureOf(source)
      const target = schemeFilePath(this.cacheDir, scheme)
      if (this.schemeSignatures.get(scheme) === signature && existsSync(target)) continue
      if (writeIfChanged(target, source)) changed.push(scheme)
      this.schemeSignatures.set(scheme, signature)
    }

    const manifestSignature = signatureOf(manifestSource)
    const manifestTarget = path.join(this.cacheDir, MANIFEST_BASENAME)
    if (this.schemeSignatures.get('__manifest') !== manifestSignature || !existsSync(manifestTarget)) {
      if (writeIfChanged(manifestTarget, manifestSource)) changed.push('__manifest')
      this.schemeSignatures.set('__manifest', manifestSignature)
    }

    return { changedSchemes: changed }
  }

  /**
   * Ensure the manifest + common scheme files exist on disk so Metro's
   * resolver can SHA1 them at boot before the first transform runs.
   */
  public async ensureFilesExist(): Promise<void> {
    if (existsSync(this.manifestPath) && existsSync(schemeFilePath(this.cacheDir, 'common'))) {
      // Still trigger the scan so the in-memory union is complete; file
      // bytes may already be authoritative from a prior Metro run.
      await this.ensureProjectScanned()
      return
    }
    await this.writeSchemes()
  }

  /**
   * Apply one file's atom-name diff to the in-memory refcount + union.
   * @param file Source file path.
   * @param newAtoms New atom-name set for the file.
   * @param resolvedAtoms Fresh parser output — carries the resolved
   *   styles for every entry in `newAtoms`.
   * @param newKeyframes Keyframes this file's atoms reference.
   */
  private applyDiff(
    file: string,
    newAtoms: ReadonlySet<string>,
    resolvedAtoms: ReadonlyMap<string, SchemedStyle>,
    newKeyframes: ReadonlyMap<string, KeyframeBlock>,
  ): void {
    const previous = this.fileAtomSets.get(file) ?? new Set<string>()
    for (const name of previous) {
      if (newAtoms.has(name)) continue
      const count = (this.atomRefCount.get(name) ?? 0) - 1
      if (count <= 0) this.atomRefCount.delete(name)
      else this.atomRefCount.set(name, count)
      // Do NOT remove `name` from `unionAtoms` — the project scan still
      // references it (orphaned atoms get reaped on the next Metro
      // cold start when the scanner re-walks disk).
    }
    for (const name of newAtoms) {
      if (!previous.has(name)) this.atomRefCount.set(name, (this.atomRefCount.get(name) ?? 0) + 1)
      // Only install the resolved style when the atom is new to the
      // union. Replacing an existing entry with a fresh parser-
      // produced object would swap the identity guard the per-atom
      // serialization cache uses and force a re-stringify for every
      // atom on every FR save. CSS edits rebuild the whole builder
      // (via `getRnwindState`) so stale values aren't possible.
      if (!this.unionAtoms.has(name)) {
        const style = resolvedAtoms.get(name)
        if (style) this.unionAtoms.set(name, style)
      }
    }
    this.fileAtomSets.set(file, new Set(newAtoms))
    for (const [name, kf] of newKeyframes) this.unionKeyframes.set(name, kf)
  }
}

export { UnionBuilder }
