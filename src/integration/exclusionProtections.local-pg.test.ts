import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Migration 086 (ADR 0071; plano 2026-09-24-politica-de-exclusao, Fase 1):
// nem o Administrativo apaga documento fiscal ou auditoria pela API, e a
// exclusão de viagem deixa rastro em audit_logs.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.voyages'::regclass AND tgname = 'audit_voyages'
    );`) === 't'
  } catch {
    return false
  }
}

const describeLocal = migrationApplied() ? describe : describe.skip

const ADMIN_ID = '08600000-0000-4000-8000-0000000000a1'
const CUSTOMER_ID = 8600001
const INVOICE_NUMBER = 'EXCL-086-1'
const CARRIER_ID = 8600002
const VESSEL_ID = 8600003
const VOYAGE_ID = 8600004
// CNPJ do namespace 086: o CNPJ é UNIQUE também na conta do Portal criada
// pelo trigger de cliente, e um CNPJ compartilhado derruba outras suítes.
const CUSTOMER_CNPJ = '08600001000189'

// Executa como o usuário Administrativo autenticado, dentro de uma transação.
function asAdmin(statement: string) {
  return spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN_ID}","role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    ${statement}
    COMMIT;
  `], { encoding: 'utf8' })
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE entity_type = 'voyages' AND entity_id = '${VOYAGE_ID}';
    DELETE FROM public.invoices WHERE invoice_number = '${INVOICE_NUMBER}';
    DELETE FROM public.portal_provisioning_events WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.user_profiles WHERE id = '${ADMIN_ID}';
    DELETE FROM auth.users WHERE id = '${ADMIN_ID}';
    SET session_replication_role = origin;
  `)
}

describeLocal('086 — documento fiscal e auditoria não se apagam; viagem deixa rastro', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email, aud, role)
        VALUES ('${ADMIN_ID}', 'excl086@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active)
        VALUES ('${ADMIN_ID}', 'Administrativo 086', 'administrativo', true)
        ON CONFLICT (id) DO UPDATE SET role = 'administrativo', active = true;
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER_ID}, 'Cliente 086', '${CUSTOMER_CNPJ}');
      INSERT INTO public.invoices (invoice_number, customer_id, total_brl)
        VALUES ('${INVOICE_NUMBER}', ${CUSTOMER_ID}, 10);
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Carrier 086');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Vessel 086', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status)
        VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'V086', 'active');
    `)
  })

  afterAll(cleanup)

  it('recusa ao Administrativo apagar uma fatura', () => {
    const attempt = asAdmin(`DELETE FROM public.invoices WHERE invoice_number = '${INVOICE_NUMBER}';`)
    expect(attempt.status).not.toBe(0)
    expect(attempt.stderr).toMatch(/permission denied/i)
    expect(psql(`SELECT count(*) FROM public.invoices WHERE invoice_number = '${INVOICE_NUMBER}';`)).toBe('1')
  })

  it('recusa ao Administrativo apagar pagamento, recebível, liquidação e item de fatura', () => {
    for (const table of ['payments', 'bl_receivables', 'ledger_settlements', 'invoice_items']) {
      const attempt = asAdmin(`DELETE FROM public.${table} WHERE false;`)
      expect(attempt.stderr, table).toMatch(/permission denied/i)
    }
  })

  it('registra a exclusão de viagem na auditoria e recusa apagar esse registro', () => {
    psql(`DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};`)
    expect(psql(`SELECT count(*) > 0 FROM public.audit_logs
      WHERE entity_type = 'voyages' AND entity_id = '${VOYAGE_ID}' AND field_name = 'excluido';`)).toBe('t')

    const del = asAdmin(`DELETE FROM public.audit_logs WHERE entity_type = 'voyages' AND entity_id = '${VOYAGE_ID}';`)
    expect(del.stderr).toMatch(/permission denied/i)
    const upd = asAdmin(`UPDATE public.audit_logs SET new_value = 'x' WHERE entity_type = 'voyages' AND entity_id = '${VOYAGE_ID}';`)
    expect(upd.stderr).toMatch(/permission denied/i)
  })

  it('mantém Excluir cobrança manual funcionando para o Administrativo', () => {
    const itemId = psql(`INSERT INTO public.invoice_items (invoice_id, description, total_value_brl, source)
      SELECT id, 'Cobrança manual 086', 3, 'manual' FROM public.invoices WHERE invoice_number = '${INVOICE_NUMBER}'
      RETURNING id;`)
    const call = asAdmin(`SELECT public.delete_manual_invoice_charge(${itemId}, NULL);`)
    expect(call.stderr).toBe('')
    expect(psql(`SELECT count(*) FROM public.invoice_items WHERE id = ${itemId};`)).toBe('0')
  })

  it('mantém Cancelar baixa como função do dono', () => {
    expect(psql(`SELECT prosecdef FROM pg_proc WHERE proname = 'reverse_invoice_payment';`)).toBe('t')
  })
})
