import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000019001'
const customerId = 99101901
const carrierId = 99101902
const vesselId = 99101903
const voyageId = 99101904
const blIds = ['S10-LEDGER-BL-1', 'S10-LEDGER-BL-2']
const invoiceIds = [99101905, 99101906]
const receivableIds = [99101907, 99101908]

function psql(sql: string, role: 'service_role' | 'authenticated' = 'service_role'): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = '${role}'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`,
  ], { encoding: 'utf8' }).trim()
}

describeLocal('S10 — ledger local conserva saldo residual de um centavo', () => {
  beforeAll(() => {
    psql(`
      SET session_replication_role = replica;
      DELETE FROM public.ledger_settlements WHERE invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.invoice_receivable_links WHERE invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.invoice_lifecycle_events WHERE invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.invoice_refunds WHERE invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.payments WHERE invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.invoices WHERE id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.bl_receivables WHERE id = ANY(ARRAY[${receivableIds.join(',')}]::bigint[]);
      DELETE FROM public.bls WHERE id = ANY(ARRAY['${blIds.join("','")}']::text[]);
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
      DELETE FROM public.customers WHERE id = ${customerId};
      DELETE FROM public.user_profiles WHERE id = '${actorId}';
      DELETE FROM public.audit_logs WHERE changed_by = '${actorId}';
      DELETE FROM auth.users WHERE id = '${actorId}';
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 's10-ledger@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active)
      VALUES ('${actorId}', 'S10 Ledger', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name)
      VALUES (${customerId}, '19101901000191', 'Cliente S10');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier S10');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel S10', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status)
      VALUES (${voyageId}, ${vesselId}, 'S10', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode, financial_status, charge_status, customer_reconciliation_status, ce_mercante)
      VALUES
        ('${blIds[0]}', ${voyageId}, ${customerId}, 'container', 'invoiced', 'ready_for_billing', 'reconciled', 'CE-S10-1'),
        ('${blIds[1]}', ${voyageId}, ${customerId}, 'container', 'invoiced', 'ready_for_billing', 'reconciled', 'CE-S10-2');
      INSERT INTO public.invoices (id, invoice_number, customer_id, total_brl, total_paid_brl, balance_brl, status, invoice_type)
      VALUES
        (${invoiceIds[0]}, 'INV-S10-1', ${customerId}, 100, 0, 100, 'issued', 'individual'),
        (${invoiceIds[1]}, 'INV-S10-2', ${customerId}, 100, 0, 100, 'issued', 'individual');
      INSERT INTO public.bl_receivables (id, bl_id, customer_id, original_amount_brl, settled_amount_brl, balance_brl, status, voyage_id, cargo_mode)
      VALUES
        (${receivableIds[0]}, '${blIds[0]}', ${customerId}, 100, 0, 100, 'open', ${voyageId}, 'container'),
        (${receivableIds[1]}, '${blIds[1]}', ${customerId}, 100, 0, 100, 'open', ${voyageId}, 'container');
      INSERT INTO public.invoice_receivable_links (invoice_id, receivable_id, bl_id, subtotal_brl, status)
      VALUES
        (${invoiceIds[0]}, ${receivableIds[0]}, '${blIds[0]}', 100, 'active'),
        (${invoiceIds[1]}, ${receivableIds[1]}, '${blIds[1]}', 100, 'active');
      SET session_replication_role = origin;
    `)
  })

  afterAll(() => {
    psql(`
      SET session_replication_role = replica;
      DELETE FROM public.ledger_settlements WHERE invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.invoice_receivable_links WHERE invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.invoice_lifecycle_events WHERE invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.invoice_refunds WHERE invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.payments WHERE invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.invoices WHERE id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.bl_receivables WHERE id = ANY(ARRAY[${receivableIds.join(',')}]::bigint[]);
      DELETE FROM public.bls WHERE id = ANY(ARRAY['${blIds.join("','")}']::text[]);
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
      DELETE FROM public.customers WHERE id = ${customerId};
      DELETE FROM public.user_profiles WHERE id = '${actorId}';
      DELETE FROM public.audit_logs WHERE changed_by = '${actorId}';
      DELETE FROM auth.users WHERE id = '${actorId}';
      SET session_replication_role = origin;
    `)
  })

  it('mantem R$ 0,01 aberto tanto no pagamento manual quanto no PIX', () => {
    const manual = JSON.parse(psql(`
      SELECT public.register_ledger_invoice_payment(
        ${invoiceIds[0]}, 99.99, 'ted', '2026-09-07T12:00:00Z', NULL, 'manual', 'S10 manual', '${actorId}'
      );
    `, 'authenticated')) as { status: string; amount_brl: number; balance_brl: number }
    expect(manual).toMatchObject({ status: 'partially_paid', amount_brl: 99.99, balance_brl: 0.01 })
    expect(psql(`SELECT status || ':' || balance_brl::text FROM public.invoices WHERE id = ${invoiceIds[0]};`)).toBe('partially_paid:0.01')
    expect(psql(`SELECT status || ':' || balance_brl::text FROM public.bl_receivables WHERE id = ${receivableIds[0]};`)).toBe('partially_settled:0.01')

    const pix = JSON.parse(psql(`
      SELECT public.register_ledger_invoice_payment(
        ${invoiceIds[1]}, 99.99, 'pix', '2026-09-07T12:00:00Z', 'S10-TXID-1', 'pix_extract', 'S10 pix', '${actorId}'
      );
    `, 'authenticated')) as { status: string; amount_brl: number; balance_brl: number }
    expect(pix).toMatchObject({ status: 'partially_paid', amount_brl: 99.99, balance_brl: 0.01 })
    expect(psql(`SELECT status || ':' || balance_brl::text FROM public.invoices WHERE id = ${invoiceIds[1]};`)).toBe('partially_paid:0.01')
    expect(psql(`SELECT status || ':' || balance_brl::text FROM public.bl_receivables WHERE id = ${receivableIds[1]};`)).toBe('partially_settled:0.01')
  })
})
