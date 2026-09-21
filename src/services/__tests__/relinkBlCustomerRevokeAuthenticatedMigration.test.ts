import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readMigration = () =>
  readFileSync(resolve(process.cwd(), 'supabase/migrations/071_revoke_relink_bl_customer_authenticated.sql'), 'utf8')

describe('migration 071 — relink_bl_customer security remediation', () => {
  it('revoga EXECUTE em relink_bl_customer de authenticated, anon e PUBLIC, restringindo a service_role', () => {
    const sql = readMigration()

    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.relink_bl_customer\(text, bigint, uuid, text\)\s+FROM PUBLIC, anon, authenticated;/i)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.relink_bl_customer\(text, bigint, uuid, text\)\s+TO service_role;/i)
    expect(sql).not.toMatch(/GRANT\s+.*TO\s+.*authenticated/i)
  })
})
