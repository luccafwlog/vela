import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

// Migrations 123/124/128 (ADR 0077): avulsa com item da tabela e o núcleo que
// a correção do B/L usa em fatura com pagamento (abate o saldo, restitui o
// excedente). O disparo pela correção está em invoiceBasisCorrection.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000124001'

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`], { encoding: 'utf8' }).trim()
}

const describeLocal = enabled ? describe : describe.skip

const customerId = 99212401
const carrierId = 99212402
const vesselId = 99212403
const voyageId = 99212404
const blIds = ['R124-BL-1', 'R124-BL-2', 'R124-BL-3', 'R124-BL-4']
const invoiceIds = [99212411, 99212412, 99212413, 99212414]
const receivableIds = [99212421, 99212422, 99212423, 99212424]
const customerCnpj = syntheticCnpj(124001)

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

// Núcleo do sistema: sem RPC pública desde a 128.
function correct(invoiceId: number, receivableId: number, total: number, reason: string) {
  return JSON.parse(psql(`SELECT public._register_invoice_correction_core(${invoiceId}, ${receivableId}, ${total}, '${reason}', '${actorId}'::uuid)`))
}

let initialPricingVersionIds: string[] | null = null
let exchangeRateSnapshot: string | null = null

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.invoice_corrections WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.invoice_refunds WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.ledger_settlements WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.ledger_payment_requests WHERE created_by = '${actorId}';
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE metadata->>'bl_id' LIKE 'R124-%');
    DELETE FROM public.alert_items WHERE metadata->>'bl_id' LIKE 'R124-%';
    DELETE FROM public.alerts WHERE entity_type = 'invoice' AND entity_id IN (SELECT id::text FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.charge_calculations WHERE bl_id = ANY(ARRAY['${blIds.join("','")}']::text[]);
    DELETE FROM public.pricing_rule_versions WHERE customer_id = ${customerId} OR charge_table_id = 99212450;
    DELETE FROM public.import_pending_effects WHERE entity_id IN ('${voyageId}', '${blIds.join("','")}');
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id = ANY(ARRAY['${blIds.join("','")}']::text[]);
    DELETE FROM public.customer_rate_overrides WHERE customer_id = ${customerId};
    DELETE FROM public.charge_table_items WHERE charge_table_id = 99212450;
    DELETE FROM public.charge_tables WHERE id = 99212450;
    DELETE FROM public.charge_calculations WHERE bl_id = ANY(ARRAY['${blIds.join("','")}']::text[]);
    DELETE FROM public.invoice_lifecycle_events WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.invoice_receivable_links WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.invoice_bls WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.payments WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.billing_batches WHERE customer_id = ${customerId};
    DELETE FROM public.invoices WHERE customer_id = ${customerId};
    ${initialPricingVersionIds === null ? '' : `DELETE FROM public.pricing_rule_versions p WHERE p.id <> ALL(ARRAY[${initialPricingVersionIds.join(',')}]::bigint[]) AND NOT EXISTS (SELECT 1 FROM public.invoice_items i WHERE i.pricing_rule_version_id = p.id) AND NOT EXISTS (SELECT 1 FROM public.charge_calculations c WHERE c.pricing_rule_version_id = p.id);`}
    DELETE FROM public.bl_receivables WHERE customer_id = ${customerId};
    DELETE FROM public.baplie_containers WHERE voyage_id = ${voyageId};
    DELETE FROM public.bl_containers WHERE bl_id = ANY(ARRAY['${blIds.join("','")}']::text[]);
    DELETE FROM public.charge_calculations WHERE bl_id LIKE 'R124-%';
    DELETE FROM public.bls WHERE id = ANY(ARRAY['${blIds.join("','")}', 'R124-BL-5']::text[]);
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.portal_provisioning_events WHERE customer_id = ${customerId};
    DELETE FROM public.customer_portal_accounts WHERE customer_id = ${customerId};
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.audit_logs WHERE changed_by = '${actorId}';
    DELETE FROM public.user_profiles WHERE id = '${actorId}';
    DELETE FROM auth.users WHERE id = '${actorId}';
    SET session_replication_role = origin;
  `)
}

describeLocal('123/124 — avulsa da tabela, abatimento guiado e restituição por correção', () => {
  beforeAll(() => {
    initialPricingVersionIds = psql('SELECT id FROM public.pricing_rule_versions ORDER BY id').split('\n').filter(Boolean)
    exchangeRateSnapshot = psql('SELECT row_to_json(r)::text FROM public.exchange_rate_reference r WHERE id = 1;') || null
    cleanup()
    expect(psql(`SELECT to_regproc('public._register_invoice_correction_core') IS NOT NULL;`)).toBe('t')
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'reissue-124@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active)
        VALUES ('${actorId}', 'Administrativo 124', 'administrativo', true)
        ON CONFLICT (id) DO UPDATE SET role = 'administrativo', active = true;
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '${customerCnpj}', 'Cliente 124');
      UPDATE public.customer_portal_accounts
        SET active = true, account_situation = 'ativo', recovery_email = 'portal-124@example.test', recovery_email_status = 'ok',
            auth_user_id = '${actorId}'::uuid
        WHERE customer_id = ${customerId};
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier 124');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel 124', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'R124', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode, pod, financial_status, review_status, charge_status, customer_reconciliation_status, ce_mercante)
      VALUES ${blIds.map((bl, i) => `('${bl}', ${voyageId}, ${customerId}, 'container', 'BRSSZ', 'invoiced', 'ok', 'ready_for_billing', 'reconciled', 'CE-124-${i}')`).join(', ')};
      -- Containers antes das faturas: inserir carga em B/L faturado já é uma correção (128).
      INSERT INTO public.bl_containers(bl_id, container_number, type) VALUES ('${blIds[0]}', 'TSTU1240001', '22G1'), ('${blIds[0]}', 'TSTU1240002', '42G1');
      INSERT INTO public.invoices (id, invoice_number, customer_id, bl_id, total_brl, total_paid_brl, balance_brl, status, invoice_type, issued_by, issued_at)
      VALUES ${invoiceIds.map((id, i) => `(${id}, 'R124-IND-${i + 1}', ${customerId}, '${blIds[i]}', 100, 0, 100, 'issued', 'individual', '${actorId}', now())`).join(', ')};
      INSERT INTO public.invoice_bls (invoice_id, bl_id, charge_status_snapshot, financial_status_snapshot, subtotal_brl)
      VALUES ${invoiceIds.map((id, i) => `(${id}, '${blIds[i]}', 'ready_for_billing', 'invoiced', 100)`).join(', ')};
      INSERT INTO public.bl_receivables (id, bl_id, customer_id, source, original_amount_brl, settled_amount_brl, balance_brl, status, voyage_id, cargo_mode)
      VALUES ${receivableIds.map((id, i) => `(${id}, '${blIds[i]}', ${customerId}, 'local_charges', 100, 0, 100, 'open', ${voyageId}, 'container')`).join(', ')};
      INSERT INTO public.invoice_receivable_links (invoice_id, receivable_id, bl_id, subtotal_brl, status)
      VALUES ${invoiceIds.map((id, i) => `(${id}, ${receivableIds[i]}, '${blIds[i]}', 100, 'active')`).join(', ')};
      -- ROE com quatro casas: 150 USD × ROE tem terceira casa e expõe a
      -- diferença entre quantidade × unitário e o total convertido.
      INSERT INTO public.exchange_rate_reference(id, roe, ptax, effective_date) VALUES (1, 5.4321, 5.1, current_date)
        ON CONFLICT(id) DO UPDATE SET roe = EXCLUDED.roe, ptax = EXCLUDED.ptax, effective_date = EXCLUDED.effective_date;
      INSERT INTO public.charge_tables(id, name, cargo_mode, pod, valid_from, active)
        VALUES (99212450, 'Tarifa de correcao', 'container', 'BRSSZ', '2020-01-01', true);
      INSERT INTO public.charge_table_items(id, charge_table_id, name, application_basis, applies_to, currency, unit_value_brl, unit_value_usd, value_brl, manual_only, active)
        VALUES (99212451, 99212450, 'Correction Letter', 'bl', 'bl', 'BRL', 600, NULL, 600, true, true),
        (99212452, 99212450, 'Booking Cancelation Fee', 'teu', 'teu', 'USD', NULL, 150, 0, true, true);
    `)
  })

  afterAll(() => {
    // Restaura o câmbio global que este teste fixou, antes de remover o ator
    // que a auditoria da tabela registra.
    psql(exchangeRateSnapshot
      ? `UPDATE public.exchange_rate_reference r SET roe = s.roe, ptax = s.ptax, effective_date = s.effective_date
           FROM json_populate_record(NULL::public.exchange_rate_reference, '${exchangeRateSnapshot}'::json) s WHERE r.id = 1;`
      : 'DELETE FROM public.exchange_rate_reference WHERE id = 1;')
    cleanup()
  })


  it('resolve o valor da tabela, override, USD/TEU e ignora valores do navegador', () => {
    const quote = adminJson<{total_brl: number; quantity: number}>(`SELECT public.quote_manual_invoice_charge('${blIds[0]}', 99212451)`)
    expect(quote.total_brl).toBe(600)
    psql(`INSERT INTO public.customer_rate_overrides(customer_id, charge_item_id, override_value, valid_from, active) VALUES (${customerId}, 99212451, 450, '2020-01-01', true);`)
    const issued = adminJson<{invoice_id: number; total_brl: number}>(`SELECT public.create_manual_invoice(${customerId}, 'Valor adulterado', 9, 1, NULL, '${blIds[0]}', NULL, NULL, 99212451)`)
    expect(issued.total_brl).toBe(450)
    expect(psql(`SELECT charge_item_id || '|' || (snapshot_payload->>'override_id' IS NOT NULL) FROM public.invoice_items WHERE invoice_id = ${issued.invoice_id};`)).toBe('99212451|true')
    expect(asAdmin(`SELECT public.create_manual_invoice(${customerId}, 'x', 1, 1, NULL, NULL, NULL, NULL, 99212451)`).stderr).toMatch(/B.L obrigatorio/)
    expect(asAdmin(`SELECT public.create_manual_invoice(${customerId}+1, 'x', 1, 1, NULL, '${blIds[0]}', NULL, NULL, 99212451)`).stderr).toMatch(/nao pertence/)
    const usd = adminJson<{quantity: number; roe: number; total_brl: number}>(`SELECT public.quote_manual_invoice_charge('${blIds[0]}', 99212452)`)
    expect(usd.quantity).toBe(3)
    expect(usd.total_brl).toBe(Math.round(450 * usd.roe * 100) / 100)
    const manual = adminJson<{invoice_id: number; total_brl: number}>(`SELECT public.create_manual_invoice(${customerId}, 'x', 1, 1, NULL, '${blIds[0]}', NULL, NULL, 99212452)`)
    expect(manual.total_brl).toBe(usd.total_brl)
    expect(Number(psql(`SELECT snapshot_payload->>'roe' FROM public.invoice_items WHERE invoice_id = ${manual.invoice_id}`))).toBe(usd.roe)
    // O Pix cobra o total da fatura, não o total do INSERT anterior ao snapshot.
    expect(psql(`SELECT pix_payload = public.build_transshipping_pix_payload(total_brl, invoice_number) FROM public.invoices WHERE id = ${manual.invoice_id}`)).toBe('t')
    expect(psql(`SELECT count(*) FROM public.invoice_receivable_links WHERE invoice_id = ${manual.invoice_id}`)).toBe('0')
    expect(psql(`SELECT count(*) FROM public._portal_list_invoices_core(${customerId}) WHERE id = ${manual.invoice_id}`)).toBe('1')
  })
  it('parcial: abate saldo e permite pagar somente o restante sem alterar a fatura', () => {
    adminJson(`SELECT public.register_ledger_invoice_payment(${invoiceIds[0]}, 40)`)
    const correction = correct(invoiceIds[0], receivableIds[0], 80, 'Peso correto')
    expect(correction).toMatchObject({offset_brl: 20, refund_brl: 0, balance_brl: 40})
    expect(psql(`SELECT total_brl || '|' || total_paid_brl || '|' || balance_brl FROM public.invoices WHERE id = ${invoiceIds[0]}`)).toBe('100.00|40.00|40.00')
    expect(asAdmin(`SELECT public.register_ledger_invoice_payment(${invoiceIds[0]}, 41, 'pix', now(), NULL, 'pix_extract')`).stderr).toMatch(/excede/)
    adminJson(`SELECT public.register_ledger_invoice_payment(${invoiceIds[0]}, 40)`)
    expect(psql(`SELECT status || '|' || balance_brl FROM public.invoices WHERE id = ${invoiceIds[0]}`)).toBe('paid|0.00')
  })
  it('abate primeiro o saldo e restitui apenas o que já foi recebido a mais; liquida pela RPC existente', () => {
    adminJson(`SELECT public.register_ledger_invoice_payment(${invoiceIds[1]}, 90)`)
    expect(correct(invoiceIds[1], receivableIds[1], 80, 'Correcao de valor')).toMatchObject({offset_brl: 10, refund_brl: 10, balance_brl: 0})
    const refund = Number(psql(`SELECT id FROM public.invoice_refunds WHERE invoice_id = ${invoiceIds[1]}`))
    expect(psql(`SELECT origin || '|' || notes FROM public.invoice_refunds WHERE id = ${refund}`)).toBe('correction|Correcao de valor')
    expect(psql(`SELECT count(*) FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id
      WHERE ai.item_type = 'restituicao_pendente' AND ai.status = 'active' AND a.entity_id = '${invoiceIds[1]}'`)).toBe('1')
    expect(adminJson(`SELECT public.settle_invoice_refund(${refund})`)).toMatchObject({status: 'settled'})
    const payment = psql(`SELECT id FROM public.payments WHERE invoice_id = ${invoiceIds[1]}`)
    expect(asAdmin(`SELECT public.reverse_invoice_payment(${payment}, 'Baixa incorreta')`).stderr).toMatch(/restituicao por correcao/)
    expect(asAdmin(`SELECT public.register_invoice_correction_refund(${invoiceIds[1]}, 100, 'x')`).stderr).toMatch(/permission denied/)
    expect(() => correct(invoiceIds[1], receivableIds[1], 90, 'xpto')).toThrow(/menor/)
    expect(asAdmin(`SELECT public._register_invoice_correction_core(${invoiceIds[1]}, ${receivableIds[1]}, 50, 'xpto', NULL)`).stderr).toMatch(/permission denied/)
    // A restituição abre o alerta e a confirmação dela o fecha.
    expect(psql(`SELECT count(*) FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id
      WHERE ai.item_type = 'restituicao_pendente' AND ai.status = 'active' AND a.entity_id = '${invoiceIds[1]}'`)).toBe('0')
    const portal = JSON.parse(psql(`SELECT public._portal_invoice_details_core(${customerId}, ${invoiceIds[1]})`))
    expect(portal.corrections[0]).toMatchObject({offset_brl: 10, refund_brl: 10})
  })
  it('fatura com correção registrada não é cancelada, mesmo depois de estornar a baixa', () => {
    // Sem a trava, o abatimento ficaria no recebível depois do cancelamento e a
    // reemissão cobraria o B/L recalculado menos uma correção já superada.
    psql(`
      INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode, pod, financial_status, review_status, charge_status, customer_reconciliation_status, ce_mercante)
        VALUES ('R124-BL-5', ${voyageId}, ${customerId}, 'container', 'BRSSZ', 'invoiced', 'ok', 'ready_for_billing', 'reconciled', 'CE-124-5');
      INSERT INTO public.invoices (id, invoice_number, customer_id, bl_id, total_brl, total_paid_brl, balance_brl, status, invoice_type, issued_by, issued_at)
        VALUES (99212415, 'R124-IND-5', ${customerId}, 'R124-BL-5', 100, 0, 100, 'issued', 'individual', '${actorId}', now());
      INSERT INTO public.invoice_bls (invoice_id, bl_id, charge_status_snapshot, financial_status_snapshot, subtotal_brl)
        VALUES (99212415, 'R124-BL-5', 'ready_for_billing', 'invoiced', 100);
      INSERT INTO public.bl_receivables (id, bl_id, customer_id, source, original_amount_brl, settled_amount_brl, balance_brl, status, voyage_id, cargo_mode)
        VALUES (99212425, 'R124-BL-5', ${customerId}, 'local_charges', 100, 0, 100, 'open', ${voyageId}, 'container');
      INSERT INTO public.invoice_receivable_links (invoice_id, receivable_id, bl_id, subtotal_brl, status)
        VALUES (99212415, 99212425, 'R124-BL-5', 100, 'active');
    `)
    adminJson(`SELECT public.register_ledger_invoice_payment(99212415, 40)`)
    correct(99212415, 99212425, 80, 'Peso correto')
    const payment = psql(`SELECT id FROM public.payments WHERE invoice_id = 99212415`)
    const reversal = asAdmin(`SELECT public.reverse_invoice_payment(${payment}, 'Baixa lancada na fatura errada')`)
    expect(reversal.status, reversal.stderr).toBe(0)
    expect(psql(`SELECT balance_brl FROM public.bl_receivables WHERE id = 99212425`)).toBe('80.00')
    expect(asAdmin(`SELECT public.cancel_invoice(99212415, 'Cancelamento simples', NULL)`).stderr).toMatch(/corre..o registrada/)
    expect(psql(`SELECT status FROM public.invoices WHERE id = 99212415`)).not.toBe('cancelled')
  })
  it('sem usuário ativo não lê as correções', () => {
    psql(`SET session_replication_role = replica; UPDATE public.user_profiles SET active = false WHERE id = '${actorId}'; SET session_replication_role = origin;`)
    expect(asAdmin(`SELECT public.get_invoice_correction_summary(${invoiceIds[0]})`).status).not.toBe(0)
    psql(`SET session_replication_role = replica; UPDATE public.user_profiles SET role = 'administrativo', active = true WHERE id = '${actorId}'; SET session_replication_role = origin;`)
  })
  it('consolidada parcialmente paga corrige só o B/L selecionado e preserva o restante', () => {
    const consolidated = adminJson<{invoice_id: number}>(`SELECT public.create_local_consolidated_invoice(${customerId}, ARRAY[${receivableIds[2]}, ${receivableIds[3]}]::bigint[], NULL, '${actorId}'::uuid)`)
    adminJson(`SELECT public.register_ledger_invoice_payment(${consolidated.invoice_id}, 40)`)
    expect(correct(consolidated.invoice_id, receivableIds[2], 80, 'Peso correto na consolidada')).toMatchObject({offset_brl: 20, refund_brl: 0, balance_brl: 40})
    expect(psql(`SELECT total_brl || '|' || balance_brl FROM public.invoices WHERE id = ${consolidated.invoice_id}`)).toBe('200.00|140.00')
    expect(psql(`SELECT balance_brl FROM public.bl_receivables WHERE id = ${receivableIds[3]}`)).toBe('100.00')
    expect(psql(`SELECT balance_brl FROM public._portal_list_invoices_core(${customerId}) WHERE id = ${consolidated.invoice_id}`)).toBe('140.00')
    expect(adminJson(`SELECT public.get_invoice_correction_summary(${consolidated.invoice_id})`)).toHaveProperty('corrections')
  })
  it('resolução manual da Fatura desatualizada exige justificativa', () => {
    psql(`SELECT public.alert_stale_invoice_for_bl('${blIds[0]}', 'teste');`)
    expect(asAdmin(`SELECT public.resolve_stale_invoice(${invoiceIds[0]}, '')`).stderr).toMatch(/justificativa/)
    asAdmin(`SELECT public.resolve_stale_invoice(${invoiceIds[0]}, 'Avulsa da diferenca emitida')`)
    expect(psql(`SELECT status FROM public.alert_items WHERE item_type = 'fatura_desatualizada' AND metadata->>'invoice_id' = '${invoiceIds[0]}'`)).toBe('resolved')
  })
})
