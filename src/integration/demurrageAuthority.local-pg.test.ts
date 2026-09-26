import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000023001'
const customerId = 99223001
const carrierId = 99223002
const vesselId = 99223003
const voyageId = 99223004
const blId = 'S08-AUTH-BL-1'
const containerId = 99223005
const staleInvoiceId = 99223006
const agreementId = 99223007
let createdInvoiceId: number | null = null

function localPsql(sql: string): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`,
  ], { encoding: 'utf8' }).trim()
}

function asAuthenticated(sql: string): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${actorId}'; ${sql} COMMIT;`,
  ], { encoding: 'utf8' }).trim()
}

describeLocal('S08-B — cálculo server-side e snapshots de Demurrage', () => {
  beforeAll(() => {
    localPsql(`
      SET session_replication_role = replica;
      DELETE FROM public.demurrage_calculation_snapshots WHERE demurrage_invoice_id = ${staleInvoiceId};
      DELETE FROM public.demurrage_invoice_history WHERE invoice_id = ${staleInvoiceId};
      DELETE FROM public.demurrage_invoice_items WHERE invoice_id = ${staleInvoiceId};
      DELETE FROM public.demurrage_invoices WHERE id = ${staleInvoiceId};
      DELETE FROM public.customer_demurrage_agreements WHERE id = ${agreementId};
      DELETE FROM public.bl_containers WHERE id = ${containerId};
      DELETE FROM public.bls WHERE id = '${blId}';
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
      DELETE FROM public.customers WHERE id = ${customerId};
      DELETE FROM public.user_profiles WHERE id = '${actorId}';
      DELETE FROM auth.users WHERE id = '${actorId}';
      SET session_replication_role = origin;

      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 's08-authority@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active)
      VALUES ('${actorId}', 'S08 Authority', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name)
      VALUES (${customerId}, '99223001000162', 'Cliente S08 Authority');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier S08 Authority');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel S08 Authority', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status)
      VALUES (${voyageId}, ${vesselId}, 'S08-AUTH', 'active');
      INSERT INTO public.bls (
        id, voyage_id, customer_id, cargo_mode, demurrage_roe_manual, demurrage_roe
      ) VALUES ('${blId}', ${voyageId}, ${customerId}, 'container', true, 5.5);
      INSERT INTO public.bl_containers (
        id, bl_id, container_number, type, discharge_date, return_date, demurrage_status
      ) VALUES (${containerId}, '${blId}', 'ABCU1234567', '20GP', '2026-01-01', '2026-01-31', 'returned');
      INSERT INTO public.customer_demurrage_agreements (
        id, customer_id, free_days, p1_usd, p2_usd, valid_from, active
      ) VALUES (${agreementId}, ${customerId}, 25, 10, 20, '2026-01-01', true);
    `)
  })

  afterAll(() => {
    localPsql(`
      SET session_replication_role = replica;
      DELETE FROM public.demurrage_calculation_snapshots WHERE demurrage_invoice_id IN (${staleInvoiceId}, ${createdInvoiceId ?? -1});
      DELETE FROM public.demurrage_invoice_history WHERE invoice_id IN (${staleInvoiceId}, ${createdInvoiceId ?? -1});
      DELETE FROM public.demurrage_invoice_items WHERE invoice_id IN (${staleInvoiceId}, ${createdInvoiceId ?? -1});
      DELETE FROM public.demurrage_invoices WHERE id IN (${staleInvoiceId}, ${createdInvoiceId ?? -1});
      DELETE FROM public.customer_demurrage_agreements WHERE id = ${agreementId};
      DELETE FROM public.bl_containers WHERE id = ${containerId};
      DELETE FROM public.bls WHERE id = '${blId}';
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
      DELETE FROM public.customers WHERE id = ${customerId};
      DELETE FROM public.user_profiles WHERE id = '${actorId}';
      DELETE FROM auth.users WHERE id = '${actorId}';
      SET session_replication_role = origin;
    `)
  })

  it('ignora total, datas e tarifa enviados pelo browser e congela o cálculo do banco', () => {
    const result = JSON.parse(localPsql(`
      SELECT public.create_demurrage_invoice_authoritative(
        'S08-AUTH-1', '${blId}', ${customerId}, ARRAY[${containerId}]::bigint[]
      );
    `)) as { invoice_id: number; total_usd: number; current_total_brl: number; roe_source: string }

    createdInvoiceId = result.invoice_id
    expect(result).toMatchObject({ total_usd: 50, current_total_brl: 275, roe_source: 'manual' })
    expect(localPsql(`SELECT total_usd::text || ':' || current_total_brl::text FROM public.demurrage_invoices WHERE id = ${createdInvoiceId};`)).toBe('50.00:275.00')
    expect(localPsql(`SELECT free_days::text || ':' || days_p1::text || ':' || rate_p1_usd::text || ':' || subtotal_usd::text || ':' || subtotal_brl::text FROM public.demurrage_invoice_items WHERE invoice_id = ${createdInvoiceId};`)).toBe('25:5:10.00:50.00:275.00')
    expect(localPsql(`SELECT count(*) FROM public.demurrage_calculation_snapshots WHERE demurrage_invoice_id = ${createdInvoiceId};`)).toBe('1')
    expect(localPsql(`SELECT event_kind FROM public.demurrage_calculation_snapshots WHERE demurrage_invoice_id = ${createdInvoiceId};`)).toBe('initial')
    expect(localPsql(`SELECT (result_snapshot->>'presentation_total_brl') || ':' || ((result_snapshot->'presentation_items'->0)->>'subtotal_brl') FROM public.demurrage_calculation_snapshots WHERE demurrage_invoice_id = ${createdInvoiceId};`)).toBe('275.00:275.00')
    expect(() => localPsql(`UPDATE public.demurrage_invoices SET current_roe = 0 WHERE id = ${createdInvoiceId};`)).toThrow()
    expect(() => localPsql(`UPDATE public.demurrage_invoices SET roe_source = 'forged' WHERE id = ${createdInvoiceId};`)).toThrow()
    expect(() => asAuthenticated(`UPDATE public.demurrage_invoices SET roe = 6, roe_manual = true WHERE id = ${createdInvoiceId};`)).toThrow()
  })

  it('não permite a entrada antiga que recebia linhas monetárias arbitrárias', () => {
    expect(() => asAuthenticated(`SELECT public.create_demurrage_invoice_with_items('${blId}', '${blId}', ${customerId}, 1, CURRENT_DATE, false, NULL, 1, 'manual', '[]'::jsonb);`)).toThrow()
    expect(() => asAuthenticated(`UPDATE public.demurrage_calculation_snapshots SET result_snapshot = '{}'::jsonb WHERE demurrage_invoice_id = ${createdInvoiceId ?? -1};`)).toThrow()
  })
})
