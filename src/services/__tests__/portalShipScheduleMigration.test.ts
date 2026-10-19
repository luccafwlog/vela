import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

it('define portal_ship_schedule como definer, aberta a anon até a migration 320', () => {
  const dir = path.resolve(process.cwd(), 'supabase/migrations')
  const sql = fs.readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => fs.readFileSync(path.join(dir, file), 'utf8'))
    .join('\n')

  expect(sql).toMatch(/CREATE OR REPLACE FUNCTION\s+public\.portal_ship_schedule/i)
  expect(sql).toMatch(/SECURITY DEFINER/i)
  expect(sql).toMatch(/SET search_path = public, pg_temp/i)
  expect(sql).toMatch(/show_on_portal/i)
  expect(sql).toMatch(/actual_value/i)
  expect(sql).toMatch(/status\s*=\s*'active'/i)
  expect(sql).toMatch(/REVOKE\s+ALL[\s\S]*portal_ship_schedule[\s\S]*FROM\s+PUBLIC/i)
  expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.portal_ship_schedule[\s\S]*TO\s+anon/i)
  // ADR 0090: o Portal só chama com sessão; a 320 fecha anon e mantém authenticated.
  expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.portal_ship_schedule\(\) FROM PUBLIC, anon;/)
  expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.portal_ship_schedule\(\) TO authenticated, service_role;/)
})
