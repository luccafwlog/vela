import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000012601'
const customerId = 99122601
const carrierId = 99122602
const vesselId = 99122603
const voyageId = 99122604
const blIds = ['S08-MONEY-BL-1', 'S08-MONEY-BL-2', 'S08-MONEY-BL-3', 'S08-MONEY-BL-4', 'S08-MONEY-BL-5']
const invoiceIds = [99122605, 99122606, 99122607, 99122608, 99122609]
const paymentRequestId = '00000000-0000-0000-0000-000000012699'
const customerCnpj = syntheticCnpj(82260)

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

function expectSqlFailure(sql: string): void {
  expect(() => localPsql(sql)).toThrow()
}

describeLocal('S08-A — invariantes monetarios de Demurrage', () => {
  beforeAll(() => {
    localPsql(`
      SET session_replication_role = replica;
      DELETE FROM public.demurrage_mutation_requests WHERE invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.demurrage_invoice_items WHERE invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.demurrage_invoice_history WHERE invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.bl_containers WHERE id = 99122611;
      DELETE FROM public.demurrage_invoices WHERE id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.bls WHERE id = ANY(ARRAY['${blIds.join("','")}']::text[]);
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
      DELETE FROM public.customer_portal_accounts WHERE customer_id = ${customerId};
      DELETE FROM public.customers WHERE id = ${customerId};
      DELETE FROM public.user_profiles WHERE id = '${actorId}';
      DELETE FROM auth.users WHERE id = '${actorId}';
      SET session_replication_role = origin;

      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 's08-money@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active)
      VALUES ('${actorId}', 'S08 Money', 'financeiro', true);
      INSERT INTO public.customers (id, cnpj_cpf, name)
      VALUES (${customerId}, '${customerCnpj}', 'Cliente S08');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier S08');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel S08', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status)
      VALUES (${voyageId}, ${vesselId}, 'S08', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode)
      VALUES ${blIds.map((id) => `('${id}', ${voyageId}, ${customerId}, 'container')`).join(',')};
      INSERT INTO public.demurrage_invoices
        (id, doc_number, bl_id, customer_id, total_usd, current_roe, current_total_brl, roe_source, status)
      VALUES
        (${invoiceIds[0]}, 'S08-DEM-1', '${blIds[0]}', ${customerId}, 100, 5.5, 550, 'manual', 'issued'),
        (${invoiceIds[1]}, 'S08-DEM-2', '${blIds[1]}', ${customerId}, 100, 5.5, 550, 'manual', 'issued'),
        (${invoiceIds[2]}, 'S08-DEM-3', '${blIds[2]}', ${customerId}, 100, 5.5, 550, 'manual', 'issued'),
        (${invoiceIds[3]}, 'S08-DEM-4', '${blIds[3]}', ${customerId}, 100, 5.5, 550, 'manual', 'issued'),
        (${invoiceIds[4]}, 'S08-DEM-5', '${blIds[4]}', ${customerId}, 100, 5.5, 550, 'manual', 'issued');
      INSERT INTO public.demurrage_invoice_history
        (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
      VALUES
        (${invoiceIds[0]}, '2026-09-01', 5.1643, 5.5, 100, 550, 0, 'manual'),
        (${invoiceIds[1]}, '2026-09-01', 5.1643, 5.5, 100, 550, 0, 'manual'),
        (${invoiceIds[2]}, '2026-09-01', 5.1643, 5.5, 100, 550, 0, 'manual'),
        (${invoiceIds[3]}, '2026-09-01', 4.6948, 5.0, 100, 500, 0, 'manual'),
        (${invoiceIds[3]}, '2026-09-02', 4.9765, 5.3, 100, 530, 0, 'bcb_live'),
        (${invoiceIds[3]}, '2026-09-03', 5.1643, 5.5, 100, 550, 0, 'bcb_live');
    `)
  })

  afterAll(() => {
    localPsql(`
      SET session_replication_role = replica;
      DELETE FROM public.demurrage_mutation_requests WHERE invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.demurrage_invoice_items WHERE invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.demurrage_invoice_history WHERE invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.bl_containers WHERE id = 99122611;
      DELETE FROM public.demurrage_invoices WHERE id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.bls WHERE id = ANY(ARRAY['${blIds.join("','")}']::text[]);
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
      DELETE FROM public.customer_portal_accounts WHERE customer_id = ${customerId};
      DELETE FROM public.customers WHERE id = ${customerId};
      DELETE FROM public.user_profiles WHERE id = '${actorId}';
      DELETE FROM auth.users WHERE id = '${actorId}';
      SET session_replication_role = origin;
    `)
  })

  it('baixa uma vez, registra historia e torna repeticao do PIX idempotente', () => {
    const first = JSON.parse(localPsql(`
      SELECT public.register_demurrage_payment(
        '${paymentRequestId}'::uuid, ${invoiceIds[0]}, '2026-09-02', 'S08-TXID-1', 550, NULL
      );
    `)) as { status: string; idempotent: boolean }
    expect(first).toMatchObject({ status: 'paid', idempotent: false })
    expect(localPsql(`SELECT status FROM public.demurrage_invoices WHERE id = ${invoiceIds[0]};`)).toBe('paid')
    expect(localPsql(`SELECT count(*) FROM public.demurrage_invoice_history WHERE invoice_id = ${invoiceIds[0]};`)).toBe('2')

    const retry = JSON.parse(localPsql(`
      SELECT public.register_demurrage_payment(
        gen_random_uuid(), ${invoiceIds[0]}, '2026-09-02', 'S08-TXID-1', 550, NULL
      );
    `)) as { status: string; idempotent: boolean }
    expect(retry).toMatchObject({ status: 'paid', idempotent: true })
    expect(localPsql(`SELECT count(*) FROM public.demurrage_invoice_history WHERE invoice_id = ${invoiceIds[0]} AND source = 'payment';`)).toBe('1')
  })

  it('rejeita desconto acima da base e produz total zero sem QR quando o desconto e integral', () => {
    expectSqlFailure(`
      SELECT public.apply_demurrage_discount(
        gen_random_uuid(), ${invoiceIds[1]}, 'percent', 101, 'comercial', 'teste', 'S08'
      );
    `)
    expect(localPsql(`SELECT COALESCE(discount_value::text, 'NULL') || ':' || current_total_brl::text FROM public.demurrage_invoices WHERE id = ${invoiceIds[1]};`)).toBe('NULL:550.00')

    const result = JSON.parse(localPsql(`
      SELECT public.apply_demurrage_discount(
        gen_random_uuid(), ${invoiceIds[1]}, 'percent', 100, 'cortesia', 'cortesia integral', 'S08'
      );
    `)) as { current_total_brl: number; pix_payload: string | null }
    expect(result.current_total_brl).toBe(0)
    expect(result.pix_payload).toBeNull()
    expect(localPsql(`SELECT current_total_brl::text || ':' || COALESCE(pix_payload, 'NULL') FROM public.demurrage_invoices WHERE id = ${invoiceIds[1]};`)).toBe('0.00:NULL')
  })

  // Vetor exigido pelo plano (S08-A): "valor da terceira PTAX anterior ->
  // divergencia, nao quitacao". A janela e de DUAS fotos, como
  // get_demurrage_recent_values ja fazia no reconciliador da 002.
  it('recusa o valor da terceira foto anterior e aceita o da janela de duas', () => {
    expectSqlFailure(`
      SELECT public.register_demurrage_payment(
        gen_random_uuid(), ${invoiceIds[3]}, '2026-09-04', 'S08-TXID-OLD', 500, NULL
      );
    `)
    expect(localPsql(`SELECT status FROM public.demurrage_invoices WHERE id = ${invoiceIds[3]};`)).toBe('issued')

    const accepted = JSON.parse(localPsql(`
      SELECT public.register_demurrage_payment(
        gen_random_uuid(), ${invoiceIds[3]}, '2026-09-04', 'S08-TXID-WINDOW', 530, NULL
      );
    `)) as { status: string; total_brl: number }
    expect(accepted).toMatchObject({ status: 'paid' })
    expect(Number(accepted.total_brl)).toBe(530)
  })

  // #658 F9: sem foto persistida a PTAX e desconhecida. O historico registra
  // NULL em vez de round(current_roe / 1.065, 4) = 5.1643.
  it('nao deduz PTAX do ROE quando a fatura legada nao tem foto', () => {
    const result = JSON.parse(localPsql(`
      SELECT public.register_demurrage_payment(
        gen_random_uuid(), ${invoiceIds[4]}, '2026-09-04', 'S08-TXID-LEGACY', 550, NULL
      );
    `)) as { status: string }
    expect(result).toMatchObject({ status: 'paid' })
    expect(localPsql(`
      SELECT COALESCE(ptax_used::text, 'NULL') || ':' || roe_used::text
      FROM public.demurrage_invoice_history
      WHERE invoice_id = ${invoiceIds[4]} AND source = 'payment';
    `)).toBe('NULL:5.5000')
    expect(localPsql(`SELECT count(*) FROM public.demurrage_invoice_history WHERE invoice_id = ${invoiceIds[4]} AND ptax_used IS NOT NULL;`)).toBe('0')
  })

  // Guarda de regressao das duas tabelas que compartilham o gatilho de snapshot
  // da 023. O caminho quebrado era o UPDATE em demurrage_invoices (coberto pelo
  // teste de desconto acima); este fixa o caminho de item, que ja funcionava,
  // para que uma proxima mudanca no resolvedor de id nao o quebre em silencio.
  it('captura snapshot no ciclo de item sem quebrar o gatilho compartilhado', () => {
    localPsql(`
      SET session_replication_role = replica;
      INSERT INTO public.bl_containers (id, bl_id, container_number, type)
      VALUES (99122611, '${blIds[2]}', 'MSCU7654321', '20GP')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.demurrage_invoice_items
        (id, invoice_id, container_id, container_number, container_type, discharge_date, return_date, total_days, free_days, subtotal_usd)
      VALUES (99122610, ${invoiceIds[2]}, 99122611, 'MSCU7654321', '20GP', '2026-09-01', '2026-09-20', 19, 7, 100)
      ON CONFLICT (id) DO NOTHING;
      SET session_replication_role = origin;
    `)
    expect(() => localPsql(`DELETE FROM public.demurrage_invoice_items WHERE id = 99122610;`)).not.toThrow()
    localPsql(`
      SET session_replication_role = replica;
      DELETE FROM public.bl_containers WHERE id = 99122611;
      SET session_replication_role = origin;
    `)
  })

  it('bloqueia DML direto de status e historico para authenticated', () => {
    expect(() => asAuthenticated(`UPDATE public.demurrage_invoices SET status = 'paid' WHERE id = ${invoiceIds[2]};`)).toThrow()
    expect(() => asAuthenticated(`INSERT INTO public.demurrage_invoice_history(invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, source) VALUES (${invoiceIds[2]}, CURRENT_DATE, 5, 5.3, 100, 530, 'payment');`)).toThrow()
    expect(localPsql(`SELECT status FROM public.demurrage_invoices WHERE id = ${invoiceIds[2]};`)).toBe('issued')
  })
})
