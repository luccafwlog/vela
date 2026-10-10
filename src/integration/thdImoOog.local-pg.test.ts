import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { syntheticCnpj, describeWithProbe } from './localTestData'

// Migration 129 (ADR 0077, decisão de 2026-10-02): container IMO e OOG ao mesmo
// tempo paga o THD normal com 150% de majoração (× 2,5), sem revisão manual.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000129001'
const customerId = 99212901
const carrierId = 99212902
const vesselId = 99212903
const voyageId = 99212904
const chargeTableId = 99212905
const thdStd = 99212906
const thdImo = 99212907
const thdOog = 99212908
const bl = { dual: 'R129-BL-D', override: 'R129-BL-O', shareA: 'R129-BL-SA', shareB: 'R129-BL-SB', billed: 'R129-BL-F' }
const allBls = Object.values(bl)

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`], { encoding: 'utf8' }).trim()
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT position(':imo_oog' IN pg_get_functiondef('public.resolve_bl_local_charge_items(text,text)'::regprocedure)) > 0;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migrationApplied')

function asAdmin(sql: string) {
  return spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.role = 'authenticated';
    SET LOCAL request.jwt.claim.sub = '${actorId}';
    ${sql};
    COMMIT;
  `], { encoding: 'utf8' })
}

function calculate(blId: string) {
  const result = asAdmin(`SELECT public.calculate_bl_local_charges('${blId}', '${actorId}'::uuid, true)`)
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout.split('\n').find((line) => line.startsWith('{')) ?? '{}') as { status: string; total_brl: number }
}

function lines(blId: string) {
  return psql(`SELECT string_agg(calculation_key || '|' || quantity::numeric(12,2) || '|' || total_value_brl, ',' ORDER BY calculation_key)
    FROM public.charge_calculations WHERE bl_id = '${blId}'`)
}

function cleanup() {
  const bls = `ARRAY['${allBls.join("','")}']::text[]`
  const invoices = `(SELECT id FROM public.invoices WHERE customer_id = ${customerId})`
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.alert_items WHERE metadata->>'bl_id' LIKE 'R129-%';
    DELETE FROM public.invoice_lifecycle_events WHERE invoice_id IN ${invoices};
    DELETE FROM public.invoice_items WHERE invoice_id IN ${invoices};
    DELETE FROM public.invoice_receivable_links WHERE invoice_id IN ${invoices};
    DELETE FROM public.invoice_bls WHERE invoice_id IN ${invoices};
    DELETE FROM public.billing_batches WHERE customer_id = ${customerId};
    DELETE FROM public.portal_notifications WHERE customer_id = ${customerId};
    DELETE FROM public.invoices WHERE customer_id = ${customerId};
    DELETE FROM public.bl_receivables WHERE bl_id = ANY(${bls});
    DELETE FROM public.import_pending_effects WHERE entity_id = ANY(${bls});
    DELETE FROM public.charge_calculations WHERE bl_id = ANY(${bls});
    DELETE FROM public.pricing_rule_versions WHERE charge_table_id = ${chargeTableId};
    DELETE FROM public.bl_containers WHERE bl_id = ANY(${bls});
    DELETE FROM public.bls WHERE id = ANY(${bls});
    DELETE FROM public.customer_rate_overrides WHERE customer_id = ${customerId};
    DELETE FROM public.charge_table_items WHERE charge_table_id = ${chargeTableId};
    DELETE FROM public.charge_tables WHERE id = ${chargeTableId};
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.customer_billing_portal_releases WHERE customer_id = ${customerId};
    DELETE FROM public.customer_contact_box_links WHERE contact_id IN (SELECT id FROM public.customer_contacts WHERE customer_id = ${customerId});
    DELETE FROM public.customer_contacts WHERE customer_id = ${customerId};
    DELETE FROM public.portal_provisioning_events WHERE customer_id = ${customerId};
    DELETE FROM public.customer_portal_accounts WHERE customer_id = ${customerId};
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.audit_logs WHERE changed_by = '${actorId}';
    DELETE FROM public.user_profiles WHERE id = '${actorId}';
    DELETE FROM auth.users WHERE id = '${actorId}';
    SET session_replication_role = origin;
  `)
}

describeLocal('129 — THD de container IMO e OOG ao mesmo tempo', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'thd-129@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${actorId}', 'Administrativo 129', 'administrativo', true)
        ON CONFLICT (id) DO UPDATE SET role = 'administrativo', active = true;
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '${syntheticCnpj(129001)}', 'Cliente 129');
      INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
        VALUES (${customerId}, 'Financeiro 129', 'financeiro-129@example.test', 'financeiro', true);
      INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
        VALUES (${customerId}, 'Fixture: gate aberto', '${actorId}', now() + interval '1 day');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier 129');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel 129', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'R129', 'active');
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
        VALUES (${chargeTableId}, 'Tabela 129', 'R129POD', CURRENT_DATE - 30, true, 'container');
      -- Como na tabela de Vitória: standard 1.420, IMO +50%, OOG +100%.
      INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency)
        VALUES (${thdStd}, ${chargeTableId}, 'THD', 'container', 1420, 1420, 'container_distinct_voyage', 'base', 'standard', 'BRL'),
               (${thdImo}, ${chargeTableId}, 'THD', 'container', 2130, 2130, 'container_distinct_voyage', 'base', 'imo', 'BRL'),
               (${thdOog}, ${chargeTableId}, 'THD', 'container', 2840, 2840, 'container_distinct_voyage', 'base', 'oog', 'BRL');
      INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status, ce_mercante)
      VALUES ${allBls.map((id) => `('${id}', ${voyageId}, ${customerId}, 'R129POD', 'container', 'pending', 'not_calculated', 'reconciled', NULL)`).join(', ')};
      INSERT INTO public.bl_containers (bl_id, container_number, type, is_imo, is_oog) VALUES
        ('${bl.dual}', 'RDDU1290001', '22G1', true, true),
        ('${bl.dual}', 'RDDU1290002', '22G1', false, false),
        ('${bl.override}', 'RDDU1290003', '22G1', true, true),
        ('${bl.shareA}', 'RDDU1290004', '22G1', true, true),
        ('${bl.shareB}', 'RDDU1290004', '22G1', true, true),
        ('${bl.billed}', 'RDDU1290005', '22G1', false, false);
    `)
  })

  afterAll(cleanup)

  it('cobra THD normal × 2,5 sem pedir revisão e mantém o THD normal do outro container', () => {
    const result = calculate(bl.dual)
    expect(result.status).toBe('calculated')
    expect(lines(bl.dual)).toBe(`auto:item:${thdStd}|1.00|1420.00,auto:item:${thdStd}:imo_oog|1.00|3550.00`)
  })

  it('parte da Condição do Cliente quando há valor especial no THD normal', () => {
    psql(`INSERT INTO public.customer_rate_overrides (customer_id, charge_item_id, override_value, valid_from, active)
      VALUES (${customerId}, ${thdStd}, 1300, CURRENT_DATE - 60, true)`)
    calculate(bl.override)
    expect(lines(bl.override)).toBe(`auto:item:${thdStd}:imo_oog|1.00|3250.00`)
    psql(`UPDATE public.customer_rate_overrides SET active = false WHERE customer_id = ${customerId}`)
  })

  it('container compartilhado divide o valor entre os B/Ls sem perder centavo', () => {
    calculate(bl.shareA)
    calculate(bl.shareB)
    const total = Number(psql(`SELECT sum(total_value_brl) FROM public.charge_calculations WHERE bl_id IN ('${bl.shareA}', '${bl.shareB}')`))
    expect(total).toBe(3550)
  })

  it('B/L faturado cujo container vira IMO e OOG é reemitido pelo valor novo', () => {
    const ce = asAdmin(`DO $$ BEGIN PERFORM public.apply_ce_mercante_update('${bl.billed}', '129000000000001', '${actorId}'::uuid); END $$`)
    expect(ce.status, ce.stderr).toBe(0)
    const invoice = Number(psql(`SELECT id FROM public.invoices WHERE bl_id = '${bl.billed}' AND status = 'issued'`))
    expect(psql(`SELECT total_brl FROM public.invoices WHERE id = ${invoice}`)).toBe('1420.00')
    psql(`UPDATE public.bl_containers SET is_imo = true, is_oog = true WHERE bl_id = '${bl.billed}'`)
    expect(psql(`SELECT status FROM public.invoices WHERE id = ${invoice}`)).toBe('cancelled')
    expect(psql(`SELECT total_brl || '|' || status FROM public.invoices WHERE replaces_invoice_id = ${invoice}`)).toBe('3550.00|issued')
  })
})
