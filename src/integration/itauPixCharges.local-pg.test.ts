import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const customerId = 998801
const carrierId = 998802
const vesselId = 998803
const voyageId = 998804
const blId = 'ITAU-150-BL'
const demurrageId = 998805
const userId = '00000000-0000-0000-0000-000000098801'

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

function asAuthenticated(sql: string): string {
  try {
    return psql(`SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${userId}'; ${sql}`)
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? error)
  }
}

function setProvider(provider: 'static' | 'itau') {
  psql(`UPDATE public.app_settings SET pix_provider = '${provider}' WHERE id = 1`)
}

function manualInvoice(number: string, amount: number): number {
  return Number(psql(`INSERT INTO public.invoices(invoice_number, customer_id, total_brl, balance_brl, invoice_type, status)
    VALUES ('${number}', ${customerId}, ${amount}, ${amount}, 'manual', 'issued') RETURNING id`))
}

function charges(where: string): { id: number; txid: string; amount: string; status: string; attempts: number }[] {
  const rows = psql(`SELECT id, txid, amount_brl, status, attempts FROM public.itau_pix_charges WHERE ${where} ORDER BY id`)
  return rows ? rows.split('\n').map((row) => {
    const [id, txid, amount, status, attempts] = row.split('|')
    return { id: Number(id), txid, amount, status, attempts: Number(attempts) }
  }) : []
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.itau_pix_charges WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId})
      OR demurrage_invoice_id = ${demurrageId};
    DELETE FROM public.local_pix_charge_versions WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.invoices WHERE customer_id = ${customerId};
    DELETE FROM public.demurrage_calculation_snapshots WHERE demurrage_invoice_id = ${demurrageId};
    DELETE FROM public.demurrage_invoices WHERE id = ${demurrageId};
    DELETE FROM public.bls WHERE id = '${blId}';
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.user_profiles WHERE id = '${userId}';
    DELETE FROM auth.users WHERE id = '${userId}';
    SET session_replication_role = origin;
    UPDATE public.app_settings SET pix_provider = 'static' WHERE id = 1;
  `)
}

describeLocal('cobranças Itaú Pix (migration 150) — PostgreSQL local', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${userId}', 'admin-150@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${userId}', 'Admin 150', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '${syntheticCnpj(98801)}', 'Cliente Itau 150');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier 150');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel 150', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number) VALUES (${voyageId}, ${vesselId}, 'VOY-150');
      INSERT INTO public.bls (id, voyage_id, customer_id) VALUES ('${blId}', ${voyageId}, ${customerId});
    `)
  })
  afterAll(() => cleanup())

  it('com o provedor estático nada muda: QR estático e nenhuma cobrança Itaú', () => {
    setProvider('static')
    const id = manualInvoice('ITAU150-S', 10.5)
    expect(psql(`SELECT left(pix_payload, 14) FROM public.invoices WHERE id = ${id}`)).toBe('00020126360014')
    expect(charges(`invoice_id = ${id}`)).toEqual([])
  })

  it('virada: fatura aberta antes da chave ganha cobrança pelo procedimento do manual; paga não', () => {
    setProvider('static')
    const open = manualInvoice('ITAU150-V1', 7)
    const paid = manualInvoice('ITAU150-V2', 8)
    psql(`SET session_replication_role = replica; UPDATE public.invoices SET status = 'paid', balance_brl = 0 WHERE id = ${paid}; SET session_replication_role = origin`)
    setProvider('itau')
    expect(charges(`invoice_id IN (${open}, ${paid})`)).toEqual([]) // virar a chave sozinho não basta
    // Mesmo SQL de docs/operations/servicos-externos.md (Itaú — virada).
    psql(`UPDATE public.invoices SET pix_payload = NULL
      WHERE invoice_type IN ('individual', 'consolidated', 'manual') AND status IN ('issued', 'partially_paid', 'overdue')
        AND customer_id = ${customerId} AND id IN (${open}, ${paid})`)
    expect(charges(`invoice_id = ${open}`)).toMatchObject([{ amount: '7.00', status: 'pending_create' }])
    expect(charges(`invoice_id = ${paid}`)).toEqual([])
    expect(psql(`SELECT coalesce(pix_payload, 'NULL') FROM public.invoices WHERE id = ${open}`)).toBe('NULL')
  })

  it('com o Itaú a fatura nasce sem QR e com uma cobrança pendente de TXID do Vela', () => {
    setProvider('itau')
    const id = manualInvoice('ITAU150-A', 0.01)
    expect(psql(`SELECT coalesce(pix_payload, 'NULL') FROM public.invoices WHERE id = ${id}`)).toBe('NULL')
    const [charge] = charges(`invoice_id = ${id}`)
    expect(charge).toMatchObject({ amount: '0.01', status: 'pending_create', attempts: 0 })
    expect(charge.txid).toMatch(/^VELA[0-9A-F]{28}$/)
  })

  it('reserva, ativa e publica o copia e cola na fatura e na conciliação por TXID', () => {
    setProvider('itau')
    const id = manualInvoice('ITAU150-B', 2.5)
    const [charge] = charges(`invoice_id = ${id}`)
    const claimed = psql(`SELECT string_agg(id::text, ',') FROM public.itau_pix_claim(100)`).split(',')
    expect(claimed).toContain(String(charge.id))
    // O lease impede outra execução de pegar a mesma cobrança logo em seguida.
    expect(psql(`SELECT count(*) FROM public.itau_pix_claim(100) WHERE id = ${charge.id}`)).toBe('0')
    expect(psql(`SELECT public.itau_pix_record(${charge.id}, 'active', 0, '000201ITAUCOB-B')`)).toBe('active')
    expect(psql(`SELECT pix_payload FROM public.invoices WHERE id = ${id}`)).toBe('000201ITAUCOB-B')
    expect(psql(`SELECT amount_brl || '|' || payload FROM public.local_pix_charge_versions WHERE txid = '${charge.txid}'`))
      .toBe('2.50|000201ITAUCOB-B')
  })

  it('saldo novo cancela a cobrança ativa e cria outra; a fatura volta a "QR em preparação"', () => {
    setProvider('itau')
    const id = manualInvoice('ITAU150-C', 3)
    const [first] = charges(`invoice_id = ${id}`)
    psql(`SELECT public.itau_pix_claim(100)`)
    psql(`SELECT public.itau_pix_record(${first.id}, 'active', 0, '000201ITAUCOB-C1')`)
    psql(`UPDATE public.invoices SET balance_brl = 1.25, status = 'partially_paid' WHERE id = ${id}`)
    const after = charges(`invoice_id = ${id}`)
    expect(after.map((c) => [c.amount, c.status])).toEqual([['3.00', 'pending_cancel'], ['1.25', 'pending_create']])
    expect(psql(`SELECT coalesce(pix_payload, 'NULL') FROM public.invoices WHERE id = ${id}`)).toBe('NULL')
  })

  it('cobrança nunca enviada é descartada sem chamar o Itaú quando a fatura é cancelada', () => {
    setProvider('itau')
    const id = manualInvoice('ITAU150-D', 4)
    psql(`SET request.jwt.claim.sub = '${userId}'; UPDATE public.invoices SET status = 'cancelled' WHERE id = ${id}`)
    expect(charges(`invoice_id = ${id}`).map((c) => c.status)).toEqual(['cancelled'])
  })

  it('resposta de criação que chega depois de uma mudança não reativa a cobrança', () => {
    setProvider('itau')
    const id = manualInvoice('ITAU150-E', 5)
    const [charge] = charges(`invoice_id = ${id}`)
    psql(`SELECT public.itau_pix_claim(100)`) // em andamento no Itaú
    psql(`SET request.jwt.claim.sub = '${userId}'; UPDATE public.invoices SET status = 'cancelled' WHERE id = ${id}`)
    expect(charges(`id = ${charge.id}`)[0].status).toBe('pending_cancel')
    expect(psql(`SELECT public.itau_pix_record(${charge.id}, 'active', 0, '000201ITAUCOB-E')`)).toBe('pending_cancel')
    expect(psql(`SELECT coalesce(pix_payload, 'NULL') FROM public.invoices WHERE id = ${id}`)).toBe('NULL')
    expect(psql(`SELECT public.itau_pix_record(${charge.id}, 'concluded')`)).toBe('concluded')
  })

  it('Demurrage: substitui o QR estático das RPCs e acompanha a nova PTAX', () => {
    setProvider('itau')
    psql(`INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, total_usd, current_roe, current_total_brl, roe_source, status, pix_payload)
      VALUES (${demurrageId}, 'ITAU150-DEM', '${blId}', ${customerId}, 100, 5.5, 550, 'manual', 'issued', 'QR-ESTATICO')`)
    expect(psql(`SELECT coalesce(pix_payload, 'NULL') FROM public.demurrage_invoices WHERE id = ${demurrageId}`)).toBe('NULL')
    psql(`UPDATE public.demurrage_invoices SET current_roe = 5.6, current_total_brl = 560 WHERE id = ${demurrageId}`)
    const rows = charges(`demurrage_invoice_id = ${demurrageId}`)
    expect(rows.map((c) => [c.amount, c.status])).toEqual([['550.00', 'cancelled'], ['560.00', 'pending_create']])
    psql(`SELECT public.itau_pix_claim(100)`)
    psql(`SELECT public.itau_pix_record(${rows[1].id}, 'active', 0, '000201ITAUCOB-DEM')`)
    expect(psql(`SELECT pix_payload FROM public.demurrage_invoices WHERE id = ${demurrageId}`)).toBe('000201ITAUCOB-DEM')
  })

  it('emissão real de avulsa pela RPC não deixa escapar o QR estático', () => {
    setProvider('itau')
    const result = JSON.parse(psql(`SET request.jwt.claim.sub = '${userId}';
      SELECT public.create_manual_invoice(${customerId}, 'Teste Itau', 1, 0.01, NULL, NULL, NULL, '${userId}'::uuid)`)) as { invoice_id: number }
    expect(psql(`SELECT coalesce(pix_payload, 'NULL') FROM public.invoices WHERE id = ${result.invoice_id}`)).toBe('NULL')
    expect(charges(`invoice_id = ${result.invoice_id}`).map((c) => [c.amount, c.status])).toEqual([['0.01', 'pending_create']])
  })

  it('navegador não lê a fila nem executa o processador', () => {
    expect(asAuthenticated('SELECT count(*) FROM public.itau_pix_charges')).toMatch(/permission denied|permissão negada/)
    expect(asAuthenticated('SELECT public.itau_pix_claim(1)')).toMatch(/permission denied|permissão negada/)
    expect(asAuthenticated(`SELECT public.itau_pix_record(1, 'cancelled')`)).toMatch(/permission denied|permissão negada/)
  })
})
