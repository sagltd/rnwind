/**
 * Dump the rewritten source + chunk that rnwind produces for the benchmark's
 * App.tsx so we can see EXACTLY what the runtime sees per render.
 */
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

const projectRoot = path.resolve(import.meta.dirname, '..', 'apps', 'rnwind')
const cssPath = path.resolve(projectRoot, 'global.css')
const targetPath = path.resolve(projectRoot, 'App.tsx')

const themeCss = readFileSync(cssPath, 'utf8')
const source = readFileSync(targetPath, 'utf8')

const tables = await buildThemeTables(themeCss)
const atomRegistry = createAtomRegistry({ tables, themeCss })
const chunkRegistry = createChunkRegistry()
const fileChunkMap = createFileChunkMap()
const atomUsageMap = createAtomUsageMap()

const result = await transformFile({
  filename: targetPath,
  source,
  atomRegistry,
  chunkRegistry,
  fileChunkMap,
  atomUsageMap,
})

const divider = '─'.repeat(72)
console.log(`\n${divider}\n● rewritten App.tsx\n${divider}`)
console.log(result.code)

for (const [index, chunk] of result.chunks.entries()) {
  console.log(`\n${divider}\n● chunk ${index + 1}/${result.chunks.length} · id=${chunk.id}\n${divider}`)
  console.log(chunk.code)
}

console.log(`\n${divider}\n● theme schemes: ${JSON.stringify(atomRegistry.themeSchemes)}\n${divider}`)
