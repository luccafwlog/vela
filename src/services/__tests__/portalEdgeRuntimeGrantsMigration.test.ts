import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('grants de runtime das Edge Functions do Portal', () => {
  const migration = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/101_portal_edge_runtime_table_grants.sql'),
    'utf8',
  )

  it('concede ao service_role apenas as operacoes diretas usadas pelo runtime', () => {
    expect(migration).toMatch(/GRANT SELECT, UPDATE ON TABLE public\.customer_portal_accounts TO service_role;/)
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE ON TABLE public\.portal_invites TO service_role;/)
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE ON TABLE public\.portal_email_attempts TO service_role;/)
    expect(migration).toMatch(/GRANT SELECT, INSERT ON TABLE public\.alerts TO service_role;/)
    expect(migration).toMatch(/GRANT USAGE, SELECT ON SEQUENCE[\s\S]*public\.portal_invites_id_seq,[\s\S]*public\.portal_email_attempts_id_seq,[\s\S]*public\.alerts_id_seq[\s\S]*TO service_role;/)
    expect(migration).not.toMatch(/TO (?:PUBLIC|anon|authenticated)\b/)
  })
})
