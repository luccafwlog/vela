import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 347 (revisão dos alertas de 2026-10-21, docs/revisao-alertas-2026-10.md):
// - B/L cancelado não é "processo ativo" do Portal (o alerta lia
//   financial_status = 'cancelled', valor que nenhum gravador põe);
// - B/L faturado no servidor fecha também o bloqueio de cálculo;
// - B/L cancelado fecha os dois alertas de faturamento;
// - excluir B/L leva os alertas dele.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string) {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.delete_bl_alerts_on_delete()') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 347 (delete_bl_alerts_on_delete)')

const ADMIN_ID = '34700000-0000-4000-8000-0000000000a1'
const CARRIER_ID = 3470001
const VESSEL_ID = 3470002
const VOYAGE_ID = 3470011
const ONLY_CANCELLED = 3470021
const WITH_LIVE_BL = 3470022
const CUSTOMERS = [ONLY_CANCELLED, WITH_LIVE_BL]
const BL_CANCELLED = 'BL347-CANC'
const BL_LIVE = 'BL347-VIVO'
const BL_BILLED = 'BL347-FAT'
const BL_CANCEL_BILLING = 'BL347-CANCFAT'
const BL_DELETED = 'BL347-EXCL'
const BLS = [BL_CANCELLED, BL_LIVE, BL_BILLED, BL_CANCEL_BILLING, BL_DELETED]
const blList = BLS.map((id) => `'${id}'`).join(', ')

function asAdmin(sql: string) {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN_ID}","role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    ${sql}
    COMMIT;
  `], { encoding: 'utf8' })
  const last = run.stdout.trim().split('\n').pop() ?? ''
  return { ...run, last }
}

function asServer(sql: string) {
  return psql(`BEGIN; SELECT set_config('request.jwt.claim.role', 'service_role', true); ${sql}; COMMIT;`)
}

function item(type: string, entityType: string, entityId: string | number) {
  return psql(`SELECT COALESCE((SELECT i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = '${type}' AND a.entity_type = '${entityType}' AND a.entity_id = '${entityId}'), 'sem item');`)
}

function openBillingAlert(type: string, blId: string) {
  const run = asAdmin(`SELECT public.upsert_billing_alert('${type}', '${blId}', 'teste 347', '{}'::jsonb);`)
  expect(run.stderr).toBe('')
  expect(item(type, 'bl', blId)).toBe('active')
}

function cleanup() {
  psql(`DELETE FROM public.alerts WHERE (entity_type = 'bl' AND entity_id IN (${blList}))
    OR (entity_type = 'customer' AND entity_id IN (${CUSTOMERS.map((id) => `'${id}'`).join(', ')}));`)
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.charge_calculations WHERE bl_id IN (${blList});
    DELETE FROM public.bls WHERE id IN (${blList});
    DELETE FROM public.audit_logs WHERE changed_by = '${ADMIN_ID}' OR entity_id IN (${blList});
    DELETE FROM public.customer_billing_portal_releases WHERE customer_id IN (${CUSTOMERS.join(', ')});
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${CUSTOMERS.join(', ')});
    DELETE FROM public.customers WHERE id IN (${CUSTOMERS.join(', ')});
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.user_profiles WHERE id = '${ADMIN_ID}';
    DELETE FROM auth.users WHERE id = '${ADMIN_ID}';
    SET session_replication_role = origin;
  `)
}

describeLocal('347 — alertas acompanham o B/L cancelado, faturado ou excluído', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES ('${ADMIN_ID}', 'adm347@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${ADMIN_ID}', 'Administrativo 347', 'administrativo', true);
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Carrier 347');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Vessel 347', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'V347', 'active');
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
        (${ONLY_CANCELLED}, '${syntheticCnpj(3470021)}', 'Cliente 347 cancelado'),
        (${WITH_LIVE_BL}, '${syntheticCnpj(3470022)}', 'Cliente 347 vivo');
      INSERT INTO public.bls (id, voyage_id, customer_id, review_status) VALUES
        ('${BL_CANCELLED}', ${VOYAGE_ID}, ${ONLY_CANCELLED}, 'ok'),
        ('${BL_LIVE}', ${VOYAGE_ID}, ${WITH_LIVE_BL}, 'ok'),
        ('${BL_BILLED}', ${VOYAGE_ID}, ${WITH_LIVE_BL}, 'ok'),
        ('${BL_CANCEL_BILLING}', ${VOYAGE_ID}, ${WITH_LIVE_BL}, 'ok'),
        ('${BL_DELETED}', ${VOYAGE_ID}, ${WITH_LIVE_BL}, 'ok');
      -- Liberação de faturamento sem Portal: o B/L pode ser faturado.
      INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
      VALUES (${WITH_LIVE_BL}, 'teste 347', '${ADMIN_ID}', now() + interval '10 days');
    `)
  })

  afterAll(cleanup)

  it('Cliente só com B/L cancelado não tem pendência do Portal nem processo ativo', () => {
    expect(asAdmin(`SELECT (public.cancel_bl('${BL_CANCELLED}', 'teste 347')->>'cancelled');`).last).toBe('true')
    asServer('SELECT public.reconcile_client_portal_alerts()')

    // Antes: a pendência abria para o Cliente cujo único B/L foi cancelado.
    expect(item('portal_pendencia_geral', 'customer', ONLY_CANCELLED)).toBe('sem item')
    expect(item('portal_pendencia_geral', 'customer', WITH_LIVE_BL)).toBe('active')

    const console = (customerId: number) => asAdmin(
      `SELECT r->>'has_active_process' FROM public.portal_list_provisioning_console(${customerId}) r;`,
    ).last
    expect(console(ONLY_CANCELLED)).toBe('false')
    expect(console(WITH_LIVE_BL)).toBe('true')
  })

  it('B/L faturado no servidor fecha o bloqueio de cálculo, não só a falha de emissão', () => {
    openBillingAlert('billing_calculation_blocked', BL_BILLED)
    // A emissão pelo CE (servidor) marca o B/L como faturado.
    psql(`SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN_ID}","role":"authenticated"}', false);
      UPDATE public.bls SET financial_status = 'invoiced' WHERE id = '${BL_BILLED}';`)
    expect(item('billing_calculation_blocked', 'bl', BL_BILLED)).toBe('resolved')
  })

  it('cancelar o B/L fecha os dois alertas de faturamento', () => {
    openBillingAlert('billing_calculation_blocked', BL_CANCEL_BILLING)
    openBillingAlert('billing_auto_issue_failed', BL_CANCEL_BILLING)
    expect(asAdmin(`SELECT (public.cancel_bl('${BL_CANCEL_BILLING}', 'teste 347')->>'cancelled');`).last).toBe('true')
    expect(item('billing_calculation_blocked', 'bl', BL_CANCEL_BILLING)).toBe('resolved')
    expect(item('billing_auto_issue_failed', 'bl', BL_CANCEL_BILLING)).toBe('resolved')
  })

  it('excluir B/L leva os alertas dele', () => {
    openBillingAlert('billing_calculation_blocked', BL_DELETED)
    const deleteBl = asAdmin(`SELECT public.delete_records('bl', ARRAY['${BL_DELETED}'], false, 'teste 347');`)
    expect(deleteBl.stderr).toBe('')
    expect(psql(`SELECT count(*) FROM public.bls WHERE id = '${BL_DELETED}';`)).toBe('0')
    expect(psql(`SELECT count(*) FROM public.alerts WHERE entity_type = 'bl' AND entity_id = '${BL_DELETED}';`)).toBe('0')
  })
})
