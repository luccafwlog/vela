import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

// Migration 162: depois que a consolidada é paga, os vínculos dela passam a
// 'settled_by_this_invoice'. O Portal precisa continuar mostrando a consolidada
// (com B/Ls, detalhe e recibo) e identificar as individuais cobertas por ela,
// com saldo zero. Cenário reproduzido do teste Itaú de 2026-10-08.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl =
  process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const portalUser = '00000000-0000-0000-0000-000000162001'
const otherPortalUser = '00000000-0000-0000-0000-000000162002'
const customerId = 991621
const otherCustomerId = 991622
const carrierId = 991621
const vesselId = 991621
const voyageId = 991621
const bl1 = 'BL-162-1'
const bl2 = 'BL-162-2'
const customerCnpj = syntheticCnpj(16201)
const otherCnpj = syntheticCnpj(16202)

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function callAs(userId: string, sql: string) {
  const run = spawnSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${userId}', true); ${sql} COMMIT;`,
  ], { encoding: 'utf8' })
  return { ...run, json: run.stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).pop() }
}

type Row = { invoice_number: string; status: string; balance_brl: number; bls: string[]; covered_by_invoice_number: string | null }

function paidList(userId = portalUser): Row[] {
  const run = callAs(userId, `SELECT public.portal_list_invoices_page(25, 0, 'paid', NULL, NULL, NULL, NULL, NULL);`)
  expect(run.status, run.stderr).toBe(0)
  return (JSON.parse(run.json ?? '{}') as { rows: Row[] }).rows
}

function invoiceId(number: string) {
  return psql(`SELECT id FROM public.invoices WHERE invoice_number = '${number}';`)
}

describeLocal('Portal — consolidada paga e individuais cobertas (migration 162)', () => {
  beforeAll(() => {
    psql(`
      INSERT INTO auth.users (id, email) VALUES
        ('${portalUser}', 'p162@example.test'), ('${otherPortalUser}', 'p162-b@example.test')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
        (${customerId}, '${customerCnpj}', 'Cliente 162'), (${otherCustomerId}, '${otherCnpj}', 'Cliente 162 B')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
      INSERT INTO public.customer_portal_accounts (customer_id, active, auth_user_id, provisioning_decision, account_situation, recovery_email, portal_email, login_cnpj) VALUES
        (${customerId}, true, '${portalUser}', 'aprovado_para_provisionar', 'ativo', 'p162@example.test', 'p162@example.test', '${customerCnpj}'),
        (${otherCustomerId}, true, '${otherPortalUser}', 'aprovado_para_provisionar', 'ativo', 'p162-b@example.test', 'p162-b@example.test', '${otherCnpj}')
      ON CONFLICT (customer_id) DO UPDATE SET active = true, auth_user_id = EXCLUDED.auth_user_id,
        provisioning_decision = EXCLUDED.provisioning_decision, account_situation = 'ativo';
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier 162') ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel 162', ${carrierId}) ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, '162-001', 'active') ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode, pol, pod, ce_mercante) VALUES
        ('${bl1}', ${voyageId}, ${customerId}, 'container', 'CNTAO', 'BRVIX', '162000000000001'),
        ('${bl2}', ${voyageId}, ${customerId}, 'container', 'CNTAO', 'BRVIX', '162000000000002')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.bl_receivables (bl_id, customer_id, original_amount_brl, settled_amount_brl, balance_brl, status, voyage_id)
      VALUES ('${bl1}', ${customerId}, 0.10, 0.10, 0, 'settled', ${voyageId}),
             ('${bl2}', ${customerId}, 0.11, 0.11, 0, 'settled', ${voyageId});
      -- Rascunho direto para o estado final: o gate de Portal só vale para 'issued'.
      INSERT INTO public.invoices (invoice_number, customer_id, bl_id, invoice_type, total_brl, total_paid_brl, balance_brl, status, issued_at) VALUES
        ('INV-162-0001', ${customerId}, '${bl1}', 'individual', 0.10, 0, 0.10, 'draft', now() - interval '2 minutes'),
        ('INV-162-0002', ${customerId}, '${bl2}', 'individual', 0.11, 0, 0.11, 'draft', now() - interval '2 minutes'),
        ('INV-162-0003', ${customerId}, NULL, 'consolidated', 0.21, 0.21, 0, 'draft', now() - interval '1 minute');
      INSERT INTO public.invoice_bls (invoice_id, bl_id, subtotal_brl, subtotal_usd)
      SELECT i.id, i.bl_id, i.total_brl, 0 FROM public.invoices i WHERE i.invoice_number IN ('INV-162-0001', 'INV-162-0002');
      INSERT INTO public.invoice_receivable_links (invoice_id, receivable_id, bl_id, subtotal_brl, status)
      SELECT i.id, r.id, r.bl_id, r.original_amount_brl,
        CASE WHEN i.invoice_type = 'consolidated' THEN 'settled_by_this_invoice' ELSE 'settled_elsewhere' END
      FROM public.invoices i
      JOIN public.bl_receivables r ON r.customer_id = ${customerId}
        AND (i.invoice_type = 'consolidated' OR r.bl_id = i.bl_id)
      WHERE i.invoice_number IN ('INV-162-0001', 'INV-162-0002', 'INV-162-0003');
      UPDATE public.invoices SET status = 'paid' WHERE invoice_number = 'INV-162-0003';
      UPDATE public.invoices SET status = 'covered',
        covered_by_invoice_id = (SELECT id FROM public.invoices WHERE invoice_number = 'INV-162-0003')
      WHERE invoice_number IN ('INV-162-0001', 'INV-162-0002');
      INSERT INTO public.payments (invoice_id, amount_brl, payment_method, paid_at)
      SELECT id, 0.21, 'pix', now() FROM public.invoices WHERE invoice_number = 'INV-162-0003';
    `)
  })

  afterAll(() => {
    psql(`
      DELETE FROM public.payments WHERE invoice_id IN (SELECT id FROM public.invoices WHERE invoice_number LIKE 'INV-162-%');
      UPDATE public.invoices SET covered_by_invoice_id = NULL WHERE invoice_number LIKE 'INV-162-%';
      DELETE FROM public.invoice_receivable_links WHERE invoice_id IN (SELECT id FROM public.invoices WHERE invoice_number LIKE 'INV-162-%');
      DELETE FROM public.invoice_bls WHERE invoice_id IN (SELECT id FROM public.invoices WHERE invoice_number LIKE 'INV-162-%');
      DELETE FROM public.invoice_lifecycle_events WHERE invoice_id IN (SELECT id FROM public.invoices WHERE invoice_number LIKE 'INV-162-%');
      DELETE FROM public.invoices WHERE invoice_number LIKE 'INV-162-%';
      DELETE FROM public.bl_receivables WHERE customer_id = ${customerId};
      DELETE FROM public.bls WHERE id IN ('${bl1}', '${bl2}');
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
    `)
  })

  it('lista a consolidada paga em "Pagas", com os dois B/Ls', () => {
    const consolidated = paidList().find((row) => row.invoice_number === 'INV-162-0003')
    expect(consolidated).toMatchObject({ status: 'paid', covered_by_invoice_number: null })
    expect([...(consolidated?.bls ?? [])].sort()).toEqual([bl1, bl2])
  })

  it('mantém as individuais cobertas em "Pagas", com saldo zero e a consolidada que as cobriu', () => {
    const rows = paidList().filter((row) => row.invoice_number !== 'INV-162-0003')
    expect(rows.map((row) => row.invoice_number).sort()).toEqual(['INV-162-0001', 'INV-162-0002'])
    for (const row of rows) {
      expect(row).toMatchObject({ status: 'covered', covered_by_invoice_number: 'INV-162-0003' })
      expect(Number(row.balance_brl)).toBe(0)
    }
  })

  it('abre o detalhe da consolidada paga com B/Ls e pagamento, e o da coberta com a origem', () => {
    const consolidated = callAs(portalUser, `SELECT public.portal_invoice_details(${invoiceId('INV-162-0003')});`)
    expect(consolidated.status, consolidated.stderr).toBe(0)
    const detail = JSON.parse(consolidated.json ?? '{}') as { invoice: { status: string }; bls: unknown[]; payments: unknown[] }
    expect(detail.invoice.status).toBe('paid')
    expect(detail.bls).toHaveLength(2)
    expect(detail.payments).toHaveLength(1)

    const covered = callAs(portalUser, `SELECT public.portal_invoice_details(${invoiceId('INV-162-0001')});`)
    expect(covered.status, covered.stderr).toBe(0)
    expect(JSON.parse(covered.json ?? '{}').invoice).toMatchObject({
      status: 'covered', balance_brl: 0, covered_by_invoice_number: 'INV-162-0003',
    })
  })

  it('não expõe as faturas a outro cliente', () => {
    expect(paidList(otherPortalUser).filter((row) => row.invoice_number.startsWith('INV-162-'))).toEqual([])
    const run = callAs(otherPortalUser, `SELECT public.portal_invoice_details(${invoiceId('INV-162-0003')});`)
    expect(run.status).not.toBe(0)
  })
})
