// Migration 624 (ADR 0134, decisão 6): a fatura de Taxas Locais cancelada por
// uma pessoa, sem fatura nova, abre "B/L sem fatura depois do cancelamento"
// (Normal, Documentação) 1 dia útil depois. A avulsa, o cancelamento
// automático, o B/L isento e a fatura nova não abrem. Cada cenário roda numa
// transação desfeita no fim. A Invoice de Demurrage está em
// classificacaoDemurrage.local-pg.test.ts.
//
// Namespace exclusivo: Cliente 996150, B/L 'A615-1', usuário ...000000615001.
import { execPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

const db = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const local = process.env.LOCAL_PG_INTEGRATION === '1' ? describe : describe.skip
const CUSTOMER = 996150
const BL = 'A615-1'
const USER = '00000000-0000-0000-0000-000000615001'

function sql(q: string): string {
  return execPsql(['-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: q, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    .replaceAll(String.fromCharCode(13), '').trim()
}

type Case = { cancelledAgo: string; by?: string | null; type?: string; exempt?: boolean; extra?: string }

function run(c: Case): string {
  const by = c.by === undefined ? `'${USER}'` : c.by === null ? 'NULL' : `'${c.by}'`
  const out = sql(`BEGIN;
    SET LOCAL session_replication_role = replica;
    INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${CUSTOMER}, 1, 'A615', 'active');
    INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode, charge_status) VALUES ('${BL}', ${CUSTOMER}, ${CUSTOMER}, 'container', '${c.exempt ? 'exempt' : 'calculated'}');
    INSERT INTO public.invoices (id, invoice_number, customer_id, bl_id, status, invoice_type, issued_at, cancelled_at, cancelled_by, cancel_reason, total_brl)
      VALUES (996150, 'FAT-A615', ${CUSTOMER}, '${BL}', 'cancelled', '${c.type ?? 'individual'}', now() - interval '10 days',
              now() - interval '${c.cancelledAgo}', ${by}, 'Corrigir o CNPJ', 100);
    ${c.extra ?? ''}
    SET LOCAL session_replication_role = origin;
    SELECT public.reconcile_cancelled_invoice_alerts('teste_624') >= 0;
    SELECT COALESCE((SELECT concat_ws('|', i.status, i.severity, i.department) FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE a.entity_id = '${BL}' AND i.item_type = 'fatura_cancelada_sem_reemissao'), 'sem alerta');
    ROLLBACK;`)
  return out.split('\n').at(-1) ?? ''
}

local('Fatura cancelada sem nova emissão (migration 624)', () => {
  const cleanup = () => sql(`SET session_replication_role = replica;
    DELETE FROM public.customers WHERE id = ${CUSTOMER};
    DELETE FROM public.user_profiles WHERE id = '${USER}';
    DELETE FROM auth.users WHERE id = '${USER}';
    SET session_replication_role = origin;`)
  beforeAll(() => {
    cleanup()
    sql(`INSERT INTO auth.users (id, email) VALUES ('${USER}', 'a615@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${USER}', 'A615 Adm', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${CUSTOMER}, '${syntheticCnpj(61501)}', 'A615');`)
  })
  afterAll(cleanup)

  it('cancelada por uma pessoa há mais de 1 dia útil, sem fatura nova: Normal da Documentação', () => {
    expect(run({ cancelledAgo: '5 days' })).toBe('active|normal|documentacao')
  })

  it('antes de 1 dia útil, não abre', () => {
    expect(run({ cancelledAgo: '1 minute' })).toBe('sem alerta')
  })

  it('com fatura nova emitida, não abre', () => {
    expect(run({ cancelledAgo: '5 days', extra: `INSERT INTO public.invoices (id, invoice_number, customer_id, bl_id, status, invoice_type, total_brl)
      VALUES (996151, 'FAT-A615B', ${CUSTOMER}, '${BL}', 'issued', 'individual', 100);` })).toBe('sem alerta')
  })

  it('avulsa, cancelamento automático e B/L isento não abrem', () => {
    expect(run({ cancelledAgo: '5 days', type: 'manual' })).toBe('sem alerta')
    expect(run({ cancelledAgo: '5 days', by: null })).toBe('sem alerta')
    expect(run({ cancelledAgo: '5 days', exempt: true })).toBe('sem alerta')
  })
})
