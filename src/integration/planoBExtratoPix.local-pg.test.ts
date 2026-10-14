import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Item A16 do plano docs/plans/2026-10-14-correcoes-decididas-na-revisao-geral.md
// (migration 242): o plano B pelo extrato acha a Invoice de Demurrage e a
// fatura avulsa pelo TXID da cobrança, e "Escolher fatura…" lista essas faturas.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADMIN = '24224200-0000-4000-8000-000000000001'
const CUSTOMER_ID = 99242001
const DEM_ID = 99242011
const DEM_ITAU_ID = 99242012
const MANUAL_ID = 99242021
const MANUAL_ITAU_ID = 99242022
const EXCEPTION_ID = 99242031
const DEM_TXID = 'VELA24200000000000000000000001'
const MANUAL_TXID = 'VELA24200000000000000000000002'

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function asAdmin(sql: string): { ok: boolean; output: string; error: string } {
  const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${ADMIN}'; SET LOCAL request.jwt.claim.role = 'authenticated'; ${sql}; COMMIT;`],
  { encoding: 'utf8' })
  return { ok: result.status === 0, output: (result.stdout ?? '').trim(), error: (result.stderr ?? '').trim() }
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.pix_reconciliation_exceptions WHERE id = ${EXCEPTION_ID};
    DELETE FROM public.itau_pix_charges WHERE invoice_id IN (${MANUAL_ID}, ${MANUAL_ITAU_ID}) OR demurrage_invoice_id IN (${DEM_ID}, ${DEM_ITAU_ID});
    DELETE FROM public.invoice_lifecycle_events WHERE invoice_id IN (${MANUAL_ID}, ${MANUAL_ITAU_ID});
    DELETE FROM public.payments WHERE invoice_id IN (${MANUAL_ID}, ${MANUAL_ITAU_ID});
    DELETE FROM public.invoices WHERE id IN (${MANUAL_ID}, ${MANUAL_ITAU_ID});
    DELETE FROM public.demurrage_invoices WHERE id IN (${DEM_ID}, ${DEM_ITAU_ID});
    DELETE FROM public.audit_logs WHERE entity_id IN ('${MANUAL_ID}', '${MANUAL_ITAU_ID}') OR changed_by = '${ADMIN}';
    DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};
    DELETE FROM public.user_profiles WHERE id = '${ADMIN}';
    DELETE FROM auth.users WHERE id = '${ADMIN}';
    SET session_replication_role = origin;
  `)
}

function migration242Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE proname IN ('_pix_txid_open_candidates', 'list_pix_txid_candidates');`) === '2'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration242Applied, 'migration242Applied (plano B do extrato acha Demurrage e avulsa)')

type Candidate = { txid: string; source: string; id: number; doc_number: string; amount_brl: number }

describeLocal('242 — plano B do extrato acha Invoice de Demurrage e avulsa pelo TXID (A16)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${ADMIN}', 'adm-a242@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${ADMIN}', 'Administrativo A242', 'administrativo', true);
      SET session_replication_role = replica;
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER_ID}, 'CLIENTE A242 LTDA', '${syntheticCnpj(242001)}');
      -- Invoice de Demurrage com QR estático (TXID = número) e com QR Itaú.
      INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, status, current_total_brl)
      VALUES (${DEM_ID}, 'DEM-A242-0001', 'A242-BL', ${CUSTOMER_ID}, 'issued', 550),
             (${DEM_ITAU_ID}, 'DEM-A242-0002', 'A242-BL', ${CUSTOMER_ID}, 'issued', 660);
      INSERT INTO public.itau_pix_charges (demurrage_invoice_id, txid, amount_brl, expiration_seconds, status)
      VALUES (${DEM_ITAU_ID}, '${DEM_TXID}', 660, 86400, 'active');
      -- Avulsas com QR estático (TXID = número) e com QR Itaú.
      INSERT INTO public.invoices (id, invoice_number, customer_id, invoice_type, total_brl, balance_brl, status)
      VALUES (${MANUAL_ID}, 'AV-A242-0001', ${CUSTOMER_ID}, 'manual', 120, 120, 'issued'),
             (${MANUAL_ITAU_ID}, 'AV-A242-0002', ${CUSTOMER_ID}, 'manual', 130, 130, 'issued');
      INSERT INTO public.itau_pix_charges (invoice_id, txid, amount_brl, expiration_seconds, status)
      VALUES (${MANUAL_ITAU_ID}, '${MANUAL_TXID}', 130, 86400, 'active');
      INSERT INTO public.pix_reconciliation_exceptions (id, import_key, line_number, txid, normalized_txid, amount_brl, reason)
      VALUES (${EXCEPTION_ID}, 'a242-extrato-0001', 2, '${DEM_TXID}', '${DEM_TXID}', 660, 'unmatched');
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanup)

  it('o matching acha a Invoice de Demurrage e a avulsa pelo QR estático e pelo QR Itaú', () => {
    const result = asAdmin(`SELECT public.list_pix_txid_candidates(ARRAY['DEM-A242-0001', '${DEM_TXID}', 'AV-A242-0001', '${MANUAL_TXID}', 'SEM-DONO-A242'])`)
    expect(result.error).toBe('')
    const byTxid = new Map((JSON.parse(result.output) as Candidate[]).map((row) => [row.txid, row]))
    expect(byTxid.get('DEM-A242-0001')).toMatchObject({ source: 'demurrage', id: DEM_ID, amount_brl: 550 })
    expect(byTxid.get(DEM_TXID)).toMatchObject({ source: 'demurrage', id: DEM_ITAU_ID, amount_brl: 660 })
    expect(byTxid.get('AV-A242-0001')).toMatchObject({ source: 'local', id: MANUAL_ID, amount_brl: 120 })
    expect(byTxid.get(MANUAL_TXID)).toMatchObject({ source: 'local', id: MANUAL_ITAU_ID, amount_brl: 130 })
    expect(byTxid.has('SEM-DONO-A242')).toBe(false)
  })

  it('"Escolher fatura…" lista a Invoice de Demurrage aberta e o vínculo a aceita', () => {
    const listed = asAdmin(`SELECT source || ':' || invoice_id FROM public.list_pix_reconciliation_candidates(${EXCEPTION_ID})`)
    expect(listed.output).toBe(`demurrage:${DEM_ITAU_ID}`)
    const linked = asAdmin(`SELECT public.link_pix_reconciliation_candidate(${EXCEPTION_ID}, 'demurrage', NULL, ${DEM_ITAU_ID})`)
    expect(linked.error).toBe('')
    expect(psql(`SELECT metadata->'manual_candidate'->>'doc_number' FROM public.pix_reconciliation_exceptions WHERE id = ${EXCEPTION_ID};`))
      .toBe('DEM-A242-0002')
    // Outra fatura que não aceita o TXID é recusada.
    expect(asAdmin(`SELECT public.link_pix_reconciliation_candidate(${EXCEPTION_ID}, 'demurrage', NULL, ${DEM_ID})`).error)
      .toMatch(/Candidata nao corresponde/)
  })

  it('a baixa por TXID acha a avulsa cobrada pelo QR Itaú', () => {
    const result = asAdmin(`SELECT public.reconcile_invoice_payment_by_txid('${MANUAL_TXID}', 130, now())`)
    expect(result.error).toBe('')
    expect(JSON.parse(result.output)).toMatchObject({ matched: true, invoice_id: MANUAL_ITAU_ID, settled: true })
    expect(psql(`SELECT status FROM public.invoices WHERE id = ${MANUAL_ITAU_ID};`)).toBe('paid')
  })
})
