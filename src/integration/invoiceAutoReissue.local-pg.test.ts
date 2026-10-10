import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { syntheticCnpj, describeWithProbe } from './localTestData'

// Migration 126 (ADR 0077, decisão de 2026-10-01): reimportação que altera a
// base faturada de B/L com fatura sem pagamento cancela a individual e a
// consolidada e reemite as duas com o valor novo.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000126001'
const customerId = 99212601
const carrierId = 99212602
const vesselId = 99212603
const voyageId = 99212604
const chargeTableId = 99212605
const chargeItemId = 99212606
const blA = 'R126-BL-A'
const blB = 'R126-BL-B'
const blPaid = 'R126-BL-P'
const blHeld = 'R126-BL-H'
const allBls = [blA, blB, blPaid, blHeld]
const customerCnpj = syntheticCnpj(126001)

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`], { encoding: 'utf8' }).trim()
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regproc('public.auto_reissue_invoices_for_bl') IS NOT NULL;`) === 't'
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

function adminJson<T>(sql: string): T {
  const result = asAdmin(sql)
  expect(result.status, result.stderr).toBe(0)
  const line = result.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('{') || l.startsWith('[')).at(-1)
  return JSON.parse(line ?? '{}') as T
}

function issueByCe(blId: string, ce: string) {
  const result = asAdmin(`DO $$ BEGIN PERFORM public.apply_ce_mercante_update('${blId}', '${ce}', '${actorId}'::uuid); END $$`)
  expect(result.status, result.stderr).toBe(0)
  return Number(psql(`SELECT id FROM public.invoices WHERE bl_id = '${blId}' AND status = 'issued' AND invoice_type = 'individual'`))
}

// Payload de reimportação a partir do estado atual, com containers extras.
function reimport(blId: string, extraContainers: string[]) {
  const payload = JSON.parse(psql(`SELECT jsonb_build_array(to_jsonb(b) || jsonb_build_object(
    'override_billing', true, 'billing_impact', true,
    'containers', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.container_number) FROM public.bl_containers c WHERE c.bl_id = b.id),
    'vehicles', '[]'::jsonb, 'freight_lines', '[]'::jsonb)) FROM public.bls b WHERE id = '${blId}'`))
  for (const number of extraContainers) {
    payload[0].containers.push({ ...payload[0].containers[0], id: undefined, container_number: number })
  }
  return adminJson<{ invoice_reissues: Array<{ status: string; reissued: Array<{ type: string; invoice_id: number }>; pending_reason: string | null }> }>(
    `SELECT public.import_bl_freight_transactional('${JSON.stringify(payload)}'::jsonb, '${actorId}'::uuid)`,
  )
}

function receivableId(blId: string) {
  return Number(psql(`SELECT id FROM public.bl_receivables WHERE bl_id = '${blId}' AND source = 'local_charges'`))
}

function cleanup() {
  const bls = `ARRAY['${allBls.join("','")}']::text[]`
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE metadata->>'bl_id' LIKE 'R126-%');
    DELETE FROM public.alert_items WHERE metadata->>'bl_id' LIKE 'R126-%';
    DELETE FROM public.ledger_settlements WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.invoice_refunds WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.invoice_lifecycle_events WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.invoice_receivable_links WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.invoice_bls WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.payments WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.billing_batches WHERE customer_id = ${customerId};
    DELETE FROM public.portal_notifications WHERE customer_id = ${customerId};
    DELETE FROM public.invoices WHERE customer_id = ${customerId};
    DELETE FROM public.bl_receivables WHERE customer_id = ${customerId};
    DELETE FROM public.import_pending_effects WHERE entity_id = ANY(${bls});
    DELETE FROM public.charge_calculations WHERE bl_id = ANY(${bls});
    DELETE FROM public.pricing_rule_versions WHERE charge_table_id = ${chargeTableId};
    DELETE FROM public.bl_containers WHERE bl_id = ANY(${bls});
    DELETE FROM public.bls WHERE id = ANY(${bls});
    DELETE FROM public.charge_table_items WHERE id = ${chargeItemId};
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

describeLocal('126 — reimportação com impacto reemite individual e consolidada sem pagamento', () => {
  let indA = 0
  let indB = 0
  let consolidated = 0

  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'auto-reissue-126@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${actorId}', 'Administrativo 126', 'administrativo', true)
        ON CONFLICT (id) DO UPDATE SET role = 'administrativo', active = true;
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '${customerCnpj}', 'Cliente 126');
      INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
        VALUES (${customerId}, 'Financeiro 126', 'financeiro-126@example.test', 'financeiro', true);
      INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
        VALUES (${customerId}, 'Fixture: gate aberto', '${actorId}', now() + interval '1 day');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier 126');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel 126', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'R126', 'active');
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
        VALUES (${chargeTableId}, 'Tabela 126', 'R126POD', CURRENT_DATE - 30, true, 'container');
      -- R$ 500 por container: um container a mais muda o valor faturado.
      INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency)
        VALUES (${chargeItemId}, ${chargeTableId}, 'Taxa por container 126', 'container', 500, 500, 'container_distinct_voyage', 'base', 'any', 'BRL');
      INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status, ce_mercante)
      VALUES ${allBls.map((bl) => `('${bl}', ${voyageId}, ${customerId}, 'R126POD', 'container', 'pending', 'not_calculated', 'reconciled', NULL)`).join(', ')};
      INSERT INTO public.bl_containers (bl_id, container_number, type)
      VALUES ('${blA}', 'RAAU1260001', '22G1'), ('${blB}', 'RAAU1260002', '22G1'),
             ('${blPaid}', 'RAAU1260003', '22G1'), ('${blHeld}', 'RAAU1260004', '22G1');
    `)
    indA = issueByCe(blA, '126000000000001')
    indB = issueByCe(blB, '126000000000002')
    consolidated = adminJson<{ invoice_id: number }>(
      `SELECT public.create_local_consolidated_invoice(${customerId}, ARRAY[${receivableId(blA)}, ${receivableId(blB)}]::bigint[], NULL, '${actorId}'::uuid)`,
    ).invoice_id
  })

  afterAll(cleanup)

  it('emite as faturas iniciais pelo valor da tabela', () => {
    expect(psql(`SELECT total_brl FROM public.invoices WHERE id = ${indA}`)).toBe('500.00')
    expect(psql(`SELECT total_brl FROM public.invoices WHERE id = ${consolidated}`)).toBe('1000.00')
  })

  it('o cancelamento manual da individual dentro da consolidada aberta é recusado', () => {
    expect(asAdmin(`SELECT public.cancel_invoice(${indA}, 'Teste', NULL)`).stderr).toMatch(/consolidada/)
    expect(psql(`SELECT status FROM public.invoices WHERE id = ${indA}`)).toBe('issued')
  })

  it('reimportação que muda a base cancela e reemite a individual e a consolidada', () => {
    const result = reimport(blA, ['RAAU1260099'])
    expect(result.invoice_reissues[0]).toMatchObject({ status: 'reissued', pending_reason: null })

    expect(psql(`SELECT status FROM public.invoices WHERE id IN (${indA}, ${consolidated}) ORDER BY id`)).toBe('cancelled\ncancelled')
    const newInd = psql(`SELECT total_brl || '|' || status FROM public.invoices WHERE replaces_invoice_id = ${indA}`)
    expect(newInd).toBe('1000.00|issued')
    const newCon = psql(`SELECT total_brl || '|' || status FROM public.invoices WHERE replaces_invoice_id = ${consolidated}`)
    expect(newCon).toBe('1500.00|issued')
    // A individual do outro B/L da consolidada não é tocada.
    expect(psql(`SELECT status FROM public.invoices WHERE id = ${indB}`)).toBe('issued')
    expect(psql(`SELECT financial_status FROM public.bls WHERE id = '${blA}'`)).toBe('invoiced')
    // Nada fica em Reemissão pendente nem em alerta.
    expect(psql(`SELECT count(*) FROM public.invoices WHERE customer_id = ${customerId} AND status = 'cancelled' AND reissue_requested_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = invoices.id)`)).toBe('0')
    expect(psql(`SELECT count(*) FROM public.alert_items WHERE item_type = 'fatura_desatualizada' AND status = 'active' AND metadata->>'bl_id' = '${blA}'`)).toBe('0')
  })

  it('reimportação idêntica não reemite', () => {
    const before = psql(`SELECT count(*) FROM public.invoices WHERE customer_id = ${customerId}`)
    const result = reimport(blA, [])
    expect(result.invoice_reissues).toEqual([])
    expect(psql(`SELECT count(*) FROM public.invoices WHERE customer_id = ${customerId}`)).toBe(before)
  })

  it('com pagamento não cancela: mantém a fatura e abre Fatura desatualizada', () => {
    const paid = issueByCe(blPaid, '126000000000003')
    adminJson(`SELECT public.register_ledger_invoice_payment(${paid}, 100)`)
    const result = reimport(blPaid, ['RAAU1260098'])
    expect(result.invoice_reissues[0]).toMatchObject({ status: 'has_payment' })
    expect(psql(`SELECT status || '|' || total_brl FROM public.invoices WHERE id = ${paid}`)).toBe('partially_paid|500.00')
    expect(psql(`SELECT count(*) FROM public.alert_items WHERE item_type = 'fatura_desatualizada' AND status = 'active' AND metadata->>'invoice_id' = '${paid}'`)).toBe('1')
  })

  it('sem condição de emitir, cancela, deixa Reemissão pendente e explica no alerta', () => {
    const held = issueByCe(blHeld, '126000000000004')
    // Sem a Liberação e sem Portal pronto, a emissão automática retém a fatura.
    psql(`DELETE FROM public.customer_billing_portal_releases WHERE customer_id = ${customerId};`)
    const result = reimport(blHeld, ['RAAU1260097'])
    expect(result.invoice_reissues[0]).toMatchObject({ status: 'pending', pending_reason: 'portal_not_provisioned' })
    expect(psql(`SELECT status FROM public.invoices WHERE id = ${held}`)).toBe('cancelled')
    const pending = asAdmin(`SELECT invoice_id FROM public.list_pending_reissues() WHERE customer_id = ${customerId}`)
    expect(pending.stdout.split('\n')).toContain(String(held))
    expect(psql(`SELECT count(*) FROM public.alert_items WHERE item_type = 'fatura_desatualizada' AND status = 'active' AND metadata->>'invoice_id' = '${held}'`)).toBe('1')
  })
})
