import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')

async function readLatestProvisioningConsoleDefinition(): Promise<string> {
  const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
  const migrationSql = fs.readdirSync(migrationsDir)
    .filter((entry) => entry.endsWith('.sql'))
    .sort()
    .map((entry) => fs.readFileSync(join(migrationsDir, entry), 'utf8'))
    .join('\n')
  const definitionStart = migrationSql.lastIndexOf(
    'CREATE OR REPLACE FUNCTION public.portal_list_provisioning_console',
  )
  expect(definitionStart, 'RPC portal_list_provisioning_console com definição substituta').toBeGreaterThanOrEqual(0)
  return migrationSql.slice(definitionStart)
}

describe('candidatos de recuperação do Portal', () => {
  it('considera contatos ativos do modelo de caixas mesmo sem o purpose legado', async () => {
    const sql = await readLatestProvisioningConsoleDefinition()

    expect(sql).toMatch(/'candidates'[\s\S]*COALESCE\(cc\.purpose,\s*'geral'\)/i)
    expect(sql).toMatch(/FROM public\.customer_contacts cc[\s\S]*cc\.deactivated_at IS NULL/i)
    expect(sql).toMatch(/cc\.email_normalized IS NOT NULL/i)
  })
})
