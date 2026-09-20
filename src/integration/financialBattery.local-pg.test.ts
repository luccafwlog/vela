import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000052001'
const portalUserId = '00000000-0000-0000-0000-000000052002'
const equipmentUserId = '00000000-0000-0000-0000-000000052003'
const customerId = 99205201
const carrierId = 99205202
const vesselId = 99205203
const voyageId = 99205204
const localBlIds = ['S13-FIN-BL-1', 'S13-FIN-BL-2', 'S13-FIN-BL-3', 'S13-FIN-BL-4', 'S13-FIN-BL-5']
const demurrageBlIds = ['S15-FIN-BL-6', 'S15-FIN-BL-7']
const allBlIds = [...localBlIds, ...demurrageBlIds]
const localInvoiceIds = [99205211, 99205212, 99205213, 99205214, 99205215]
const receivableIds = [99205201, 99205202, 99205203, 99205204, 99205205]
const chargeCalculationIds = [99205231, 99205232]
const chargeTableId = 99205233
const chargeItemId = 99205234
const demurrageInvoiceIds = [99205221, 99205222]
const demurrageContainerIds = [99205241, 99205242]
const demurrageItemIds = [99205243, 99205244]
const financialContactEmail = 'financial-battery@example.test'
const customerCnpj = syntheticCnpj(52001)

type ExchangeRateSnapshot = {
  ptax: number | null
  roe: number
  effective_date: string
  source: string
  quote_date: string | null
  spread_version: number
}

let exchangeRateSnapshot: ExchangeRateSnapshot | null = null

function psql(sql: string, jwtRole: 'service_role' | 'authenticated' = 'service_role'): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = '${jwtRole}'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`,
  ], { encoding: 'utf8' }).trim()
}

function callAs(
  userId: string,
  sql: string,
  jwtRole: 'service_role' | 'authenticated' = 'authenticated',
) {
  const dbRole = jwtRole === 'authenticated' ? 'authenticated' : 'service_role'
  return spawnSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `BEGIN; SET LOCAL ROLE ${dbRole}; SET LOCAL request.jwt.claim.role = '${jwtRole}'; SET LOCAL request.jwt.claim.sub = '${userId}'; ${sql}; COMMIT;`,
  ], { encoding: 'utf8' })
}

function lastJson(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') || line.startsWith('['))
  return lines.at(-1) ?? '{}'
}

function expectFailure(userId: string, sql: string, jwtRole: 'service_role' | 'authenticated' = 'authenticated'): void {
  const result = callAs(userId, sql, jwtRole)
  expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0)
}

function cleanup(): void {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.alert_item_events
    WHERE alert_item_id IN (
      SELECT ai.id FROM public.alert_items ai
      JOIN public.alerts a ON a.id = ai.alert_id
      WHERE a.entity_id IN ('${customerId}', '${demurrageInvoiceIds.join("','")}')
    );
    DELETE FROM public.alert_item_dismissals
    WHERE alert_item_id IN (
      SELECT ai.id FROM public.alert_items ai
      JOIN public.alerts a ON a.id = ai.alert_id
      WHERE a.entity_id IN ('${customerId}', '${demurrageInvoiceIds.join("','")}')
    );
    DELETE FROM public.alert_items
    WHERE alert_id IN (
      SELECT id FROM public.alerts
      WHERE entity_id IN ('${customerId}', '${demurrageInvoiceIds.join("','")}')
    );
    DELETE FROM public.alerts
    WHERE entity_id IN ('${customerId}', '${demurrageInvoiceIds.join("','")}');
    DELETE FROM public.demurrage_dunning_claims
    WHERE demurrage_invoice_id = ANY(ARRAY[${demurrageInvoiceIds.join(',')}]::bigint[]);
    DELETE FROM public.portal_rate_limits WHERE customer_id = ${customerId};
    DELETE FROM public.portal_notifications WHERE customer_id = ${customerId};
    DELETE FROM public.demurrage_dispute_attachments
    WHERE dispute_id IN (SELECT id FROM public.demurrage_disputes WHERE customer_id = ${customerId});
    DELETE FROM public.demurrage_dispute_messages
    WHERE dispute_id IN (SELECT id FROM public.demurrage_disputes WHERE customer_id = ${customerId});
    DELETE FROM public.demurrage_disputes WHERE customer_id = ${customerId};
    DELETE FROM public.demurrage_calculation_snapshots
    WHERE demurrage_invoice_id = ANY(ARRAY[${demurrageInvoiceIds.join(',')}]::bigint[]);
    DELETE FROM public.demurrage_mutation_requests
    WHERE invoice_id = ANY(ARRAY[${demurrageInvoiceIds.join(',')}]::bigint[]);
    DELETE FROM public.demurrage_invoice_items
    WHERE invoice_id = ANY(ARRAY[${demurrageInvoiceIds.join(',')}]::bigint[]);
    DELETE FROM public.demurrage_invoice_history
    WHERE invoice_id = ANY(ARRAY[${demurrageInvoiceIds.join(',')}]::bigint[]);
    DELETE FROM public.demurrage_invoices
    WHERE id = ANY(ARRAY[${demurrageInvoiceIds.join(',')}]::bigint[]);
    DELETE FROM public.bl_containers
    WHERE id = ANY(ARRAY[${demurrageContainerIds.join(',')}]::bigint[]);
    DELETE FROM public.ledger_settlements
    WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId})
       OR payment_id IN (SELECT p.id FROM public.payments p JOIN public.invoices i ON i.id = p.invoice_id WHERE i.customer_id = ${customerId});
    DELETE FROM public.invoice_refunds
    WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.invoice_lifecycle_events
    WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId})
       OR related_invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.invoice_items
    WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.invoice_receivable_links
    WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.invoice_bls
    WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.payments
    WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.invoices WHERE customer_id = ${customerId};
    DELETE FROM public.bl_receivables WHERE customer_id = ${customerId};
    DELETE FROM public.charge_calculations
    WHERE id = ANY(ARRAY[${chargeCalculationIds.join(',')}]::bigint[])
       OR bl_id = ANY(ARRAY['${allBlIds.join("','")}']::text[]);
    DELETE FROM public.customer_contact_box_links
    WHERE contact_id IN (SELECT id FROM public.customer_contacts WHERE customer_id = ${customerId});
    DELETE FROM public.customer_contacts WHERE customer_id = ${customerId};
    DELETE FROM public.portal_email_attempts
    WHERE account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id = ${customerId});
    DELETE FROM public.portal_invites
    WHERE account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id = ${customerId});
    DELETE FROM public.customer_portal_sessions
    WHERE account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id = ${customerId});
    DELETE FROM public.portal_provisioning_events WHERE customer_id = ${customerId};
    DELETE FROM public.customer_portal_accounts WHERE customer_id = ${customerId};
    DELETE FROM public.bls WHERE id = ANY(ARRAY['${allBlIds.join("','")}']::text[]);
    DELETE FROM public.charge_table_items WHERE id = ${chargeItemId};
    DELETE FROM public.charge_tables WHERE id = ${chargeTableId};
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.audit_logs WHERE changed_by IN ('${actorId}', '${equipmentUserId}', '${portalUserId}');
    DELETE FROM public.user_profiles WHERE id IN ('${actorId}', '${equipmentUserId}');
    DELETE FROM auth.users WHERE id IN ('${actorId}', '${equipmentUserId}', '${portalUserId}');
    SET session_replication_role = origin;
  `)
}

describeLocal('S13/S15/S17 — bateria financeira adversarial no Postgres local', () => {
  beforeAll(() => {
    const snapshot = psql('SELECT row_to_json(reference)::text FROM public.exchange_rate_reference reference WHERE id = 1;')
    exchangeRateSnapshot = snapshot ? JSON.parse(snapshot) as ExchangeRateSnapshot : null
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES
        ('${actorId}', 'financial-battery-admin@example.test'),
        ('${portalUserId}', 'financial-battery-portal@example.test'),
        ('${equipmentUserId}', 'financial-battery-equipment@example.test')
      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${actorId}', 'Financial Battery Admin', 'admin', true),
        ('${equipmentUserId}', 'Financial Battery Equipamentos', 'equipamentos', true)
      ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = true;
      INSERT INTO public.customers (id, cnpj_cpf, name)
      VALUES (${customerId}, '${customerCnpj}', 'Cliente Financial Battery')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, cnpj_cpf = EXCLUDED.cnpj_cpf;
      INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary, origin)
      VALUES (${customerId}, 'Financeiro Synthetic', '${financialContactEmail}', 'financeiro', true, 'sistema')
      ON CONFLICT DO NOTHING;
      INSERT INTO public.customer_contact_box_links (contact_id, box_code)
      SELECT id, box_code FROM public.customer_contacts, (VALUES ('demurrage'), ('financeiro')) AS boxes(box_code)
      WHERE customer_id = ${customerId}
      ON CONFLICT DO NOTHING;
      INSERT INTO public.customer_portal_accounts (
        customer_id, contact_email, portal_email, login_cnpj, active, created_by,
        auth_user_id, provisioning_decision, account_situation, recovery_email,
        recovery_email_source, recovery_email_status
      ) VALUES (
        ${customerId}, '${financialContactEmail}', '${financialContactEmail}', '${customerCnpj}', true, '${actorId}',
        '${portalUserId}', 'aprovado_para_provisionar', 'ativo', '${financialContactEmail}',
        'informado_manualmente', 'ok'
      )
      ON CONFLICT (customer_id) DO UPDATE SET
        contact_email = EXCLUDED.contact_email,
        portal_email = EXCLUDED.portal_email,
        login_cnpj = EXCLUDED.login_cnpj,
        active = true,
        created_by = EXCLUDED.created_by,
        auth_user_id = EXCLUDED.auth_user_id,
        provisioning_decision = EXCLUDED.provisioning_decision,
        account_situation = EXCLUDED.account_situation,
        recovery_email = EXCLUDED.recovery_email,
        recovery_email_source = EXCLUDED.recovery_email_source,
        recovery_email_status = EXCLUDED.recovery_email_status;
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier Financial Battery')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel Financial Battery', ${carrierId})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, carrier_id = EXCLUDED.carrier_id;
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'FIN-BATTERY', 'active')
      ON CONFLICT (id) DO UPDATE SET vessel_id = EXCLUDED.vessel_id, status = EXCLUDED.status;
      INSERT INTO public.bls (
        id, voyage_id, customer_id, cargo_mode, pod, financial_status, review_status,
        charge_status, customer_reconciliation_status, ce_mercante
      ) VALUES
        ${allBlIds.map((blId, index) => `('${blId}', ${voyageId}, ${customerId}, 'container', 'BRFIN', 'invoiced', 'ok', 'ready_for_billing', 'reconciled', 'CE-FIN-${index + 1}')`).join(',\n        ')}
      ON CONFLICT (id) DO UPDATE SET
        voyage_id = EXCLUDED.voyage_id,
        customer_id = EXCLUDED.customer_id,
        financial_status = EXCLUDED.financial_status,
        review_status = EXCLUDED.review_status,
        charge_status = EXCLUDED.charge_status,
        customer_reconciliation_status = EXCLUDED.customer_reconciliation_status,
        ce_mercante = EXCLUDED.ce_mercante;
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
      VALUES (${chargeTableId}, 'Tabela Financial Battery', 'BRFIN', CURRENT_DATE, true, 'container')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.charge_table_items (
        id, charge_table_id, name, applies_to, value_brl, unit_value_brl,
        application_basis, category, cargo_profile, currency
      ) VALUES (
        ${chargeItemId}, ${chargeTableId}, 'Taxa Financial Battery', 'bl', 100,
        100, 'bl', 'base', 'any', 'BRL'
      ) ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.invoices (
        id, invoice_number, customer_id, bl_id, total_brl, total_paid_brl,
        balance_brl, status, invoice_type, issued_by
      ) VALUES
        ${localInvoiceIds.map((id, index) => `(${id}, 'FIN-BAT-IND-${index + 1}', ${customerId}, '${localBlIds[index]}', 100, 0, 100, 'issued', 'individual', '${actorId}')`).join(',\n        ')};
      INSERT INTO public.invoice_bls (
        invoice_id, bl_id, charge_status_snapshot, financial_status_snapshot, subtotal_brl
      ) VALUES
        ${localInvoiceIds.map((id, index) => `(${id}, '${localBlIds[index]}', 'ready_for_billing', 'invoiced', 100)`).join(',\n        ')};
      INSERT INTO public.bl_receivables (
        id, bl_id, customer_id, source, original_amount_brl, settled_amount_brl,
        balance_brl, status, voyage_id, cargo_mode
      ) VALUES
        ${receivableIds.map((id, index) => `(${id}, '${localBlIds[index]}', ${customerId}, 'local_charges', 100, 0, 100, 'open', ${voyageId}, 'container')`).join(',\n        ')};
      INSERT INTO public.invoice_receivable_links (invoice_id, receivable_id, bl_id, subtotal_brl, status)
      VALUES
        ${localInvoiceIds.map((id, index) => `(${id}, ${receivableIds[index]}, '${localBlIds[index]}', 100, 'active')`).join(',\n        ')};
      INSERT INTO public.charge_calculations (
        id, bl_id, charge_table_id, charge_item_id, quantity, unit_value_brl,
        total_value_brl, source, status, calculation_key, created_by, calculated_at
      ) VALUES
        (${chargeCalculationIds[0]}, '${localBlIds[0]}', ${chargeTableId}, ${chargeItemId}, 1, 100, 100, 'manual', 'ready_for_billing', 'fin-battery:one', '${actorId}', now()),
        (${chargeCalculationIds[1]}, '${localBlIds[1]}', ${chargeTableId}, ${chargeItemId}, 1, 100, 100, 'manual', 'ready_for_billing', 'fin-battery:two', '${actorId}', now());
      INSERT INTO public.bl_containers (id, bl_id, container_number, type, return_date)
      VALUES
        (${demurrageContainerIds[0]}, '${demurrageBlIds[0]}', 'MSCU1234501', '20GP', '2026-08-20'),
        (${demurrageContainerIds[1]}, '${demurrageBlIds[1]}', 'MSCU1234502', '20GP', '2026-08-20');
      INSERT INTO public.demurrage_invoices (
        id, doc_number, bl_id, customer_id, doc_date, due_date, billed_at,
        first_billed_at, ready_at, total_usd, roe, roe_manual, current_roe,
        current_total_brl, roe_source, pix_payload, dispute_open, status, paid_at
      ) VALUES
        (${demurrageInvoiceIds[0]}, 'S15-DEM-OPEN', '${demurrageBlIds[0]}', ${customerId}, '2026-09-01', '2026-09-10', '2026-09-01',
          '2026-09-01', '2026-09-01', 100, 5.5, true, 5.5, 550, 'manual', public.build_transshipping_pix_payload(550, 'S15-DEM-OPEN'), false, 'issued', NULL),
        (${demurrageInvoiceIds[1]}, 'S15-DEM-PAID', '${demurrageBlIds[1]}', ${customerId}, '2026-09-01', '2026-09-10', '2026-09-01',
          '2026-09-01', '2026-09-01', 100, 5.5, true, 5.5, 550, 'manual', public.build_transshipping_pix_payload(550, 'S15-DEM-PAID'), false, 'paid', '2026-09-05');
      INSERT INTO public.demurrage_invoice_items (
        id, invoice_id, container_id, container_number, container_type, discharge_date,
        return_date, total_days, free_days, days_p1, rate_p1_usd, days_p2,
        rate_p2_usd, subtotal_usd, subtotal_brl
      ) VALUES
        (${demurrageItemIds[0]}, ${demurrageInvoiceIds[0]}, ${demurrageContainerIds[0]}, 'MSCU1234501', '20GP', '2026-08-01', '2026-08-20', 19, 7, 12, 100.0 / 12, 0, 0, 100, 550),
        (${demurrageItemIds[1]}, ${demurrageInvoiceIds[1]}, ${demurrageContainerIds[1]}, 'MSCU1234502', '20GP', '2026-08-01', '2026-08-20', 19, 7, 12, 100.0 / 12, 0, 0, 100, 550);
      INSERT INTO public.demurrage_invoice_history
        (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
      VALUES
        (${demurrageInvoiceIds[0]}, '2026-09-01', 5.1643, 5.5, 100, 550, 0, 'manual'),
        (${demurrageInvoiceIds[1]}, '2026-09-01', 5.1643, 5.5, 100, 550, 0, 'manual');
    `)
  })

  afterAll(() => {
    psql(`
      DELETE FROM public.exchange_rate_reference_history
      WHERE source = 'bcb_live' AND ptax = 6.0 AND roe = 6.3900 AND effective_date = '2026-09-16';
      ${exchangeRateSnapshot
        ? `INSERT INTO public.exchange_rate_reference(id, ptax, roe, effective_date, updated_at, source, quote_date, spread_version)
             VALUES (1, ${exchangeRateSnapshot.ptax == null ? 'NULL' : exchangeRateSnapshot.ptax}, ${exchangeRateSnapshot.roe}, '${exchangeRateSnapshot.effective_date}', now(), '${exchangeRateSnapshot.source}', ${exchangeRateSnapshot.quote_date ? `'${exchangeRateSnapshot.quote_date}'` : 'NULL'}, ${exchangeRateSnapshot.spread_version})
             ON CONFLICT (id) DO UPDATE SET ptax = EXCLUDED.ptax, roe = EXCLUDED.roe, effective_date = EXCLUDED.effective_date, updated_at = EXCLUDED.updated_at, source = EXCLUDED.source, quote_date = EXCLUDED.quote_date, spread_version = EXCLUDED.spread_version;`
        : 'DELETE FROM public.exchange_rate_reference WHERE id = 1;'}
    `)
    cleanup()
  })

  it('H13 — consolida, congela rateio, cobre individuais e permite estorno/reemissao auditados', () => {
    const created = callAs(actorId, `SELECT public.create_local_consolidated_invoice(${customerId}, ARRAY[${receivableIds[0]}, ${receivableIds[1]}]::bigint[], NULL, '${actorId}'::uuid);`)
    expect(created.status, `${created.stdout}\n${created.stderr}`).toBe(0)
    const createdPayload = JSON.parse(lastJson(created.stdout)) as { invoice_id: number; invoice_type: string; total_brl: number }
    const consolidatedId = createdPayload.invoice_id

    expect(createdPayload).toMatchObject({ invoice_type: 'consolidated', total_brl: 200 })
    expect(psql(`SELECT invoice_type || '|' || status || '|' || total_brl::text || '|' || (pix_payload IS NOT NULL) FROM public.invoices WHERE id = ${consolidatedId};`)).toBe('consolidated|issued|200.00|true')
    expect(psql(`SELECT count(*) FROM public.invoice_receivable_links WHERE invoice_id = ${consolidatedId} AND status = 'active';`)).toBe('2')
    expect(psql(`SELECT count(*) || '|' || COALESCE(sum(total_value_brl), 0)::text || '|' || count(*) FILTER (WHERE (snapshot_payload->>'reconciled')::boolean) FROM public.invoice_items WHERE invoice_id = ${consolidatedId};`)).toBe('2|200.00|2')

    expectFailure(actorId, `SELECT public.create_local_consolidated_invoice(${customerId}, ARRAY[${receivableIds[0]}, ${receivableIds[1]}]::bigint[], NULL, '${actorId}'::uuid);`)
    expectFailure(actorId, `SELECT public.cancel_invoice(${consolidatedId}, '   ', '${actorId}'::uuid);`)

    const paid = callAs(actorId, `SELECT public.register_ledger_invoice_payment(${consolidatedId}, 200, 'ted', '2026-09-08T12:00:00Z', NULL, 'manual', 'H13 consolidada', '${actorId}'::uuid);`)
    expect(paid.status, `${paid.stdout}\n${paid.stderr}`).toBe(0)
    expect(JSON.parse(lastJson(paid.stdout))).toMatchObject({ status: 'paid', balance_brl: 0, individuals_covered: 2 })
    expect(psql(`SELECT string_agg(status, ',' ORDER BY id) FROM public.invoices WHERE id = ANY(ARRAY[${consolidatedId}, ${localInvoiceIds[0]}, ${localInvoiceIds[1]}]::bigint[]);`)).toBe('paid,covered,covered')
    expect(psql(`SELECT string_agg(status, ',' ORDER BY receivable_id) FROM public.invoice_receivable_links WHERE invoice_id IN (${localInvoiceIds[0]}, ${localInvoiceIds[1]});`)).toBe('settled_elsewhere,settled_elsewhere')
    expect(psql(`SELECT string_agg(financial_status, ',' ORDER BY id) FROM public.bls WHERE id IN ('${localBlIds[0]}', '${localBlIds[1]}');`)).toBe('paid,paid')

    const paymentId = Number(JSON.parse(lastJson(paid.stdout)).payment_id)
    const reversed = callAs(actorId, `SELECT public.reverse_invoice_payment(${paymentId}, 'H13 estorno de teste', '${actorId}'::uuid);`)
    expect(reversed.status, `${reversed.stdout}\n${reversed.stderr}`).toBe(0)
    expect(JSON.parse(lastJson(reversed.stdout))).toMatchObject({ invoice_id: consolidatedId, new_status: 'issued' })
    expect(psql(`SELECT string_agg(status, ',' ORDER BY id) FROM public.invoices WHERE id = ANY(ARRAY[${consolidatedId}, ${localInvoiceIds[0]}, ${localInvoiceIds[1]}]::bigint[]);`)).toBe('issued,issued,issued')
    expect(psql(`SELECT string_agg(status, ',' ORDER BY receivable_id) FROM public.invoice_receivable_links WHERE invoice_id IN (${localInvoiceIds[0]}, ${localInvoiceIds[1]});`)).toBe('active,active')
    expect(psql(`SELECT string_agg(financial_status, ',' ORDER BY id) FROM public.bls WHERE id IN ('${localBlIds[0]}', '${localBlIds[1]}');`)).toBe('invoiced,invoiced')

    const cancelled = callAs(actorId, `SELECT public.cancel_invoice(${consolidatedId}, 'H13 encerramento por reemissao', '${actorId}'::uuid);`)
    expect(cancelled.status, `${cancelled.stdout}\n${cancelled.stderr}`).toBe(0)
    expect(JSON.parse(lastJson(cancelled.stdout))).toMatchObject({ status: 'cancelled', changed: true })
    expect(psql(`SELECT status FROM public.invoices WHERE id = ${consolidatedId};`)).toBe('cancelled')
    expect(psql(`SELECT string_agg(financial_status, ',' ORDER BY id) FROM public.bls WHERE id IN ('${localBlIds[0]}', '${localBlIds[1]}');`)).toBe('invoiced,invoiced')

    const reissued = callAs(actorId, `SELECT public.create_local_consolidated_invoice(${customerId}, ARRAY[${receivableIds[0]}, ${receivableIds[1]}]::bigint[], NULL, '${actorId}'::uuid);`)
    expect(reissued.status, `${reissued.stdout}\n${reissued.stderr}`).toBe(0)
    const reissuedId = Number(JSON.parse(lastJson(reissued.stdout)).invoice_id)
    expect(psql(`SELECT invoice_type || '|' || status || '|' || total_brl::text FROM public.invoices WHERE id = ${reissuedId};`)).toBe('consolidated|issued|200.00')
    const reissuedCancelled = callAs(actorId, `SELECT public.cancel_invoice(${reissuedId}, 'H13 limpeza do cenário', '${actorId}'::uuid);`)
    expect(reissuedCancelled.status, `${reissuedCancelled.stdout}\n${reissuedCancelled.stderr}`).toBe(0)
  })

  it('H15/H16 — pausa cobrança em disputa, mas não recálculo PTAX; preserva quitada', () => {
    const opened = callAs(portalUserId, `SELECT public.portal_open_demurrage_dispute(${demurrageInvoiceIds[0]}, 'Divergência sintética de cobrança e período.');`)
    expect(opened.status, `${opened.stdout}\n${opened.stderr}`).toBe(0)
    const disputeId = Number(JSON.parse(lastJson(opened.stdout)).dispute_id)
    expect(psql(`SELECT dispute_open || '|' || dispute_status FROM public.demurrage_invoices WHERE id = ${demurrageInvoiceIds[0]};`)).toBe('true|aberto')
    expect(psql(`SELECT state || '|' || next_responder FROM public.demurrage_disputes WHERE id = ${disputeId};`)).toBe('aberta|equipamentos')
    expect(psql(`SELECT count(*) FROM public.portal_notifications WHERE customer_id = ${customerId} AND type = 'dispute_opened';`)).toBe('1')
    expect(psql(`SELECT count(*) FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id WHERE a.type = 'aggregate' AND a.entity_type = 'demurrage_invoice' AND a.entity_id = '${demurrageInvoiceIds[0]}' AND ai.item_type = 'portal_dispute_opened' AND ai.department = 'equipamentos' AND ai.status = 'active';`)).toBe('1')
    expect(psql(`SELECT has_function_privilege('authenticated', 'public.upsert_alert_item(text,text,text,text,text,text,jsonb,text)', 'EXECUTE');`)).toBe('f')

    const dunningPaused = callAs(actorId, `SELECT public.claim_demurrage_dunning_candidates('2026-09-16T12:00:00Z'::timestamptz, 50);`, 'service_role')
    expect(dunningPaused.status, `${dunningPaused.stdout}\n${dunningPaused.stderr}`).toBe(0)
    expect(lastJson(dunningPaused.stdout)).toBe('[]')

    const recalcPaused = callAs(actorId, `SELECT public.recalculate_demurrage_invoices(6.0, '2026-09-16', 'bcb_live');`, 'service_role')
    expect(recalcPaused.status, `${recalcPaused.stdout}\n${recalcPaused.stderr}`).toBe(0)
    expect(JSON.parse(lastJson(recalcPaused.stdout))).toMatchObject({ updated: 1, roe: 6.39 })
    expect(psql(`SELECT current_roe::text || '|' || current_total_brl::text FROM public.demurrage_invoices WHERE id = ${demurrageInvoiceIds[0]};`)).toBe('6.3900|639.00')
    expect(psql(`SELECT count(*) FROM public.demurrage_invoice_history WHERE invoice_id = ${demurrageInvoiceIds[0]};`)).toBe('2')

    expectFailure(equipmentUserId, `SELECT public.add_demurrage_dispute_message(${disputeId}, '   ', 'ninguem');`)
    const resolved = callAs(equipmentUserId, `SELECT public.add_demurrage_dispute_message(${disputeId}, 'Parecer emitido; cobrança mantida conforme o período.', 'ninguem');`)
    expect(resolved.status, `${resolved.stdout}\n${resolved.stderr}`).toBe(0)
    expect(psql(`SELECT state || '|' || next_responder FROM public.demurrage_disputes WHERE id = ${disputeId};`)).toBe('resolvida|ninguem')
    expect(psql(`SELECT dispute_open || '|' || dispute_status FROM public.demurrage_invoices WHERE id = ${demurrageInvoiceIds[0]};`)).toBe('false|resolvido')
    expect(psql(`SELECT count(*) FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id WHERE a.type = 'aggregate' AND a.entity_type = 'demurrage_invoice' AND a.entity_id = '${demurrageInvoiceIds[0]}' AND ai.item_type = 'portal_dispute_opened' AND ai.department = 'equipamentos' AND ai.status = 'active';`)).toBe('0')

    const recalcResolved = callAs(actorId, `SELECT public.recalculate_demurrage_invoices(6.0, '2026-09-16', 'bcb_live');`, 'service_role')
    expect(recalcResolved.status, `${recalcResolved.stdout}\n${recalcResolved.stderr}`).toBe(0)
    expect(JSON.parse(lastJson(recalcResolved.stdout))).toMatchObject({ updated: 0, roe: 6.39 })
    expect(psql(`SELECT current_roe::text || '|' || current_total_brl::text || '|' || roe_source FROM public.demurrage_invoices WHERE id = ${demurrageInvoiceIds[0]};`)).toBe('6.3900|639.00|bcb_live')
    expect(psql(`SELECT count(*) FROM public.demurrage_invoice_history WHERE invoice_id = ${demurrageInvoiceIds[0]};`)).toBe('2')
    expect(psql(`SELECT ptax_used::text || '|' || roe_used::text || '|' || total_brl::text || '|' || source FROM public.demurrage_invoice_history WHERE invoice_id = ${demurrageInvoiceIds[0]} ORDER BY id DESC LIMIT 1;`)).toBe('6.0000|6.3900|639.00|bcb_live')
    expect(psql(`SELECT current_roe::text || '|' || current_total_brl::text || '|' || roe_source FROM public.demurrage_invoices WHERE id = ${demurrageInvoiceIds[1]};`)).toBe('5.5000|550.00|manual')
    expect(psql(`SELECT count(*) FROM public.demurrage_invoice_history WHERE invoice_id = ${demurrageInvoiceIds[1]};`)).toBe('1')

    const detail = callAs(portalUserId, `SELECT public.portal_get_demurrage_invoice_detail(${demurrageInvoiceIds[0]});`)
    expect(detail.status, `${detail.stdout}\n${detail.stderr}`).toBe(0)
    const detailPayload = JSON.parse(lastJson(detail.stdout)) as { invoice: { current_roe: number; current_total_brl: number; roe_source: string }; items: unknown[] }
    expect(detailPayload.invoice).toMatchObject({ current_roe: 6.39, current_total_brl: 639, roe_source: 'bcb_live' })
    expect(detailPayload.items).toHaveLength(1)

    const dunningResumed = callAs(actorId, `SELECT public.claim_demurrage_dunning_candidates('2026-09-16T12:00:00Z'::timestamptz, 50);`, 'service_role')
    expect(dunningResumed.status, `${dunningResumed.stdout}\n${dunningResumed.stderr}`).toBe(0)
    expect(JSON.parse(lastJson(dunningResumed.stdout))).toEqual(expect.arrayContaining([
      expect.objectContaining({ invoice_id: demurrageInvoiceIds[0], attempt_discriminator: 1 }),
    ]))
  })

  it('H17 — aceita pagamentos parciais em múltiplas baixas, restitui excedente manual e rejeita PIX excedente', () => {
    const firstPartial = callAs(actorId, `SELECT public.register_ledger_invoice_payment(${localInvoiceIds[2]}, 60, 'ted', '2026-09-09T12:00:00Z', NULL, 'manual', 'H17 parcial 1', '${actorId}'::uuid);`)
    expect(firstPartial.status, `${firstPartial.stdout}\n${firstPartial.stderr}`).toBe(0)
    expect(JSON.parse(lastJson(firstPartial.stdout))).toMatchObject({ status: 'partially_paid', balance_brl: 40 })
    const secondPartial = callAs(actorId, `SELECT public.register_ledger_invoice_payment(${localInvoiceIds[2]}, 40, 'ted', '2026-09-10T12:00:00Z', NULL, 'manual', 'H17 parcial 2', '${actorId}'::uuid);`)
    expect(secondPartial.status, `${secondPartial.stdout}\n${secondPartial.stderr}`).toBe(0)
    expect(JSON.parse(lastJson(secondPartial.stdout))).toMatchObject({ status: 'paid', balance_brl: 0 })
    expect(psql(`SELECT status || '|' || balance_brl::text FROM public.invoices WHERE id = ${localInvoiceIds[2]};`)).toBe('paid|0.00')
    expect(psql(`SELECT count(*) || '|' || sum(amount_brl)::text FROM public.ledger_settlements WHERE invoice_id = ${localInvoiceIds[2]};`)).toBe('2|100.00')
    expect(psql(`SELECT financial_status FROM public.bls WHERE id = '${localBlIds[2]}';`)).toBe('paid')

    const manualOverpayment = callAs(actorId, `SELECT public.register_ledger_invoice_payment(${localInvoiceIds[3]}, 125, 'ted', '2026-09-11T12:00:00Z', NULL, 'manual', 'H17 excedente manual', '${actorId}'::uuid);`)
    expect(manualOverpayment.status, `${manualOverpayment.stdout}\n${manualOverpayment.stderr}`).toBe(0)
    const overpaymentPayload = JSON.parse(lastJson(manualOverpayment.stdout)) as { status: string; refund_due_brl: number; payment_id: number }
    expect(overpaymentPayload).toMatchObject({ status: 'paid', refund_due_brl: 25 })
    expect(psql(`SELECT status || '|' || amount_brl::text || '|' || payment_id::text FROM public.invoice_refunds WHERE invoice_id = ${localInvoiceIds[3]};`)).toBe(`pending|25.00|${overpaymentPayload.payment_id}`)
    const refundId = Number(psql(`SELECT id FROM public.invoice_refunds WHERE invoice_id = ${localInvoiceIds[3]};`))
    const settledRefund = callAs(actorId, `SELECT public.settle_invoice_refund(${refundId}, '${actorId}'::uuid);`)
    expect(settledRefund.status, `${settledRefund.stdout}\n${settledRefund.stderr}`).toBe(0)
    expect(psql(`SELECT status FROM public.invoice_refunds WHERE invoice_id = ${localInvoiceIds[3]};`)).toBe('settled')

    expectFailure(actorId, `SELECT public.register_ledger_invoice_payment(${localInvoiceIds[4]}, 125, 'pix', '2026-09-12T12:00:00Z', 'H17-PIX-OVER', 'pix_extract', 'H17 PIX excedente', '${actorId}'::uuid);`)
    expect(psql(`SELECT status || '|' || balance_brl::text FROM public.invoices WHERE id = ${localInvoiceIds[4]};`)).toBe('issued|100.00')
    expect(psql(`SELECT count(*) FROM public.payments WHERE invoice_id = ${localInvoiceIds[4]};`)).toBe('0')
    expect(psql(`SELECT count(*) FROM public.invoice_refunds WHERE invoice_id = ${localInvoiceIds[4]};`)).toBe('0')
  })
})
