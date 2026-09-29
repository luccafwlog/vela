import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/104_restore_app_settings_singleton.sql'),
  'utf8',
)

function localPsql(sql: string): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', sql,
  ], { encoding: 'utf8' }).trim()
}

describeLocal('migration 104 — reparo do singleton app_settings', () => {
  it('restaura a linha ausente dentro de uma transação descartável', () => {
    const result = localPsql(`
      BEGIN;
      DELETE FROM public.app_settings WHERE id = 1;
      ${migration}
      SELECT concat_ws('|', id::text, communications_enabled::text, demurrage_dunning_interval_days::text)
      FROM public.app_settings
      WHERE id = 1;
      ROLLBACK;
    `)

    expect(result).toBe('1|false|7')
  })

  it('preserva configuração existente', () => {
    const result = localPsql(`
      BEGIN;
      UPDATE public.app_settings
      SET communications_enabled = true, demurrage_dunning_interval_days = 9
      WHERE id = 1;
      ${migration}
      SELECT concat_ws('|', id::text, communications_enabled::text, demurrage_dunning_interval_days::text)
      FROM public.app_settings
      WHERE id = 1;
      ROLLBACK;
    `)

    expect(result).toBe('1|true|9')
  })
})
