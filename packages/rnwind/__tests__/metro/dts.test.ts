import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { writeDtsFile } from '../../src/metro/dts'

let temporaryDir: string

beforeEach(() => {
  temporaryDir = mkdtempSync(path.join(tmpdir(), 'rnwind-dts-'))
})

afterEach(() => {
  rmSync(temporaryDir, { recursive: true, force: true })
})

describe('writeDtsFile', () => {
  it('writes react-native module augmentation with className?: string', () => {
    const destination = path.join(temporaryDir, 'rnwind-types.d.ts')
    writeDtsFile(destination, [])
    expect(existsSync(destination)).toBe(true)
    const text = readFileSync(destination, 'utf8')
    expect(text).toContain(`declare module 'react-native' {`)
    expect(text).toMatch(/interface ViewProps \{[^}]*className\?: string/)
    expect(text).toMatch(/interface TextProps \{[^}]*className\?: string/)
  })

  it('declares the RnwindConfig themes list when schemes are provided', () => {
    const destination = path.join(temporaryDir, 'rnwind-types.d.ts')
    writeDtsFile(destination, ['light', 'dark', 'brand'])
    const text = readFileSync(destination, 'utf8')
    expect(text).toContain(`themes: readonly ['light', 'dark', 'brand']`)
  })

  it('omits the rnwind-module block when there are no schemes', () => {
    const destination = path.join(temporaryDir, 'rnwind-types.d.ts')
    writeDtsFile(destination, [])
    const text = readFileSync(destination, 'utf8')
    expect(text).not.toContain(`declare module 'rnwind'`)
  })

  it('creates missing parent directories', () => {
    const destination = path.join(temporaryDir, 'nested', 'deep', 'types.d.ts')
    writeDtsFile(destination, [])
    expect(existsSync(destination)).toBe(true)
  })

  it('generic interfaces keep their type parameter', () => {
    const destination = path.join(temporaryDir, 'rnwind-types.d.ts')
    writeDtsFile(destination, [])
    const text = readFileSync(destination, 'utf8')
    expect(text).toMatch(/interface FlatListProps<ItemT> \{[^}]*className\?: string/)
    expect(text).toMatch(/interface VirtualizedListProps<ItemT> \{[^}]*className\?: string/)
  })

  it('emits `export {}` so TS treats the file as a module — `declare module` then augments instead of replacing', () => {
    // Without this, `declare module 'react-native' {…}` would be a full
    // replacement and consumers would see "Module 'react-native' has no
    // exported member 'Pressable'" etc.
    const destination = path.join(temporaryDir, 'rnwind-types.d.ts')
    writeDtsFile(destination, [])
    expect(readFileSync(destination, 'utf8')).toMatch(/^export\s*\{\s*\}\s*$/m)
  })

  it('emits contentContainerClassName only on ScrollView-family interfaces', () => {
    const destination = path.join(temporaryDir, 'rnwind-types.d.ts')
    writeDtsFile(destination, [])
    const text = readFileSync(destination, 'utf8')
    // Present on every interface that natively exposes contentContainerStyle.
    expect(text).toMatch(/interface ScrollViewProps \{[^}]*contentContainerClassName\?: string/)
    expect(text).toMatch(/interface FlatListProps<ItemT> \{[^}]*contentContainerClassName\?: string/)
    expect(text).toMatch(/interface SectionListProps \{[^}]*contentContainerClassName\?: string/)
    expect(text).toMatch(/interface VirtualizedListProps<ItemT> \{[^}]*contentContainerClassName\?: string/)
    // Absent on interfaces that do NOT expose contentContainerStyle — adding
    // it there would lie to TypeScript about what RN accepts.
    expect(text).toMatch(/interface ViewProps \{[^}]*className\?: string[^}]*\}/)
    expect(text).not.toMatch(/interface ViewProps \{[^}]*contentContainerClassName/)
    expect(text).not.toMatch(/interface TextProps \{[^}]*contentContainerClassName/)
    expect(text).not.toMatch(/interface PressableProps \{[^}]*contentContainerClassName/)
  })
})
