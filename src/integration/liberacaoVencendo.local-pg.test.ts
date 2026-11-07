// Migration 617 (ADR 0132, decisão 9): a Liberação de faturamento que vence
// nos próximos 2 dias úteis, com o Cliente ainda sem Portal pronto, abre
// "Liberação de faturamento vencendo" ao Administrativo; renovar ou revogar
// fecha na hora. Cada cenário roda numa transação desfeita.
//
// Namespace exclusivo: Cliente 996170, usuário ...000000617001.
import { execPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

const db = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const local = process.env.LOCAL_PG_INTEGRATION === '1' ? describe : describe.skip
const CUSTOMER = 996170
const ADM = '00000000-0000-0000-0000-000000617001'

function sql(q: string): string {
  return execPsql(['-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: q, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    .replaceAll(String.fromCharCode(13), '').trim()
}

const state = `SELECT COALESCE((SELECT concat_ws('|', i.status, i.severity, i.department) FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
  WHERE a.entity_id = '${CUSTOMER}' AND i.item_type = 'liberacao_vencendo'), 'sem alerta');`

function run(reviewIn: string, after = ''): string {
  return sql(`BEGIN;
    SET LOCAL request.jwt.claim.role = 'service_role';
    INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
      VALUES (${CUSTOMER}, 'Portal em ativação', '${ADM}', now() + interval '${reviewIn}');
    SELECT public.reconcile_billing_release_expiring_alerts('teste_617') >= 0;
    ${after}
    ${state}
    ROLLBACK;`).split('\n').at(-1) ?? ''
}

local('Liberação de faturamento vencendo (migration 617)', () => {
  const cleanup = () => sql(`SET session_replication_role = replica;
    DELETE FROM public.customers WHERE id = ${CUSTOMER};
    DELETE FROM public.user_profiles WHERE id = '${ADM}';
    DELETE FROM auth.users WHERE id = '${ADM}';
    SET session_replication_role = origin;`)
  beforeAll(() => {
    cleanup()
    sql(`INSERT INTO auth.users (id, email) VALUES ('${ADM}', 'a617@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${ADM}', 'A617 Adm', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${CUSTOMER}, '${syntheticCnpj(61701)}', 'A617');`)
  })
  afterAll(cleanup)

  it('vence nas próximas horas, sem Portal pronto: Normal do Administrativo', () => {
    expect(run('3 hours')).toBe('active|normal|administrativo')
  })

  it('vence daqui a 20 dias: não abre', () => {
    expect(run('20 days')).toBe('sem alerta')
  })

  it('renovar com uma Liberação nova fecha na hora; revogar também', () => {
    // Uma Liberação aberta por Cliente: renovar empurra o vencimento.
    expect(run('3 hours', `UPDATE public.customer_billing_portal_releases SET review_at = now() + interval '30 days'
      WHERE customer_id = ${CUSTOMER};`)).toMatch(/^resolved\|/)
    expect(run('3 hours', `UPDATE public.customer_billing_portal_releases SET revoked_at = now(), revoked_by = '${ADM}', revoke_reason = 'Portal ativo'
      WHERE customer_id = ${CUSTOMER};`)).toMatch(/^resolved\|/)
  })
})
