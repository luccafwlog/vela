import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000069201'
const customerId = 6920101
const carrierId = 6920102
const vesselId = 6920103
const voyageId = 6920104
const accountId = 6920105
const contactId = 6920106
const chargeTableId = 6920107
const chargeItemId = 6920108
const chargeCalculationId = 6920109
const badReceivableId = 6920110
const validReceivableId = 6920111

const badLooseBlId = 'S12-CE-GATE-BB-BL'
const badContainerBlId = 'S12-CE-GATE-CNTR-BL'
const validLooseBlId = 'S12-CE-GATE-BB-VALID'
const validContainerDirectBlId = 'S12-CE-GATE-CNTR-DIRECT'
const validContainerConsolidatedBlId = 'S12-CE-GATE-CNTR-CONS'
const validContainerUpdateBlId = 'S12-CE-GATE-CNTR-UPDATE'
const blIds = [
  badLooseBlId,
  badContainerBlId,
  validLooseBlId,
  validContainerDirectBlId,
  validContainerConsolidatedBlId,
  validContainerUpdateBlId,
]

const invoiceIds = [6920112, 6920113, 6920114, 6920115, 6920116, 6920117, 6920118, 6920119, 6920120, 6920121]

function psql(sql: string, role: 'service_role' | 'authenticated' = 'service_role'): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = '${role}'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`,
  ], { encoding: 'utf8' }).trim()
}

function expectRejected(sql: string, role: 'service_role' | 'authenticated' = 'service_role'): void {
  expect(psql(`
    DO $$
    BEGIN
      BEGIN
        ${sql}
        RAISE EXCEPTION 'S12 expected CE gate rejection was not raised' USING ERRCODE = 'P0001';
      EXCEPTION WHEN SQLSTATE 'P0003' THEN
        NULL;
      END;
    END;
    $$;
  `, role)).toBe('')
}

function cleanup(): void {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.invoice_lifecycle_events WHERE invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
    DELETE FROM public.invoice_receivable_links WHERE invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
    DELETE FROM public.invoice_bls WHERE invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
    DELETE FROM public.invoices WHERE id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
    DELETE FROM public.bl_receivables WHERE id IN (${badReceivableId}, ${validReceivableId});
    DELETE FROM public.charge_calculations WHERE id = ${chargeCalculationId};
    DELETE FROM public.charge_table_items WHERE id = ${chargeItemId};
    DELETE FROM public.charge_tables WHERE id = ${chargeTableId};
    DELETE FROM public.bls WHERE id = ANY(ARRAY['${blIds.join("','")}']::text[]);
    DELETE FROM public.audit_logs WHERE changed_by = '${actorId}';
    DELETE FROM public.customer_contacts WHERE id = ${contactId};
    DELETE FROM public.customer_portal_accounts WHERE id = ${accountId};
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.user_profiles WHERE id = '${actorId}';
    DELETE FROM auth.users WHERE id = '${actorId}';
    SET session_replication_role = origin;
  `)
}

describeLocal('S12 — gates documentais de CE Mercante no faturamento', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      SET session_replication_role = replica;
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 's12-bl-gates@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active)
      VALUES ('${actorId}', 'S12 BL gates', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name)
      VALUES (${customerId}, '12692010000192', 'Cliente S12 BL gates');
      INSERT INTO public.customer_contacts (id, customer_id, name, email, purpose, is_primary)
      VALUES (${contactId}, ${customerId}, 'Contato S12', 's12-bl-gates@example.test', 'faturamento', true);
      INSERT INTO public.customer_portal_accounts (
        id, customer_id, contact_email, active, auth_user_id, recovery_email,
        provisioning_decision, account_situation
      ) VALUES (
        ${accountId}, ${customerId}, 's12-bl-gates@example.test', true, '${actorId}',
        's12-bl-gates@example.test', 'aprovado_para_provisionar', 'ativo'
      );
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier S12 BL gates');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel S12 BL gates', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status)
      VALUES (${voyageId}, ${vesselId}, 'S12-BL-GATES', 'active');
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
      VALUES (${chargeTableId}, 'S12 carga solta', 'BRSSZ', '2026-01-01', true, 'carga_solta');
      INSERT INTO public.charge_table_items (
        id, charge_table_id, name, applies_to, cargo_profile, value_brl,
        currency, category, application_basis
      ) VALUES (
        ${chargeItemId}, ${chargeTableId}, 'S12 handling', 'bl', 'any', 100,
        'BRL', 'base', 'bl'
      );
      INSERT INTO public.bls (
        id, voyage_id, customer_id, cargo_mode, pol, pod, ce_mercante,
        financial_status, review_status, charge_status, customer_reconciliation_status,
        bb_machine_qty, bb_packages_qty, bb_packages_total, bb_weight_ton
      ) VALUES
        ('${badLooseBlId}', ${voyageId}, ${customerId}, 'carga_solta', 'CNSHA', 'BRSSZ', '   ', 'pending', 'ok', 'calculated', 'reconciled', 1, 1, 1, 1),
        ('${badContainerBlId}', ${voyageId}, ${customerId}, 'container', 'CNSHA', 'BRSSZ', '', 'pending', 'ok', 'calculated', 'reconciled', NULL, NULL, NULL, NULL),
        ('${validLooseBlId}', ${voyageId}, ${customerId}, 'carga_solta', 'CNSHA', 'BRSSZ', 'CE-S12-LOOSE', 'pending', 'ok', 'calculated', 'reconciled', 1, 1, 1, 1),
        ('${validContainerDirectBlId}', ${voyageId}, ${customerId}, 'container', 'CNSHA', 'BRSSZ', 'CE-S12-DIRECT', 'pending', 'ok', 'calculated', 'reconciled', NULL, NULL, NULL, NULL),
        ('${validContainerConsolidatedBlId}', ${voyageId}, ${customerId}, 'container', 'CNSHA', 'BRSSZ', 'CE-S12-CONS', 'pending', 'ok', 'calculated', 'reconciled', NULL, NULL, NULL, NULL),
        ('${validContainerUpdateBlId}', ${voyageId}, ${customerId}, 'container', 'CNSHA', 'BRSSZ', 'CE-S12-UPDATE', 'pending', 'ok', 'calculated', 'reconciled', NULL, NULL, NULL, NULL);
      INSERT INTO public.charge_calculations (
        id, bl_id, charge_table_id, charge_item_id, quantity, unit_value_brl,
        total_value_brl, source, status
      ) VALUES (
        ${chargeCalculationId}, '${validLooseBlId}', ${chargeTableId}, ${chargeItemId}, 1, 100,
        100, 'auto', 'calculated'
      );
      INSERT INTO public.bl_receivables (
        id, bl_id, customer_id, source, original_amount_brl, settled_amount_brl,
        balance_brl, status, voyage_id, cargo_mode, pol, pod
      ) VALUES
        (${badReceivableId}, '${badLooseBlId}', ${customerId}, 'local_charges', 100, 0, 100, 'open', ${voyageId}, 'carga_solta', 'CNSHA', 'BRSSZ'),
        (${validReceivableId}, '${validContainerConsolidatedBlId}', ${customerId}, 'local_charges', 100, 0, 100, 'open', ${voyageId}, 'container', 'CNSHA', 'BRSSZ');
      INSERT INTO public.invoices (
        id, invoice_number, customer_id, bl_id, total_brl, total_paid_brl, balance_brl,
        status, invoice_type
      ) VALUES
        (${invoiceIds[0]}, 'S12-INV-DIRECT-BAD', ${customerId}, NULL, 100, 0, 100, 'issued', 'individual'),
        (${invoiceIds[1]}, 'S12-INV-CONS-BAD', ${customerId}, NULL, 100, 0, 100, 'issued', 'consolidated'),
        (${invoiceIds[2]}, 'S12-INV-TRANS-DIRECT-BAD', ${customerId}, NULL, 100, 0, 100, 'draft', 'individual'),
        (${invoiceIds[3]}, 'S12-INV-TRANS-CONS-BAD', ${customerId}, NULL, 100, 0, 100, 'draft', 'consolidated'),
        (${invoiceIds[4]}, 'S12-INV-BYPASS', ${customerId}, '${validLooseBlId}', 100, 0, 100, 'issued', 'individual'),
        (${invoiceIds[5]}, 'S12-INV-DIRECT-VALID', ${customerId}, NULL, 100, 0, 100, 'issued', 'individual'),
        (${invoiceIds[6]}, 'S12-INV-CONS-VALID', ${customerId}, NULL, 100, 0, 100, 'issued', 'consolidated'),
        (${invoiceIds[7]}, 'S12-INV-ISSUE-VALID', ${customerId}, '${validContainerUpdateBlId}', 100, 0, 100, 'draft', 'individual'),
        (${invoiceIds[8]}, 'S12-INV-UPDATE-VALID', ${customerId}, '${validLooseBlId}', 100, 0, 100, 'issued', 'individual');
      INSERT INTO public.invoice_bls (invoice_id, bl_id, subtotal_brl)
      VALUES
        (${invoiceIds[2]}, '${badContainerBlId}', 100);
      INSERT INTO public.invoice_receivable_links (invoice_id, receivable_id, bl_id, subtotal_brl, status)
      VALUES
        (${invoiceIds[3]}, ${badReceivableId}, '${badLooseBlId}', 100, 'active');
      SET session_replication_role = origin;
    `)
  })

  afterAll(cleanup)

  it('recusa B/L de carga solta sem CE ao marcar pronto para faturar', () => {
    expectRejected(
      `PERFORM public.mark_bl_ready_for_billing('${badLooseBlId}', '${actorId}');`,
      'authenticated',
    )
    expect(psql(`SELECT charge_status FROM public.bls WHERE id = '${badLooseBlId}';`)).toBe('calculated')
  })

  it('recusa links diretos e consolidados sem CE em invoices emitidas', () => {
    expectRejected(`
      INSERT INTO public.invoices (
        id, invoice_number, customer_id, bl_id, total_brl, total_paid_brl, balance_brl,
        status, invoice_type
      ) VALUES (${invoiceIds[9]}, 'S12-INV-INSERT-BAD', ${customerId}, '${badLooseBlId}', 100, 0, 100, 'issued', 'individual');
    `)
    expectRejected(`
      INSERT INTO public.invoice_bls (invoice_id, bl_id, subtotal_brl)
      VALUES (${invoiceIds[0]}, '${badLooseBlId}', 100);
    `)
    expectRejected(`
      INSERT INTO public.invoice_receivable_links (invoice_id, receivable_id, bl_id, subtotal_brl, status)
      VALUES (${invoiceIds[1]}, ${badReceivableId}, '${badLooseBlId}', 100, 'active');
    `)
  })

  it('recusa emissão posterior de invoice que já tinha links sem CE', () => {
    expectRejected(`UPDATE public.invoices SET status = 'issued' WHERE id = ${invoiceIds[2]};`)
    expectRejected(`UPDATE public.invoices SET status = 'issued' WHERE id = ${invoiceIds[3]};`)
    expect(psql(`SELECT string_agg(status, ',' ORDER BY id) FROM public.invoices WHERE id IN (${invoiceIds[2]}, ${invoiceIds[3]});`)).toBe('draft,draft')
  })

  it('recusa trocar o bl_id direto de invoice já emitida para B/L sem CE', () => {
    expectRejected(`UPDATE public.invoices SET bl_id = '${badLooseBlId}' WHERE id = ${invoiceIds[4]};`)
    expect(psql(`SELECT bl_id FROM public.invoices WHERE id = ${invoiceIds[4]};`)).toBe(validLooseBlId)
  })

  it('permite os mesmos caminhos quando o CE está presente', () => {
    expect(psql(`SELECT public.mark_bl_ready_for_billing('${validLooseBlId}', '${actorId}')->>'status';`, 'authenticated')).toBe('ready_for_billing')
    psql(`INSERT INTO public.invoice_bls (invoice_id, bl_id, subtotal_brl) VALUES (${invoiceIds[5]}, '${validContainerDirectBlId}', 100);`)
    psql(`INSERT INTO public.invoice_receivable_links (invoice_id, receivable_id, bl_id, subtotal_brl, status) VALUES (${invoiceIds[6]}, ${validReceivableId}, '${validContainerConsolidatedBlId}', 100, 'active');`)
    psql(`UPDATE public.invoices SET status = 'issued' WHERE id = ${invoiceIds[7]};`)
    psql(`UPDATE public.invoices SET bl_id = '${validContainerUpdateBlId}' WHERE id = ${invoiceIds[8]};`)

    expect(psql(`SELECT charge_status FROM public.bls WHERE id = '${validLooseBlId}';`)).toBe('ready_for_billing')
    expect(psql(`SELECT count(*) FROM public.invoice_bls WHERE invoice_id = ${invoiceIds[5]} AND bl_id = '${validContainerDirectBlId}';`)).toBe('1')
    expect(psql(`SELECT count(*) FROM public.invoice_receivable_links WHERE invoice_id = ${invoiceIds[6]} AND status = 'active';`)).toBe('1')
    expect(psql(`SELECT status FROM public.invoices WHERE id = ${invoiceIds[7]};`)).toBe('issued')
    expect(psql(`SELECT bl_id FROM public.invoices WHERE id = ${invoiceIds[8]};`)).toBe(validContainerUpdateBlId)
  })
})
