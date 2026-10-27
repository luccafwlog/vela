import { execPsql } from './localPsql'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Migration 466, seção 7 (ADR 0104): a marca Dev vai para a conta da lista de
// e-mails que existir no ambiente, fica no Histórico de ações com o motivo e
// rodar de novo não marca nem registra outra vez.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/466_marca_dev_e_chave_de_envio_pelo_suporte.sql'), 'utf8')
const assignment = migration.slice(migration.indexOf('DO $dev_466$'))

const OWNER_ID = '46600000-0000-4000-8000-000000000001'
const OTHER_ID = '46600000-0000-4000-8000-000000000002'

function localPsql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

describeLocal('migration 466 — atribuição da marca Dev', () => {
  it('marca só a conta do e-mail da lista, registra o motivo e é idempotente', () => {
    expect(assignment.startsWith('DO $dev_466$')).toBe(true)
    const result = localPsql(`
      BEGIN;
      -- O ambiente pode já ter a conta do dono (staging, produção); o teste usa as próprias linhas.
      DELETE FROM public.user_profiles p USING auth.users u
       WHERE u.id = p.id AND lower(u.email) = 'lucca.juliatti@fwlog.com.br' AND p.id <> '${OWNER_ID}';
      INSERT INTO auth.users (id, email) VALUES
        ('${OWNER_ID}', ' Lucca.Juliatti@fwlog.com.br '), ('${OTHER_ID}', 'outra-466@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${OWNER_ID}', 'Dono 466', 'administrativo', true), ('${OTHER_ID}', 'Outra 466', 'administrativo', true);
      ${assignment}
      ${assignment}
      SELECT concat_ws('|',
        (SELECT is_dev FROM public.user_profiles WHERE id = '${OWNER_ID}'),
        (SELECT is_dev FROM public.user_profiles WHERE id = '${OTHER_ID}'),
        (SELECT count(*) FROM public.audit_logs WHERE entity_id = '${OWNER_ID}' AND field_name = 'is_dev'),
        (SELECT justification FROM public.audit_logs WHERE entity_id = '${OWNER_ID}' AND field_name = 'is_dev'),
        (SELECT nullif(current_setting('vela.access_change_reason', true), '') IS NULL));
      ROLLBACK;
    `)
    expect(result.split('\n').at(-1)).toBe('t|f|1|Marca Dev dada pela migration 466 (ADR 0104).|t')
  })
})
