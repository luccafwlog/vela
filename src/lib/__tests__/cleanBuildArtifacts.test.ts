import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — script de build em JS puro, sem tipos gerados.
import { assertNoForbiddenArtifacts, cleanProductionArtifacts } from '../../../scripts/clean-build-artifacts.mjs'

describe('limpeza dos artefatos confidenciais do build', () => {
  it('remove .vite e source maps, preservando os arquivos publicados', () => {
    const dist = mkdtempSync(join(tmpdir(), 'vela-build-test-'))
    try {
      const viteDir = join(dist, '.vite')
      const assetsDir = join(dist, 'assets')
      mkdirSync(viteDir)
      mkdirSync(assetsDir)
      writeFileSync(join(viteDir, 'manifest.json'), '{}')
      writeFileSync(join(assetsDir, 'app.js'), 'console.log("ok")')
      writeFileSync(join(assetsDir, 'app.js.map'), '{}')

      cleanProductionArtifacts(dist)

      expect(existsSync(viteDir)).toBe(false)
      expect(existsSync(join(assetsDir, 'app.js.map'))).toBe(false)
      expect(existsSync(join(assetsDir, 'app.js'))).toBe(true)
    } finally {
      rmSync(dist, { recursive: true, force: true })
    }
  })

  it('falha se um artefato proibido continuar na saída', () => {
    const dist = mkdtempSync(join(tmpdir(), 'vela-build-test-'))
    try {
      writeFileSync(join(dist, 'secret.js.map'), '{}')
      expect(() => assertNoForbiddenArtifacts(dist)).toThrow(/Arquivo \.map residual encontrado/)
    } finally {
      rmSync(dist, { recursive: true, force: true })
    }
  })

  it('executa a limpeza CLI no dist do cwd', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'vela-build-cli-test-'))
    try {
      const assetsDir = join(cwd, 'dist', 'assets')
      mkdirSync(assetsDir, { recursive: true })
      writeFileSync(join(assetsDir, 'app.js.map'), '{}')
      execFileSync(process.execPath, [resolve(process.cwd(), 'scripts/clean-build-artifacts.mjs')], { cwd })
      expect(existsSync(join(assetsDir, 'app.js.map'))).toBe(false)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
