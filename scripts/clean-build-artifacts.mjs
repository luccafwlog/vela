import { existsSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function assertNoForbiddenArtifacts(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '.vite') throw new Error(`Diretório confidencial residual encontrado: ${fullPath}`)
      assertNoForbiddenArtifacts(fullPath)
    } else if (entry.isFile() && entry.name.endsWith('.map')) {
      throw new Error(`Arquivo .map residual encontrado no build: ${fullPath}`)
    }
  }
}

function removeForbiddenArtifacts(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '.vite') rmSync(fullPath, { recursive: true, force: true })
      else removeForbiddenArtifacts(fullPath)
    } else if (entry.isFile() && entry.name.endsWith('.map')) {
      rmSync(fullPath, { force: true })
    }
  }
}

export function cleanProductionArtifacts(outDir) {
  removeForbiddenArtifacts(outDir)
  assertNoForbiddenArtifacts(outDir)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outDir = resolve(process.cwd(), 'dist')
  try {
    cleanProductionArtifacts(outDir)
  } catch (error) {
    console.error(`[clean-build-artifacts] ${error.message}`)
    process.exitCode = 1
  }
}
