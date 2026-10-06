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
const demurrage2Id = 998806
const bl2Id = 'ITAU-152-BL'
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
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE metadata->>'end_to_end_id' LIKE 'E15%');
    DELETE FROM public.alert_items WHERE metadata->>'end_to_end_id' LIKE 'E15%';
    DELETE FROM public.itau_pix_receipts WHERE end_to_end_id LIKE 'E15%';
    DELETE FROM public.financial_payment_attempts WHERE created_by = '${userId}';
    DELETE FROM public.payments WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_type = 'exchange_rate_reference' AND entity_id LIKE 'itau-pix-%');
    DELETE FROM public.demurrage_mutation_requests WHERE invoice_id IN (${demurrageId}, ${demurrage2Id});
    DELETE FROM public.demurrage_invoice_history WHERE invoice_id IN (${demurrageId}, ${demurrage2Id});
    DELETE FROM public.itau_pix_charges WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId})
      OR demurrage_invoice_id IN (${demurrageId}, ${demurrage2Id});
    DELETE FROM public.local_pix_charge_versions WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id = ${customerId});
    DELETE FROM public.invoices WHERE customer_id = ${customerId};
    DELETE FROM public.demurrage_calculation_snapshots WHERE demurrage_invoice_id IN (${demurrageId}, ${demurrage2Id});
    DELETE FROM public.demurrage_invoices WHERE id IN (${demurrageId}, ${demurrage2Id});
    DELETE FROM public.bls WHERE id IN ('${blId}', '${bl2Id}');
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.user_profiles WHERE id = '${userId}';
    DELETE FROM auth.users WHERE id = '${userId}';
    SET session_replication_role = origin;
    UPDATE public.app_settings SET pix_provider = 'static', itau_pix_settlement_actor = NULL WHERE id = 1;
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
      INSERT INTO public.bls (id, voyage_id, customer_id) VALUES ('${blId}', ${voyageId}, ${customerId}), ('${bl2Id}', ${voyageId}, ${customerId});
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

  it('reserva, ativa e publica o copia e cola na fatura', () => {
    setProvider('itau')
    const id = manualInvoice('ITAU150-B', 2.5)
    const [charge] = charges(`invoice_id = ${id}`)
    const claimed = psql(`SELECT string_agg(id::text, ',') FROM public.itau_pix_claim(100)`).split(',')
    expect(claimed).toContain(String(charge.id))
    // O lease impede outra execução de pegar a mesma cobrança logo em seguida.
    expect(psql(`SELECT count(*) FROM public.itau_pix_claim(100) WHERE id = ${charge.id}`)).toBe('0')
    expect(psql(`SELECT public.itau_pix_record(${charge.id}, 'active', 0, '000201ITAUCOB-B', NULL, now())`)).toBe('active')
    expect(psql(`SELECT pix_payload FROM public.invoices WHERE id = ${id}`)).toBe('000201ITAUCOB-B')
    // Espelho em local_pix_charge_versions só para individual/consolidada (151);
    // provado em invoicePostBillingSafety, que baixa a individual pelo resolvedor da 130.
    expect(charges(`id = ${charge.id}`)[0].status).toBe('active')
  })

  it('saldo novo cancela a cobrança ativa e cria outra; a fatura volta a "QR em preparação"', () => {
    setProvider('itau')
    const id = manualInvoice('ITAU150-C', 3)
    const [first] = charges(`invoice_id = ${id}`)
    psql(`SELECT public.itau_pix_claim(100)`)
    psql(`SELECT public.itau_pix_record(${first.id}, 'active', 0, '000201ITAUCOB-C1', NULL, now())`)
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
    // A reserva da criação em andamento continua valendo: outra execução não pega o
    // cancelamento antes de a criação responder.
    expect(psql(`SELECT count(*) FROM public.itau_pix_claim(100) WHERE id = ${charge.id}`)).toBe('0')
    expect(psql(`SELECT public.itau_pix_record(${charge.id}, 'active', 0, '000201ITAUCOB-E', NULL, now())`)).toBe('pending_cancel')
    // Criação registrada: a reserva termina e o cancelamento segue na próxima execução.
    expect(psql(`SELECT count(*) FROM public.itau_pix_claim(100) WHERE id = ${charge.id}`)).toBe('1')
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
    psql(`SELECT public.itau_pix_record(${rows[1].id}, 'active', 0, '000201ITAUCOB-DEM', NULL, now())`)
    expect(psql(`SELECT pix_payload FROM public.demurrage_invoices WHERE id = ${demurrageId}`)).toBe('000201ITAUCOB-DEM')
  })

  it('emissão real de avulsa pela RPC não deixa escapar o QR estático', () => {
    setProvider('itau')
    const result = JSON.parse(psql(`SET request.jwt.claim.sub = '${userId}';
      SELECT public.create_manual_invoice(${customerId}, 'Teste Itau', 1, 0.01, NULL, NULL, NULL, '${userId}'::uuid)`)) as { invoice_id: number }
    expect(psql(`SELECT coalesce(pix_payload, 'NULL') FROM public.invoices WHERE id = ${result.invoice_id}`)).toBe('NULL')
    expect(charges(`invoice_id = ${result.invoice_id}`).map((c) => [c.amount, c.status])).toEqual([['0.01', 'pending_create']])
  })

  // Baixa (migration 151). Como a Edge Function, roda com o papel service_role.
  const settle = (e2e: string, txid: string, amount: string) =>
    psql(`SET request.jwt.claim.role = 'service_role'; SELECT public.itau_pix_settle('${e2e}', '${txid}', ${amount}, now())`)
  const activate = (where: string, payload: string) => {
    const [charge] = charges(`${where} AND status = 'pending_create'`)
    psql(`SELECT public.itau_pix_claim(100); SELECT public.itau_pix_record(${charge.id}, 'active', 0, '${payload}', NULL, now())`)
    return charge
  }

  it('sem usuário de baixa configurado o Pix vai para análise e a cobrança fica paga', () => {
    setProvider('itau')
    psql(`UPDATE public.app_settings SET itau_pix_settlement_actor = NULL WHERE id = 1`)
    const id = manualInvoice('ITAU151-SEM', 0.03)
    const charge = activate(`invoice_id = ${id}`, '000201ITAU151SEM')
    expect(settle('E151SEMATOR', charge.txid, '0.03')).toBe('review')
    expect(psql(`SELECT reason FROM public.itau_pix_receipts WHERE end_to_end_id = 'E151SEMATOR'`)).toContain('não configurado')
    expect(psql(`SELECT status FROM public.invoices WHERE id = ${id}`)).toBe('issued')
    expect(charges(`id = ${charge.id}`)[0].status).toBe('concluded')
  })

  it('avulsa é baixada pelo endToEndId e a repetição não cria segunda baixa', () => {
    setProvider('itau')
    psql(`UPDATE public.app_settings SET itau_pix_settlement_actor = '${userId}' WHERE id = 1`)
    const id = manualInvoice('ITAU151-AV', 0.02)
    const charge = activate(`invoice_id = ${id}`, '000201ITAU151AV')
    expect(settle('E151AVULSA', charge.txid, '0.02')).toBe('settled')
    expect(settle('E151AVULSA', charge.txid, '0.02')).toBe('settled')
    expect(psql(`SELECT status FROM public.invoices WHERE id = ${id}`)).toBe('paid')
    expect(psql(`SELECT count(*) || '|' || max(bank_reference) FROM public.payments WHERE invoice_id = ${id}`)).toBe('1|E151AVULSA')
    // A avulsa não entra no resolvedor da 130 (o extrato não a leva ao ledger).
    expect(psql(`SELECT count(*) FROM public.local_pix_charge_versions WHERE txid = '${charge.txid}'`)).toBe('0')
  })

  it('erro passageiro do banco não manda o Pix para análise: a próxima consulta baixa', () => {
    setProvider('itau')
    psql(`UPDATE public.app_settings SET itau_pix_settlement_actor = '${userId}' WHERE id = 1`)
    const id = manualInvoice('ITAU151-LOCK', 0.04)
    const charge = activate(`invoice_id = ${id}`, '000201ITAU151LOCK')
    // Simula lock não obtido (55P03) no momento da baixa.
    psql(`CREATE FUNCTION pg_temp_itau_lock() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'lock simulado' USING ERRCODE = '55P03'; END $$;
      CREATE TRIGGER itau_151_lock BEFORE INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION pg_temp_itau_lock()`)
    try {
      expect(() => settle('E151LOCK', charge.txid, '0.04')).toThrow(/lock simulado/)
    } finally {
      psql(`DROP TRIGGER itau_151_lock ON public.payments; DROP FUNCTION pg_temp_itau_lock()`)
    }
    expect(psql(`SELECT count(*) FROM public.itau_pix_receipts WHERE end_to_end_id = 'E151LOCK'`)).toBe('0')
    expect(charges(`id = ${charge.id}`)[0].status).toBe('active') // tudo desfeito
    expect(settle('E151LOCK', charge.txid, '0.04')).toBe('settled')
    expect(psql(`SELECT status FROM public.invoices WHERE id = ${id}`)).toBe('paid')
  })

  it('Demurrage é baixada pelo valor da cobrança paga; TXID desconhecido vai para análise', () => {
    setProvider('itau')
    // A cobrança de 560 foi ativada no teste de PTAX acima.
    const [charge] = charges(`demurrage_invoice_id = ${demurrageId} AND status = 'active'`)
    const amount = charge.amount
    expect(settle('E151DEM', charge.txid, amount)).toBe('settled')
    expect(psql(`SELECT status || '|' || pix_txid FROM public.demurrage_invoices WHERE id = ${demurrageId}`)).toBe(`paid|${charge.txid}`)
    expect(settle('E151DESCONHECIDO', 'VELA' + '0'.repeat(28), '1.00')).toBe('review')
    expect(psql(`SELECT count(*) FROM public.alert_items WHERE item_type = 'pix_unreconciled' AND status = 'active'
      AND metadata->>'end_to_end_id' = 'E151DESCONHECIDO'`)).toBe('1')
  })

  // ---- Fase 4 (migration 152): prazos, PTAX no mesmo TXID e renovação ----
  it('corte: 14h30 do próximo dia útil de Vitória (fim de semana e feriados)', () => {
    const cutoff = (at: string) => psql(`SELECT to_char(public.itau_pix_cutoff('${at}'::timestamptz) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI')`)
    expect(cutoff('2026-10-07 09:00-03')).toBe('2026-10-08 14:30') // quarta → quinta
    expect(cutoff('2026-10-09 16:00-03')).toBe('2026-10-13 14:30') // sexta → terça (12/10 feriado)
    expect(cutoff('2026-12-31 12:00-03')).toBe('2027-01-04 14:30') // 1º/01 e fim de semana
    // Ano sem calendário: não para, só fins de semana contam (1º/01/2028 vira dia útil).
    expect(cutoff('2027-12-31 15:00-03')).toBe('2028-01-03 14:30') // sexta → segunda
    expect(cutoff('2027-12-30 15:00-03')).toBe('2027-12-31 14:30')
  })

  it('calendário do ano seguinte: Alerta próprio a partir de 1º/11, fechado quando o ano é cadastrado', () => {
    setProvider('itau')
    const open = () => psql(`SELECT count(*) FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id
      WHERE a.entity_id = 'itau-pix-calendar' AND ai.item_type = 'calendario_feriados_pendente' AND ai.status = 'active'`)
    const maintain = (at: string) => psql(`SET request.jwt.claim.role = 'service_role'; SELECT public.itau_pix_maintain('${at}')`)
    try {
      maintain('2027-11-03 10:00-03')
      expect(open()).toBe('1')
      psql(`INSERT INTO public.business_holidays(day) VALUES ('2028-01-01')`)
      maintain('2027-11-03 10:05-03')
      expect(open()).toBe('0')
    } finally {
      psql(`DELETE FROM public.business_holidays WHERE day = '2028-01-01'`)
    }
  })

  it('Demurrage: nova PTAX altera a MESMA cobrança e o Pix da revisão anterior ainda quita', () => {
    setProvider('itau')
    psql(`INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, total_usd, current_roe, current_total_brl, roe_source, status)
      VALUES (${demurrage2Id}, 'ITAU152-DEM', '${bl2Id}', ${customerId}, 100, 5.6, 560, 'manual', 'issued')`)
    const [charge] = charges(`demurrage_invoice_id = ${demurrage2Id}`)
    psql(`SELECT public.itau_pix_claim(100); SELECT public.itau_pix_record(${charge.id}, 'active', 0, '000201ITAU152', NULL, now() - interval '1 hour')`)
    // PTAX do dia: mesma linha, mesmo TXID, valor novo e validade até o próximo corte; QR continua visível.
    psql(`UPDATE public.demurrage_invoices SET current_roe = 5.7, current_total_brl = 570 WHERE id = ${demurrage2Id}`)
    const after = charges(`demurrage_invoice_id = ${demurrage2Id}`)
    expect(after.map((c) => [c.txid, c.amount, c.status])).toEqual([[charge.txid, '570.00', 'pending_update']])
    expect(psql(`SELECT pix_payload FROM public.demurrage_invoices WHERE id = ${demurrage2Id}`)).toBe('000201ITAU152')
    expect(psql(`SELECT bank_created_at + make_interval(secs => expiration_seconds) >= public.itau_pix_cutoff(now())
      FROM public.itau_pix_charges WHERE id = ${charge.id}`)).toBe('t')
    psql(`SELECT public.itau_pix_claim(100); SELECT public.itau_pix_record(${charge.id}, 'active', 1, '000201ITAU152')`)
    expect(charges(`id = ${charge.id}`)[0].status).toBe('active')
    // Cliente pagou a revisão anterior (560) durante a troca: quita pelo valor pago.
    psql(`INSERT INTO public.demurrage_invoice_history(invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
      VALUES (${demurrage2Id}, current_date - 1, 5.5, 5.6, 100, 560, 0, 'manual'), (${demurrage2Id}, current_date, 5.6, 5.7, 100, 570, 0, 'manual')`)
    expect(settle('E151REVANTERIOR', charge.txid, '560.00')).toBe('settled')
    expect(psql(`SELECT status FROM public.demurrage_invoices WHERE id = ${demurrage2Id}`)).toBe('paid')
  })

  it('vencida: confirma no banco e substitui com novo TXID; Taxas Locais renovam a mesma cobrança', () => {
    setProvider('itau')
    const expiring = manualInvoice('ITAU152-VENC', 0.04)
    const old = activate(`invoice_id = ${expiring}`, '000201ITAU152V')
    psql(`UPDATE public.itau_pix_charges SET expires_at = now() - interval '1 minute' WHERE id = ${old.id}`)
    const renewing = manualInvoice('ITAU152-REN', 0.05)
    const kept = activate(`invoice_id = ${renewing}`, '000201ITAU152R')
    psql(`UPDATE public.itau_pix_charges SET expires_at = now() + interval '2 days' WHERE id = ${kept.id}`)
    const result = JSON.parse(psql("SET request.jwt.claim.role = 'service_role'; SELECT public.itau_pix_maintain()")) as { expired: number; renewed: number }
    expect(result.expired).toBeGreaterThanOrEqual(1)
    expect(result.renewed).toBeGreaterThanOrEqual(1)
    expect(charges(`id = ${old.id}`)[0].status).toBe('pending_expire_check')
    expect(charges(`id = ${kept.id}`)[0].status).toBe('pending_update')
    expect(psql(`SELECT expiration_seconds > 29 * 86400 FROM public.itau_pix_charges WHERE id = ${kept.id}`)).toBe('t')
    // Banco confirma: vencida e não paga → nova cobrança, novo TXID, QR em preparação.
    psql(`SELECT public.itau_pix_record(${old.id}, 'expired')`)
    const replaced = charges(`invoice_id = ${expiring}`)
    expect(replaced.map((c) => c.status)).toEqual(['expired', 'pending_create'])
    expect(replaced[1].txid).not.toBe(old.txid)
    expect(psql(`SELECT coalesce(pix_payload, 'NULL') FROM public.invoices WHERE id = ${expiring}`)).toBe('NULL')
  })

  it('às 14h de dia útil, Demurrage sem a PTAX do dia abre Alerta para a Documentação', () => {
    setProvider('itau')
    const before = psql("SELECT coalesce(quote_date::text, '') FROM public.exchange_rate_reference WHERE id = 1")
    try {
      // Quarta 07/10, 14h10, com a referência de 06/10: a Demurrage aberta não reflete a PTAX do dia.
      psql("UPDATE public.exchange_rate_reference SET quote_date = DATE '2026-10-06' WHERE id = 1")
      psql(`INSERT INTO public.bls (id, voyage_id, customer_id) VALUES ('ITAU-152-BL3', ${voyageId}, ${customerId});
        INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, total_usd, current_roe, current_total_brl, roe_source, status)
        VALUES (998807, 'ITAU152-DEM3', 'ITAU-152-BL3', ${customerId}, 10, 5.6, 56, 'manual', 'issued')`)
      const result = JSON.parse(psql("SET request.jwt.claim.role = 'service_role'; SELECT public.itau_pix_maintain('2026-10-07 14:10-03')")) as { ptax_pending: number }
      expect(result.ptax_pending).toBeGreaterThanOrEqual(1)
      expect(psql(`SELECT count(*) FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id
        WHERE a.entity_id = 'itau-pix-14h' AND ai.item_type = 'demurrage_ptax_recalc_failed' AND ai.status = 'active'`)).toBe('1')
      // Antes das 14h não alerta.
      expect(JSON.parse(psql("SET request.jwt.claim.role = 'service_role'; SELECT public.itau_pix_maintain('2026-10-07 13:50-03')")).ptax_pending).toBeNull()
    } finally {
      psql(`UPDATE public.exchange_rate_reference SET quote_date = ${before ? `'${before}'` : 'NULL'} WHERE id = 1`)
      psql(`SET session_replication_role = replica;
        DELETE FROM public.itau_pix_charges WHERE demurrage_invoice_id = 998807;
        DELETE FROM public.demurrage_calculation_snapshots WHERE demurrage_invoice_id = 998807;
        DELETE FROM public.demurrage_invoices WHERE id = 998807; DELETE FROM public.bls WHERE id = 'ITAU-152-BL3'`)
    }
  })

  it('navegador não lê a fila nem executa o processador', () => {
    expect(asAuthenticated('SELECT count(*) FROM public.itau_pix_charges')).toMatch(/permission denied|permissão negada/)
    expect(asAuthenticated('SELECT public.itau_pix_claim(1)')).toMatch(/permission denied|permissão negada/)
    expect(asAuthenticated(`SELECT public.itau_pix_record(1, 'cancelled')`)).toMatch(/permission denied|permissão negada/)
    expect(asAuthenticated(`SELECT public.itau_pix_settle('E1', 'VELA', 1, now())`)).toMatch(/permission denied|permissão negada/)
    expect(asAuthenticated('SELECT count(*) FROM public.itau_pix_receipts')).toMatch(/permission denied|permissão negada/)
    expect(asAuthenticated('SELECT public.itau_pix_maintain()')).toMatch(/permission denied|permissão negada/)
  })

  // ---- Fase 5 (migration 153): monitoramento na Conciliação PIX ----
  it('Admin lê o monitoramento com cancelamento pendente; outro perfil não', () => {
    setProvider('itau')
    const id = manualInvoice('ITAU153-MON', 0.06)
    activate(`invoice_id = ${id}`, '000201ITAU153')
    psql(`SET request.jwt.claim.sub = '${userId}'; UPDATE public.invoices SET status = 'cancelled' WHERE id = ${id}`)
    const monitor = JSON.parse(asAuthenticated('SELECT public.itau_pix_monitor()')) as {
      provider: string; charges: { doc_number: string; status: string }[]
    }
    expect(monitor.provider).toBe('itau')
    expect(monitor.charges).toContainEqual(expect.objectContaining({ doc_number: 'ITAU153-MON', status: 'pending_cancel' }))
    psql(`UPDATE public.user_profiles SET role = 'operacoes' WHERE id = '${userId}'`)
    try {
      expect(asAuthenticated('SELECT public.itau_pix_monitor()')).toMatch(/Sem permissao/)
    } finally {
      psql(`UPDATE public.user_profiles SET role = 'administrativo' WHERE id = '${userId}'`)
    }
  })

  const reviewAlertOpen = (e2e: string) => psql(`SELECT count(*) FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id
    WHERE a.entity_id = '${e2e}' AND ai.item_type = 'pix_unreconciled' AND ai.status = 'active'`)
  const monitorOf = () => JSON.parse(asAuthenticated('SELECT public.itau_pix_monitor()')) as {
    charges: { txid: string }[]; receipts: { end_to_end_id: string }[]
  }

  it('Pix em análise fecha sozinho quando a fatura fica paga por baixa manual', () => {
    setProvider('itau')
    psql(`UPDATE public.app_settings SET itau_pix_settlement_actor = NULL WHERE id = 1`)
    const id = manualInvoice('ITAU153-PAGA', 0.07)
    const charge = activate(`invoice_id = ${id}`, '000201ITAU153P')
    expect(settle('E153PAGA', charge.txid, '0.07')).toBe('review') // sem usuário de baixa
    expect(reviewAlertOpen('E153PAGA')).toBe('1')
    expect(monitorOf().receipts.map((r) => r.end_to_end_id)).toContain('E153PAGA')
    // Baixa manual de exceção pelo Administrativo.
    psql(`SET request.jwt.claim.sub = '${userId}'; UPDATE public.invoices SET status = 'paid', balance_brl = 0 WHERE id = ${id}`)
    expect(psql(`SELECT status || '|' || handled_note FROM public.itau_pix_receipts WHERE end_to_end_id = 'E153PAGA'`))
      .toBe('handled|Fatura paga por baixa manual.')
    expect(reviewAlertOpen('E153PAGA')).toBe('0')
    expect(monitorOf().receipts.map((r) => r.end_to_end_id)).not.toContain('E153PAGA')
  })

  it('Admin marca como tratado com motivo; sem motivo ou outro perfil é recusado', () => {
    setProvider('itau')
    expect(settle('E153TRATAR', 'VELA' + '1'.repeat(28), '2.00')).toBe('review') // TXID sem cobrança
    expect(asAuthenticated(`SELECT public.itau_pix_mark_receipt_handled('E153TRATAR', ' ')`)).toMatch(/motivo/)
    psql(`UPDATE public.user_profiles SET role = 'operacoes' WHERE id = '${userId}'`)
    try {
      expect(asAuthenticated(`SELECT public.itau_pix_mark_receipt_handled('E153TRATAR', 'Restituído ao pagador')`)).toMatch(/Sem permissao/)
    } finally {
      psql(`UPDATE public.user_profiles SET role = 'administrativo' WHERE id = '${userId}'`)
    }
    asAuthenticated(`SELECT public.itau_pix_mark_receipt_handled('E153TRATAR', 'Restituído ao pagador')`)
    expect(psql(`SELECT status || '|' || handled_by || '|' || handled_note FROM public.itau_pix_receipts WHERE end_to_end_id = 'E153TRATAR'`))
      .toBe(`handled|${userId}|Restituído ao pagador`)
    expect(reviewAlertOpen('E153TRATAR')).toBe('0')
    expect(asAuthenticated(`SELECT public.itau_pix_mark_receipt_handled('E153TRATAR', 'De novo')`)).toMatch(/não está em análise/)
  })

  it('cobrança encerrada com erro antigo não aparece em "pedem atenção"', () => {
    setProvider('itau')
    const id = manualInvoice('ITAU153-ERRO', 0.08)
    const charge = activate(`invoice_id = ${id}`, '000201ITAU153E')
    psql(`UPDATE public.itau_pix_charges SET last_error = 'falha antiga' WHERE id = ${charge.id}`)
    settle('E153ERRO', charge.txid, '0.08')
    expect(charges(`id = ${charge.id}`)[0].status).toBe('concluded')
    expect(monitorOf().charges.map((c) => c.txid)).not.toContain(charge.txid)
  })
})
