import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

// Régua de Cobrança de Demurrage: plano dos e-mails (docs/plans/2026-10-17-correcao-dos-emails.md),
// itens 1E, 2.5, 4.2, 4.3 e 4.4 (migrations 305 e 306).
// Opt-in (`LOCAL_PG_INTEGRATION=1` + `LOCAL_DATABASE_URL`).

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const adminId = '00000000-0000-0000-0000-000000030301'
const customerId = 99030301
const carrierId = 99030303
const vesselId = 99030304
const voyageId = 99030305
const invoiceIds = Array.from({ length: 6 }, (_, index) => 99330300 + index + 1)
const [invoiceA, invoiceB, invoiceD, invoiceE, invoiceF, invoiceG] = invoiceIds as [number, number, number, number, number, number]
const customerCnpj = syntheticCnpj(30301)
// Quinta-feira, 10/09/2026, 09:00 em Brasília: dia útil, dentro da janela.
const BUSINESS_MORNING = "'2026-09-10T12:00:00Z'::timestamptz"

function psql(sql: string): string {
  return execPsql([
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${adminId}'; ${sql}`,
  ], { encoding: 'utf8' }).trim()
}

function psqlResult(sql: string) {
  return spawnPsql([
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${adminId}'; ${sql}`,
  ], { encoding: 'utf8' })
}

type Candidate = { invoice_id: number; attempt_discriminator: number; roe_reference_date?: string; resume_generation?: number }

function claimAt(asOf: string): Candidate[] {
  return (JSON.parse(psql(`SELECT public.claim_demurrage_dunning_candidates(${asOf}, 50);`)) as Candidate[])
    .filter((candidate) => invoiceIds.includes(Number(candidate.invoice_id)))
}

function cleanup(): void {
  psql(`
    DELETE FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
    DELETE FROM public.customer_communication_dunning_invoices WHERE customer_id = ${customerId};
    DELETE FROM public.customer_communication_dunning_groups WHERE customer_id = ${customerId};
    DELETE FROM public.customer_communications WHERE customer_id = ${customerId};
    DELETE FROM public.alerts WHERE entity_type = 'demurrage_invoice' AND entity_id IN (${invoiceIds.map((id) => `'${id}'`).join(',')});
    DELETE FROM public.demurrage_invoice_history WHERE invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
    DELETE FROM public.demurrage_mutation_requests WHERE invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
    SET session_replication_role = replica;
    DELETE FROM public.demurrage_invoices WHERE id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
    SET session_replication_role = origin;
    DELETE FROM public.bls WHERE id LIKE 'REG303-BL-%';
    DELETE FROM public.customer_contact_change_events WHERE customer_id = ${customerId};
    DELETE FROM public.customer_contacts WHERE customer_id = ${customerId};
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    SET session_replication_role = replica;
    DELETE FROM public.portal_provisioning_events WHERE customer_id = ${customerId};
    DELETE FROM public.customer_portal_accounts WHERE customer_id = ${customerId};
    DELETE FROM public.customers WHERE id = ${customerId};
    SET session_replication_role = origin;
    DELETE FROM public.audit_logs WHERE changed_by = '${adminId}' OR (entity_type = 'demurrage_invoice' AND entity_id IN (${invoiceIds.map((id) => `'${id}'`).join(',')}));
    DELETE FROM public.alert_item_events WHERE actor_id = '${adminId}';
    DELETE FROM public.alerts WHERE entity_type = 'customer' AND entity_id = '${customerId}';
    DELETE FROM public.user_profiles WHERE id = '${adminId}';
    DELETE FROM auth.users WHERE id = '${adminId}';
  `)
}

describeLocal('Régua de Cobrança de Demurrage — plano dos e-mails (1E, 2.5, 4.2–4.4)', () => {
  beforeAll(() => {
    cleanup()
    const bls = invoiceIds.map((id) => `('REG303-BL-${id}', ${voyageId}, ${customerId}, 'container', 'CE-${id}')`).join(',\n        ')
    const invoices = invoiceIds
      .map((id) => `(${id}, 'REG303-${id}', 'REG303-BL-${id}', ${customerId}, '2026-09-01', '2026-09-01', 100, 5.5, 550, 'manual', 'issued')`)
      .join(',\n        ')
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'reg303@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${adminId}', 'Reg 303', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '${customerCnpj}', 'Cliente Régua 303');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier 303');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel 303', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'R303', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode, ce_mercante) VALUES ${bls};
      INSERT INTO public.demurrage_invoices
        (id, doc_number, bl_id, customer_id, doc_date, first_billed_at, total_usd, current_roe, current_total_brl, roe_source, status)
      VALUES ${invoices};
      INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
      VALUES (${customerId}, 'Financeiro 303', 'reg303-fin@example.test', 'financeiro', true);
      UPDATE public.app_settings SET demurrage_dunning_interval_days = 7 WHERE id = 1;
    `)
  })

  afterAll(() => {
    cleanup()
  })

  beforeEach(() => {
    psql(`
      DELETE FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.customer_communication_dunning_invoices WHERE customer_id = ${customerId};
      DELETE FROM public.customer_communication_dunning_groups WHERE customer_id = ${customerId};
      DELETE FROM public.customer_communications WHERE customer_id = ${customerId};
      DELETE FROM public.alerts WHERE entity_type = 'demurrage_invoice' AND entity_id IN (${invoiceIds.map((id) => `'${id}'`).join(',')});
      UPDATE public.demurrage_invoices SET dunning_suspended_reason = NULL WHERE id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
    `)
  })

  it('1E.2 — grupo {B,D} que falhou seguido de {A,B,D} cria o grupo novo, sem duplicate key', () => {
    const createGroup = (ids: number[]) => psqlResult(`
      SELECT public.create_customer_dunning_group_atomic(
        ${customerId}, 1, ARRAY[${ids.join(',')}]::bigint[], ${voyageId}, 'BRSSZ', 'Vessel 303', 'R303', NULL);
    `)
    const failed = createGroup([invoiceB, invoiceD])
    expect(failed.status, failed.stderr).toBe(0)
    const failedId = failed.stdout.trim()
    psql(`UPDATE public.customer_communications SET status = 'falha' WHERE id = ${failedId};`)

    const next = createGroup([invoiceA, invoiceB, invoiceD])
    expect(next.status, next.stderr).toBe(0)
    const nextId = next.stdout.trim()
    expect(nextId).not.toBe(failedId)
    expect(psql(`
      SELECT string_agg(demurrage_invoice_id::text, ',' ORDER BY demurrage_invoice_id)
      FROM public.customer_communication_dunning_invoices WHERE communication_id = ${nextId};
    `)).toBe([invoiceA, invoiceB, invoiceD].join(','))
    // O grupo que falhou perde a participação; o histórico do Comunicado fica.
    expect(psql(`SELECT count(*) FROM public.customer_communication_dunning_invoices WHERE communication_id = ${failedId};`)).toBe('0')
    expect(psql(`SELECT status FROM public.customer_communications WHERE id = ${failedId};`)).toBe('falha')
  })

  it('1E.2 — grupo já aceito pelo provedor não perde a participação: a colisão continua recusada', () => {
    const sentId = psql(`
      SELECT public.create_customer_dunning_group_atomic(
        ${customerId}, 1, ARRAY[${invoiceB}, ${invoiceD}]::bigint[], ${voyageId}, 'BRSSZ', 'Vessel 303', 'R303', NULL);
    `)
    psql(`
      INSERT INTO public.customer_communication_attempts (communication_id, recipient_masked, recipient_key, status, dispatch_mode, idempotency_key, provider_message_id)
      VALUES (${sentId}, 'r***@e***.test', 'sha256:reg303', 'aceito', 'real', 'reg303:sent:${sentId}', 'msg-reg303');
    `)
    const next = psqlResult(`
      SELECT public.create_customer_dunning_group_atomic(
        ${customerId}, 1, ARRAY[${invoiceA}, ${invoiceB}, ${invoiceD}]::bigint[], ${voyageId}, 'BRSSZ', 'Vessel 303', 'R303', NULL);
    `)
    expect(next.status).not.toBe(0)
    expect(psql(`SELECT count(*) FROM public.customer_communication_dunning_invoices WHERE communication_id = ${sentId};`)).toBe('2')
  })

  it('1E.3 — fatura com 100% de desconto não vira candidata nem é cobrável', () => {
    psql(`UPDATE public.demurrage_invoices SET discount_mode = 'percent', discount_value = 100 WHERE id = ${invoiceE};`)
    try {
      expect(psql(`SELECT public.demurrage_dunning_candidate_sendable(${invoiceE});`)).toBe('f')
      expect(claimAt(BUSINESS_MORNING).map((item) => Number(item.invoice_id))).not.toContain(invoiceE)
      // Desconto parcial continua cobrável.
      psql(`UPDATE public.demurrage_invoices SET discount_mode = 'fixed', discount_value = 99.99 WHERE id = ${invoiceE};`)
      expect(psql(`SELECT public.demurrage_dunning_candidate_sendable(${invoiceE});`)).toBe('t')
    } finally {
      psql(`UPDATE public.demurrage_invoices SET discount_mode = NULL, discount_value = NULL WHERE id = ${invoiceE};`)
    }
  })

  it('1E.3 (D7) — apply_demurrage_discount com 100% quita a Invoice (isenta), com foto e auditoria', () => {
    const result = JSON.parse(psql(`
      SELECT public.apply_demurrage_discount(gen_random_uuid(), ${invoiceF}, 'percent', 100, 'cortesia', 'Isenção acordada', NULL);
    `)) as { status: string; exempted: boolean; current_total_brl: number }
    expect(result).toMatchObject({ status: 'paid', exempted: true, current_total_brl: 0 })
    expect(psql(`SELECT status, paid_at IS NOT NULL, current_total_brl, pix_payload IS NULL FROM public.demurrage_invoices WHERE id = ${invoiceF};`)).toBe('paid|t|0.00|t')
    expect(psql(`SELECT source, total_brl FROM public.demurrage_invoice_history WHERE invoice_id = ${invoiceF} ORDER BY id DESC LIMIT 1;`)).toBe('payment|0.00')
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_type = 'demurrage_invoice' AND entity_id = '${invoiceF}' AND field_name = 'discount_exemption';`)).toBe('1')
    expect(claimAt(BUSINESS_MORNING).map((item) => Number(item.invoice_id))).not.toContain(invoiceF)
    // Desconto parcial não muda o status.
    const partial = JSON.parse(psql(`
      SELECT public.apply_demurrage_discount(gen_random_uuid(), ${invoiceG}, 'percent', 50, 'cortesia', 'Metade', NULL);
    `)) as { status: string; exempted: boolean }
    expect(partial).toMatchObject({ status: 'issued', exempted: false })
    psql(`
      SET session_replication_role = replica;
      UPDATE public.demurrage_invoices SET status = 'issued', paid_at = NULL, discount_mode = NULL, discount_value = NULL, current_total_brl = 550 WHERE id IN (${invoiceF}, ${invoiceG});
      SET session_replication_role = origin;
    `)
  })

  it('4.4 (D10) — sem liberação do Portal (CE) ou com Cliente desativado a fatura não é cobrada', () => {
    psql(`UPDATE public.bls SET ce_mercante = NULL WHERE id = 'REG303-BL-${invoiceA}';`)
    try {
      expect(psql(`SELECT public.demurrage_dunning_candidate_sendable(${invoiceA});`)).toBe('f')
      const claimed = claimAt(BUSINESS_MORNING).map((item) => Number(item.invoice_id))
      expect(claimed).not.toContain(invoiceA)
      expect(claimed).toContain(invoiceB)
    } finally {
      psql(`UPDATE public.bls SET ce_mercante = 'CE-${invoiceA}' WHERE id = 'REG303-BL-${invoiceA}';`)
    }
    psql(`DELETE FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);`)
    psql(`SET session_replication_role = replica; UPDATE public.customers SET deactivated_at = now() WHERE id = ${customerId}; SET session_replication_role = origin;`)
    try {
      expect(psql(`SELECT public.demurrage_dunning_candidate_sendable(${invoiceB});`)).toBe('f')
      expect(claimAt(BUSINESS_MORNING)).toEqual([])
    } finally {
      psql(`SET session_replication_role = replica; UPDATE public.customers SET deactivated_at = NULL WHERE id = ${customerId}; SET session_replication_role = origin;`)
    }
  })

  it('1E.6 — destinatário pelo critério do envio: caixa desativada tira o contato', () => {
    psql(`UPDATE public.customer_communication_boxes SET active = false WHERE code IN ('financeiro', 'demurrage');`)
    try {
      expect(psql(`SELECT public.demurrage_dunning_candidate_sendable(${invoiceA});`)).toBe('f')
    } finally {
      psql(`UPDATE public.customer_communication_boxes SET active = true WHERE code IN ('financeiro', 'demurrage');`)
    }
    expect(psql(`SELECT public.demurrage_dunning_candidate_sendable(${invoiceA});`)).toBe('t')
  })

  it('4.2 (D9) — só dia útil a partir das 9h de Brasília', () => {
    // Sábado 12/09/2026 10h, segunda 07/09/2026 (feriado) 10h e quinta 10/09/2026 08h59: nada sai.
    expect(claimAt("'2026-09-12T13:00:00Z'::timestamptz")).toEqual([])
    expect(claimAt("'2026-09-07T13:00:00Z'::timestamptz")).toEqual([])
    expect(claimAt("'2026-09-10T11:59:00Z'::timestamptz")).toEqual([])
    // Às 9h do dia útil sai; o vencimento continua contado do último envio.
    const claimed = claimAt(BUSINESS_MORNING)
    expect(claimed.length).toBe(invoiceIds.length)
    expect(psql(`SELECT claimed_at = ${BUSINESS_MORNING} FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id = ${invoiceA};`)).toBe('t')
    psql(`
      INSERT INTO public.customer_communications (customer_id, kind, nature, status, anchor_invoice_id, attempt_discriminator)
      VALUES (${customerId}, 'cobranca_demurrage', 'demurrage', 'enviado', ${invoiceA}, 1);
    `)
    // 2ª cobrança vence 17/09 (quinta) 00h; às 08h ainda não sai, às 9h07 sai.
    expect(claimAt("'2026-09-17T11:00:00Z'::timestamptz").map((item) => Number(item.invoice_id))).not.toContain(invoiceA)
    expect(claimAt("'2026-09-17T12:07:00Z'::timestamptz").find((item) => Number(item.invoice_id) === invoiceA)?.attempt_discriminator).toBe(2)
  })

  it('4.3 — a data do ROE é a da cotação vigente no histórico', () => {
    psql(`
      INSERT INTO public.demurrage_invoice_history (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
      VALUES
        (${invoiceB}, '2026-09-02', 5.3, 5.4, 100, 540, 0, 'bcb_live'),
        (${invoiceB}, '2026-09-05', 5.4, 5.5, 100, 550, 0, 'bcb_live'),
        (${invoiceB}, '2026-09-08', 5.4, 5.5, 100, 500, 10, 'manual');
    `)
    const candidateB = claimAt(BUSINESS_MORNING).find((item) => Number(item.invoice_id) === invoiceB)
    expect(candidateB?.roe_reference_date).toBe('2026-09-05')
    expect(candidateB?.resume_generation).toBe(0)
  })

  it('1E.1 + 2.5 — recusa definitiva suspende, mantém a posição e abre o alerta; resolver retoma com nova geração', () => {
    claimAt(BUSINESS_MORNING)
    psql(`SELECT public.settle_demurrage_dunning_claim(${invoiceD}, 1, 'refused', 'HTTP 422 validation_error');`)
    expect(psql(`SELECT released_at IS NULL, failure_count, last_error FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id = ${invoiceD};`))
      .toBe('t|1|HTTP 422 validation_error')
    expect(psql(`SELECT dunning_suspended_reason FROM public.demurrage_invoices WHERE id = ${invoiceD};`))
      .toBe('Cobrança recusada pelo provedor: HTTP 422 validation_error')
    expect(psql(`
      SELECT i.status, i.department FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'cobranca_demurrage_recusada' AND a.entity_type = 'demurrage_invoice' AND a.entity_id = '${invoiceD}';
    `)).toBe('active|administrativo')
    expect(psql(`SELECT public.demurrage_dunning_candidate_sendable(${invoiceD});`)).toBe('f')
    // Um desfecho "enviado" não fecha o alerta da fatura suspensa: só a pessoa retoma.
    psql(`SELECT public.settle_demurrage_dunning_claim(${invoiceD}, 1, 'sent', NULL);`)
    expect(psql(`
      SELECT i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'cobranca_demurrage_recusada' AND a.entity_id = '${invoiceD}';
    `)).toBe('active')

    // A pessoa corrige o contato e resolve o alerta: a Régua retoma no mesmo discriminador.
    psql(`SELECT public.resolve_alert_item('cobranca_demurrage_recusada', 'demurrage_invoice', '${invoiceD}', 'teste', '{}'::jsonb);`)
    expect(psql(`SELECT dunning_suspended_reason IS NULL FROM public.demurrage_invoices WHERE id = ${invoiceD};`)).toBe('t')
    expect(psql(`SELECT released_at IS NOT NULL, resume_generation FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id = ${invoiceD};`)).toBe('t|1')
    const resumed = claimAt("'2026-09-10T13:07:00Z'::timestamptz").find((item) => Number(item.invoice_id) === invoiceD)
    expect(resumed).toMatchObject({ attempt_discriminator: 1, resume_generation: 1 })
  })

  it('2.5 — falha passageira libera a posição e abre o alerta só na 3ª seguida; o envio fecha', () => {
    const fail = () => {
      claimAt(BUSINESS_MORNING)
      psql(`SELECT public.settle_demurrage_dunning_claim(${invoiceA}, 1, 'failed', 'Tempo esgotado na chamada ao provedor');`)
    }
    const alertStatus = () => psql(`
      SELECT coalesce(max(i.status), 'none') FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'cobranca_demurrage_recusada' AND a.entity_id = '${invoiceA}';
    `)
    fail()
    fail()
    expect(psql(`SELECT released_at IS NOT NULL, failure_count FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id = ${invoiceA};`)).toBe('t|2')
    expect(alertStatus()).toBe('none')
    fail()
    expect(alertStatus()).toBe('active')
    expect(psql(`SELECT dunning_suspended_reason IS NULL FROM public.demurrage_invoices WHERE id = ${invoiceA};`)).toBe('t')
    claimAt(BUSINESS_MORNING)
    psql(`SELECT public.settle_demurrage_dunning_claim(${invoiceA}, 1, 'sent', NULL);`)
    expect(alertStatus()).toBe('resolved')
    expect(psql(`SELECT released_at IS NULL FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id = ${invoiceA};`)).toBe('t')
  })

  it('settle_demurrage_dunning_claim é server-only e recusa desfecho desconhecido', () => {
    const invalid = psqlResult(`SELECT public.settle_demurrage_dunning_claim(${invoiceA}, 1, 'xyz', NULL);`)
    expect(invalid.status).not.toBe(0)
    const denied = spawnPsql([
      '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
      '-c', `BEGIN; SET LOCAL ROLE authenticated; SELECT public.settle_demurrage_dunning_claim(${invoiceA}, 1, 'paused', NULL); COMMIT;`,
    ], { encoding: 'utf8' })
    expect(denied.status).not.toBe(0)
  })
})
