import { describe, expect, it } from 'bun:test'
import { detectTextTruncate, mayContainTextTruncate } from '../../../src/core/parser/text-truncate'

describe('detectTextTruncate', () => {
  it('maps `truncate` to single-line tail ellipsis', () => {
    expect(detectTextTruncate('truncate')).toEqual({ numberOfLines: 1, ellipsizeMode: 'tail' })
  })

  it('maps `text-ellipsis` to tail-only', () => {
    expect(detectTextTruncate('text-ellipsis')).toEqual({ ellipsizeMode: 'tail' })
  })

  it('maps `text-clip` to clip-only', () => {
    expect(detectTextTruncate('text-clip')).toEqual({ ellipsizeMode: 'clip' })
  })

  it('maps `line-clamp-none` to a zero reset', () => {
    expect(detectTextTruncate('line-clamp-none')).toEqual({ numberOfLines: 0 })
  })

  it('parses numeric line-clamp', () => {
    expect(detectTextTruncate('line-clamp-1')).toEqual({ numberOfLines: 1 })
    expect(detectTextTruncate('line-clamp-3')).toEqual({ numberOfLines: 3 })
    expect(detectTextTruncate('line-clamp-12')).toEqual({ numberOfLines: 12 })
  })

  it('parses Tailwind v4 arbitrary line-clamp-[N]', () => {
    expect(detectTextTruncate('line-clamp-[5]')).toEqual({ numberOfLines: 5 })
    expect(detectTextTruncate('line-clamp-[99]')).toEqual({ numberOfLines: 99 })
  })

  it('ignores non-numeric arbitrary line-clamp', () => {
    expect(detectTextTruncate('line-clamp-[var(--x)]')).toBeNull()
    expect(detectTextTruncate('line-clamp-[auto]')).toBeNull()
  })

  it('returns null for non-truncate atoms', () => {
    expect(detectTextTruncate('bg-red-500')).toBeNull()
    expect(detectTextTruncate('text-lg')).toBeNull()
    expect(detectTextTruncate('line-clamp-')).toBeNull()
    expect(detectTextTruncate('line-clamp-abc')).toBeNull()
    expect(detectTextTruncate('truncated')).toBeNull()
  })
})

describe('mayContainTextTruncate', () => {
  it('returns true when any atom matches', () => {
    expect(mayContainTextTruncate(['bg-red-500', 'truncate'])).toBe(true)
    expect(mayContainTextTruncate(['line-clamp-2'])).toBe(true)
    expect(mayContainTextTruncate(['line-clamp-none'])).toBe(true)
    expect(mayContainTextTruncate(['text-ellipsis'])).toBe(true)
    expect(mayContainTextTruncate(['text-clip'])).toBe(true)
  })

  it('returns false when no atom matches', () => {
    expect(mayContainTextTruncate([])).toBe(false)
    expect(mayContainTextTruncate(['bg-red-500', 'text-lg'])).toBe(false)
  })
})
