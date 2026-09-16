import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const temporaryDirectories: string[] = []

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

describe('size-limit script', () => {
  it('explica como corrigir uma execução sem build', () => {
    const directory = mkdtempSync(join(tmpdir(), 'vela-size-limit-'))
    temporaryDirectories.push(directory)

    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), 'scripts/check-size-limit.mjs')],
      { cwd: directory, encoding: 'utf8' },
    )

    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain('size-limit: página ausente para index.html')
  })
})
