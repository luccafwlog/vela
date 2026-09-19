import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const removedFunctionName = ['notify', 'invoice', 'issued'].join('-')
const ignoredPaths = [
  'docs/archive/',
  'docs/adr/',
  'supabase/migrations_archive/',
]
const inspectableExtensions = new Set(['.csv', '.md', '.sql', '.toml', '.ts', '.tsx', '.xlsx'])

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } })
    .split('\0')
    .filter((file) => file && inspectableExtensions.has(file.slice(file.lastIndexOf('.'))))
    .filter((file) => !ignoredPaths.some((prefix) => file === prefix || file.startsWith(prefix)))
}

describe('referências do canal de comunicação removido', () => {
  it('não deixa referências ativas à Edge Function excluída', () => {
    const references = trackedFiles().filter((file) => readFileSync(file).includes(removedFunctionName))

    expect(references).toEqual([])
  })
})
