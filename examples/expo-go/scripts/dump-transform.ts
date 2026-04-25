import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  buildThemeTables,
  createAtomRegistry,
  createAtomUsageMap,
  createChunkRegistry,
  createFileChunkMap,
  transformFile,
} from 'rnwind/metro'

const projectRoot = path.resolve(import.meta.dirname, '..')
const cssPath = path.resolve(projectRoot, 'global.css')
const targetArgument = process.argv[2] ?? 'app/animations.tsx'
const targetPath = path.resolve(projectRoot, targetArgument)

const themeCss = readFileSync(cssPath, 'utf8')
const source = readFileSync(targetPath, 'utf8')

const tables = await buildThemeTables(themeCss)
const atomRegistry = createAtomRegistry({ tables, themeCss })
const atomUsageMap = createAtomUsageMap()
const chunkRegistry = createChunkRegistry()
const fileChunkMap = createFileChunkMap()
const themeHash = createHash('sha256').update(themeCss).digest('hex').slice(0, 16)

const result = await transformFile({
  filename: targetPath,
  source,
  atomRegistry,
  atomUsageMap,
  chunkRegistry,
  fileChunkMap,
  themeHash,
})

const divider = '─'.repeat(72)

if (result.errors.length > 0) {
  console.error(`\n${divider}\n✗ errors\n${divider}`)
  for (const error of result.errors) {
    console.error(`  [${error.code}] ${error.message}`)
  }
}

console.log(`\n${divider}\n● input: ${path.relative(projectRoot, targetPath)}\n${divider}`)
console.log(source)

console.log(`\n${divider}\n● rewritten source (AST-inlined stylesheet + token array)\n${divider}`)
console.log(result.code)

for (const [index, chunk] of result.chunks.entries()) {
  console.log(`\n${divider}\n● chunk ${index + 1}/${result.chunks.length} · id=${chunk.id}\n${divider}`)
  console.log(chunk.code)
}

console.log(`\n${divider}\n● summary\n${divider}`)
console.log(`chunks:  ${result.chunks.length}`)
console.log(`errors:  ${result.errors.length}`)
console.log(`atoms:   ${atomRegistry.size}`)
