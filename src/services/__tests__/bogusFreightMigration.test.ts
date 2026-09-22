import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readMigration = () => readFileSync(resolve(process.cwd(), 'supabase/migrations/073_purge_bogus_freight_lines.sql'), 'utf8')

describe('migration de limpeza de frete espúrio', () => {
  it('declara que o DELETE depende do Data status do AGENTS.md', () => {
    const sql = readMigration()
    expect(sql).toMatch(/Data status/i)
    expect(sql).toMatch(/AGENTS\.md/i)
  })

  it('só aplica o critério textual a linhas persistidas sem valor', () => {
    const sql = readMigration()
    expect(sql).toMatch(/amount\s+IS\s+NULL/i)
    expect(sql).not.toMatch(/length\s*\(\s*description\s*\)\s*>\s*50/i)
    expect(sql).not.toMatch(/\^4\[\\.\\s\]/i)
    expect(sql).not.toMatch(/\(carrier\|order\|goods\|container\|liability\)/i)
  })
})
