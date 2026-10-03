import { join } from 'node:path'
import { expect, it, vi } from 'vitest'

it('mantém uma única migration por versão aplicada pelo Supabase', async () => {
  // O mock legado soma migrations_archive; somente o diretório ativo é aplicado.
  const { readdirSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
  const versions = new Map<string, string[]>()
  for (const file of readdirSync(join(process.cwd(), 'supabase/migrations')).filter((name) => name.endsWith('.sql'))) {
    const version = file.match(/^(\d+)_/)?.[1]
    expect(version, `Nome de migration inválido: ${file}`).toBeDefined()
    versions.set(version!, [...(versions.get(version!) ?? []), file])
  }
  expect([...versions.values()].filter((files) => files.length > 1)).toEqual([])
})
