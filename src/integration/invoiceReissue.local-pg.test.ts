import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

// Migrations 122 e 128 (ADR 0077): fatura emitida não muda de valor; a
// reemissão aponta para a cancelada e a pendência some quando não há o que
// reemitir. O cancelamento em si é automático (invoiceBasisCorrection).

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000121001'

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`], { encoding: 'utf8' }).trim()
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regproc('public._close_pending_reissue') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = migrationApplied() ? describe : describe.skip

const customerId = 99212101
const carrierId = 99212102
const vesselId = 99212103
const voyageId = 99212104
const blIds = ['R121-BL-1', 'R121-BL-2', 'R121-BL-3', 'R121-BL-4']
const invoiceIds = [99212111, 99212112, 99212113, 99212114]
const receivableIds = [99212121, 99212122, 99212123, 99212124]
const customerCnpj = syntheticCnpj(121001)

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

let initialPricingVersionIds: string[] | null = null

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT ai.id FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id
      WHERE a.entity_type = 'invoice' AND a.entity_id IN (SELECT id::text FROM public.invoices WHERE customer_id = ${customerId}));
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_type = 'invoice'
      AND entity_id IN (SELECT id::text FROM public.invoices WHERE customer_id = ${customerId}));
    DELETE FROM public.alerts WHERE entity_type = 'invoice' AND entity_id IN (SELECT id::text FROM public.invoices WHERE customer_id = ${customerId});
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
    DELETE FROM public.bls WHERE id = ANY(ARRAY['${blIds.join("','")}']::text[]);
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

describeLocal('122/128 — fatura emitida não muda de valor; vínculo e fim da Reemissão pendente', () => {
  beforeAll(() => {
    initialPricingVersionIds = psql('SELECT id FROM public.pricing_rule_versions ORDER BY id').split('\n').filter(Boolean)
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'reissue-121@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active)
        VALUES ('${actorId}', 'Administrativo 121', 'administrativo', true)
        ON CONFLICT (id) DO UPDATE SET role = 'administrativo', active = true;
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '${customerCnpj}', 'Cliente 121');
      UPDATE public.customer_portal_accounts
        SET active = true, account_situation = 'ativo', recovery_email = 'portal-121@example.test', recovery_email_status = 'ok',
            auth_user_id = '${actorId}'::uuid
        WHERE customer_id = ${customerId};
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier 121');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel 121', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'R121', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode, pod, financial_status, review_status, charge_status, customer_reconciliation_status, ce_mercante)
      VALUES ${blIds.map((bl, i) => `('${bl}', ${voyageId}, ${customerId}, 'container', 'BRSSZ', 'invoiced', 'ok', 'ready_for_billing', 'reconciled', 'CE-121-${i}')`).join(', ')};
      INSERT INTO public.invoices (id, invoice_number, customer_id, bl_id, total_brl, total_paid_brl, balance_brl, status, invoice_type, issued_by, issued_at)
      VALUES ${invoiceIds.map((id, i) => `(${id}, 'R121-IND-${i + 1}', ${customerId}, '${blIds[i]}', 100, 0, 100, 'issued', 'individual', '${actorId}', now())`).join(', ')};
      INSERT INTO public.invoice_bls (invoice_id, bl_id, charge_status_snapshot, financial_status_snapshot, subtotal_brl)
      VALUES ${invoiceIds.map((id, i) => `(${id}, '${blIds[i]}', 'ready_for_billing', 'invoiced', 100)`).join(', ')};
      INSERT INTO public.bl_receivables (id, bl_id, customer_id, source, original_amount_brl, settled_amount_brl, balance_brl, status, voyage_id, cargo_mode)
      VALUES ${receivableIds.map((id, i) => `(${id}, '${blIds[i]}', ${customerId}, 'local_charges', 100, 0, 100, 'open', ${voyageId}, 'container')`).join(', ')};
      INSERT INTO public.invoice_receivable_links (invoice_id, receivable_id, bl_id, subtotal_brl, status)
      VALUES ${invoiceIds.map((id, i) => `(${id}, ${receivableIds[i]}, '${blIds[i]}', 100, 'active')`).join(', ')};
    `)
  })

  afterAll(cleanup)

  // A correção do B/L deixa a fatura assim; aqui o estado é montado direto.
  function markPending(invoiceId: number) {
    psql(`UPDATE public.invoices SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'Correcao do B/L',
      reissue_requested_at = now() WHERE id = ${invoiceId};`)
  }

  function pendingIds() {
    return asAdmin(`SELECT invoice_id FROM public.list_pending_reissues() WHERE customer_id = ${customerId}`).stdout.split('\n')
  }

  it('recusa no banco a edição de itens de fatura emitida e não tem caminho manual de correção', () => {
    const add = asAdmin(`SELECT public.add_manual_invoice_charge(${invoiceIds[0]}, 'Correction Letter', 1, 600, NULL, NULL)`)
    const remove = asAdmin(`SELECT public.delete_manual_invoice_charge(1, NULL)`)
    expect(add.status).not.toBe(0)
    expect(add.stderr).toMatch(/permission denied/)
    expect(remove.stderr).toMatch(/permission denied/)
    // 127: Marcar revisado saiu; a RPC não aceita chamada direta.
    expect(asAdmin(`SELECT public.mark_bl_charges_reviewed('${blIds[0]}', NULL)`).stderr).toMatch(/permission denied/)
    // 128: Cancelar e reemitir e a correção digitada deixaram de existir.
    expect(psql(`SELECT to_regprocedure('public.cancel_invoice_for_reissue(bigint, text, text[])') IS NULL
      AND to_regprocedure('public.register_invoice_correction(bigint, bigint, numeric, text)') IS NULL;`)).toBe('t')
    expect(psql(`SELECT total_brl FROM public.invoices WHERE id = ${invoiceIds[0]};`)).toBe('100.00')
  })

  it('a reemissão aponta para a cancelada e tira a fatura da Reemissão pendente', () => {
    markPending(invoiceIds[0])
    expect(pendingIds()).toContain(String(invoiceIds[0]))

    psql(`
      INSERT INTO public.invoices (id, invoice_number, customer_id, bl_id, total_brl, total_paid_brl, balance_brl, status, invoice_type, issued_by, issued_at)
        VALUES (99212119, 'R121-IND-1B', ${customerId}, '${blIds[0]}', 120, 0, 120, 'issued', 'individual', '${actorId}', now());
      INSERT INTO public.invoice_bls (invoice_id, bl_id, charge_status_snapshot, financial_status_snapshot, subtotal_brl)
        VALUES (99212119, '${blIds[0]}', 'ready_for_billing', 'invoiced', 120);
    `)
    expect(psql(`SELECT replaces_invoice_id FROM public.invoices WHERE id = 99212119;`)).toBe(String(invoiceIds[0]))
    expect(pendingIds()).not.toContain(String(invoiceIds[0]))

    const oldLinks = adminJson<{ replaced_by: { invoice_number: string } | null; reissue_pending: boolean }>(
      `SELECT public.get_invoice_reissue_links(${invoiceIds[0]})`,
    )
    expect(oldLinks).toMatchObject({ replaced_by: { invoice_number: 'R121-IND-1B' }, reissue_pending: false })
    const newLinks = adminJson<{ replaces: { invoice_number: string } | null }>(`SELECT public.get_invoice_reissue_links(99212119)`)
    expect(newLinks.replaces?.invoice_number).toBe('R121-IND-1')
  })

  it('B/L isento encerra a pendência com o motivo; a emissão seguinte não aponta para ela', () => {
    markPending(invoiceIds[1])
    psql(`UPDATE public.bls SET charge_status = 'exempt' WHERE id = '${blIds[1]}';`)
    expect(pendingIds()).not.toContain(String(invoiceIds[1]))
    const links = adminJson<{ reissue_pending: boolean; reissue_closed_reason: string | null }>(`SELECT public.get_invoice_reissue_links(${invoiceIds[1]})`)
    expect(links.reissue_pending).toBe(false)
    expect(links.reissue_closed_reason).toMatch(/isento/)

    psql(`
      INSERT INTO public.invoices (id, invoice_number, customer_id, bl_id, total_brl, total_paid_brl, balance_brl, status, invoice_type, issued_by, issued_at)
        VALUES (99212118, 'R121-IND-2B', ${customerId}, '${blIds[1]}', 120, 0, 120, 'issued', 'individual', '${actorId}', now());
      INSERT INTO public.invoice_bls (invoice_id, bl_id, charge_status_snapshot, financial_status_snapshot, subtotal_brl)
        VALUES (99212118, '${blIds[1]}', 'ready_for_billing', 'invoiced', 120);
    `)
    expect(psql(`SELECT coalesce(replaces_invoice_id::text, '') FROM public.invoices WHERE id = 99212118;`)).toBe('')
  })

  it('fatura cancelada não mantém Fatura desatualizada aberta', () => {
    psql(`SELECT public.alert_stale_invoice_for_bl('${blIds[2]}', 'teste');`)
    expect(psql(`SELECT count(*) FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id
      WHERE ai.item_type = 'fatura_desatualizada' AND ai.status = 'active' AND a.entity_id = '${invoiceIds[2]}'`)).toBe('1')
    expect(asAdmin(`SELECT public.cancel_invoice(${invoiceIds[2]}, 'Emitida por engano', NULL)`).status).toBe(0)
    expect(psql(`SELECT count(*) FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id
      WHERE ai.item_type = 'fatura_desatualizada' AND ai.status = 'active' AND a.entity_id = '${invoiceIds[2]}'`)).toBe('0')
  })
})
