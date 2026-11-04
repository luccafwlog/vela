import { execPsql } from './localPsql'
import { describe, expect, it } from 'vitest'

// Migration 585: TRUNCATE em public só na sessão que confirmou banco
// descartável. Incidente de origem: docs/archive/reports/2026-11-04-tentativas-de-truncate-em-producao.md.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function localPsql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

const attempt = (sql: string) => {
  try {
    return localPsql(`BEGIN; ${sql}; ROLLBACK;`)
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? error)
  }
}

// O mesmo formato do bloco "LIMPA TUDO" de 2026-11-03, sem app_settings na
// lista: prova que a recusa não depende mais do gatilho da 156.
const limpaTudoSemAppSettings = `DO $$
DECLARE v_tables text;
BEGIN
  SELECT string_agg(quote_ident(schemaname) || '.' || quote_ident(tablename), ', ') INTO v_tables
  FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('app_settings', 'user_profiles');
  EXECUTE 'TRUNCATE TABLE ' || v_tables || ' RESTART IDENTITY CASCADE';
END $$`

describeLocal('migration 585 — TRUNCATE só com a confirmação de banco descartável', () => {
  it('toda tabela de public tem a trava, menos app_settings, que tem a da 156', () => {
    const missing = localPsql(`
      SELECT coalesce(string_agg(c.relname, ', ' ORDER BY c.relname), '')
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
        AND c.relname <> 'app_settings'
        AND NOT EXISTS (
          SELECT 1 FROM pg_trigger t
          WHERE t.tgrelid = c.oid AND t.tgname = 'truncate_requires_confirmation' AND t.tgenabled = 'O'
        )`)
    // Tabela nova em public: crie o gatilho na mesma migration, como na 585.
    expect(missing).toBe('')
  })

  it('recusa o TRUNCATE direto, em cascata e o formato do LIMPA TUDO, sem apagar nada', () => {
    const before = localPsql('SELECT (SELECT count(*) FROM public.customers) || \'|\' || (SELECT count(*) FROM public.audit_logs)')
    expect(attempt('TRUNCATE public.audit_logs')).toMatch(/TRUNCATE recusado em public\.audit_logs: produção tem dados reais/)
    expect(attempt('TRUNCATE public.customers RESTART IDENTITY CASCADE')).toMatch(/TRUNCATE recusado em public\.\w+: produção tem dados reais/)
    expect(attempt(limpaTudoSemAppSettings)).toMatch(/TRUNCATE recusado em public\.\w+/)
    expect(localPsql('SELECT (SELECT count(*) FROM public.customers) || \'|\' || (SELECT count(*) FROM public.audit_logs)')).toBe(before)
  })

  it('a recusa explica como confirmar o banco descartável', () => {
    expect(attempt('TRUNCATE public.bls CASCADE')).toMatch(/SET vela\.limpeza_banco_descartavel = 'confirmo'/)
  })

  it('com a confirmação na sessão, o TRUNCATE passa; app_settings continua recusado', () => {
    expect(localPsql(`BEGIN;
      SET LOCAL vela.limpeza_banco_descartavel = 'confirmo';
      TRUNCATE public.audit_logs;
      SELECT count(*) FROM public.audit_logs;
      ROLLBACK;`)).toBe('0')
    expect(attempt(`SET LOCAL vela.limpeza_banco_descartavel = 'confirmo'; TRUNCATE public.app_settings`))
      .toMatch(/não pode ser apagada \(TRUNCATE\)/)
  })

  it('confirmação com outro valor não vale', () => {
    expect(attempt(`SET LOCAL vela.limpeza_banco_descartavel = 'sim'; TRUNCATE public.audit_logs`))
      .toMatch(/TRUNCATE recusado em public\.audit_logs/)
  })
})
