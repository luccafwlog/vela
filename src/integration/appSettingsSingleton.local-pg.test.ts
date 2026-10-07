import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const read = (file: string) => readFileSync(resolve(process.cwd(), 'supabase/migrations', file), 'utf8')

function localPsql(sql: string): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', sql,
  ], { encoding: 'utf8' }).trim()
}

describeLocal.each([
  ['104', read('104_restore_app_settings_singleton.sql')],
  ['155', read('155_restore_app_settings_singleton_again.sql')],
])('migration %s — reparo do singleton app_settings', (_version, migration) => {
  it('restaura a linha ausente dentro de uma transação descartável', () => {
    const result = localPsql(`
      BEGIN;
      -- Simula a linha ausente: o gatilho da 156 bloqueia DELETE.
      ALTER TABLE public.app_settings DISABLE TRIGGER app_settings_block_delete;
      DELETE FROM public.app_settings WHERE id = 1;
      ALTER TABLE public.app_settings ENABLE TRIGGER app_settings_block_delete;
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

  it('linha restaurada nasce com a integração Itaú desligada', () => {
    const result = localPsql(`
      BEGIN;
      -- Simula a linha ausente: o gatilho da 156 bloqueia DELETE.
      ALTER TABLE public.app_settings DISABLE TRIGGER app_settings_block_delete;
      DELETE FROM public.app_settings WHERE id = 1;
      ALTER TABLE public.app_settings ENABLE TRIGGER app_settings_block_delete;
      ${migration}
      SELECT concat_ws('|', pix_provider, itau_pix_expiration_seconds::text, coalesce(itau_pix_settlement_actor::text, 'sem-ator'))
      FROM public.app_settings
      WHERE id = 1;
      ROLLBACK;
    `)

    expect(result).toBe('static|2592000|sem-ator')
  })
})

describeLocal('migration 156 — singleton app_settings não pode ser apagado', () => {
  const attempt = (sql: string) => {
    try {
      return localPsql(`BEGIN; ${sql}; ROLLBACK;`)
    } catch (error) {
      return String((error as { stderr?: string }).stderr ?? error)
    }
  }

  it('recusa DELETE, TRUNCATE e TRUNCATE em cascata de user_profiles', () => {
    expect(attempt('DELETE FROM public.app_settings WHERE id = 1')).toMatch(/não pode ser apagada \(DELETE\)/)
    expect(attempt('TRUNCATE public.app_settings')).toMatch(/não pode ser apagada \(TRUNCATE\)/)
    expect(attempt('TRUNCATE public.user_profiles CASCADE')).toMatch(/não pode ser apagada \(TRUNCATE\)/)
    expect(localPsql('SELECT count(*) FROM public.app_settings WHERE id = 1')).toBe('1')
  })

  it('UPDATE continua permitido', () => {
    expect(localPsql(`BEGIN; UPDATE public.app_settings SET demurrage_dunning_interval_days = 9 WHERE id = 1;
      SELECT demurrage_dunning_interval_days FROM public.app_settings WHERE id = 1; ROLLBACK;`)).toBe('9')
  })
})
