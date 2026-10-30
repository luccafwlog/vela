// Migration 514 (ADR 0112, D1 a D5 e D27; lote 1 do plano da repaginação da
// Demurrage): a aba Containers lê a classificação do banco
// (`list_demurrage_billing_board`), e o status gravado muda na hora em que o
// free time muda. Os casos seguem a tabela A12 da revisão de 2026-10-29.
//
// Namespace exclusivo: ids 99514xxx, B/Ls 'R514-*', containers 'RQCU514xxxx',
// usuário ...000000514001. Uma Viagem por caso, para os grupos não se
// misturarem; a leitura filtra pela Viagem.
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const adminId = '00000000-0000-0000-0000-000000514001'
const customerOpen = 99514001 // gate do Portal aberto (Liberação)
const customerClosed = 99514002 // sem Portal nem Liberação
const carrierId = 99514003
const vesselId = 99514004
const CASES = ['inside', 'border', 'running', 'override', 'toIssue', 'noCe', 'portal', 'waiting', 'covered', 'cancelledInv',
  'soc', 'noCustomer', 'noRate', 'agreement', 'blCancelled', 'voyageCancelled', 'returnedFree'] as const
type Case = typeof CASES[number]
const voyageOf = (name: Case) => 99514100 + CASES.indexOf(name)
const voyageIds = CASES.map(voyageOf).join(', ')
const blPrefix = 'R514-'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function run(sql: string) {
  return spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' })
}

type Box = { container_number: string; state: string; usd: number | null; last_free_day: string | null; covered_doc: string | null }
type Group = { anchor_bl_id: string; bl_ids: string[]; division: string; reason_code: string | null; reason: string | null; warning: string | null; usd: number; boxes: Box[] }

function board(voyageId: number): Group[] {
  const result = run(`
    BEGIN;
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.role = 'authenticated';
    SET LOCAL request.jwt.claim.sub = '${adminId}';
    SELECT public.list_demurrage_billing_board(NULL, ${voyageId});
    ROLLBACK;`)
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout.trim().split('\n').filter(Boolean).at(-1) ?? '[]') as Group[]
}

const day = (offset: number) => `(now() AT TIME ZONE 'America/Sao_Paulo')::date + ${offset}`
let tableFree = 21
let p1 = 60
let p2 = 80
let p1To = 30

/** US$ da caixa com `days` dias, pela tabela 40' dry carregada no banco. */
function expectedUsd(days: number, free = tableFree) {
  const daysP1 = Math.max(0, Math.min(days, p1To) - free)
  const daysP2 = Math.max(0, days - Math.max(p1To + 1, free + 1) + 1)
  return daysP1 * p1 + daysP2 * p2
}

function bl(id: string, voyage: Case, opts: { customer?: number | null; ce?: boolean; freeTime?: number | null } = {}) {
  const customer = opts.customer === undefined ? customerOpen : opts.customer
  psql(`INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, ce_mercante, free_time_override, demurrage_roe_manual, demurrage_roe)
        VALUES ('${blPrefix}${id}', ${voyageOf(voyage)}, ${customer ?? 'NULL'}, 'CNSHA', 'BRSSA', 'container', 'pending', 'not_calculated',
                ${opts.ce === false ? 'NULL' : `'99514${String(Math.abs(hash(id))).padStart(10, '0').slice(0, 10)}'`}, ${opts.freeTime ?? 'NULL'}, true, 5.5)`)
}

function hash(text: string) {
  let value = 7
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) % 1_000_000_007
  return value
}

function box(blId: string, number: string, opts: { type?: string; discharge?: number | null; returned?: number | null; ownership?: 'SOC' | 'COC' } = {}) {
  psql(`INSERT INTO public.bl_containers (bl_id, container_number, type, discharge_date, return_date, ownership)
        VALUES ('${blPrefix}${blId}', '${number}', '${opts.type ?? '40HC'}',
                ${opts.discharge == null ? 'NULL' : day(-opts.discharge)}, ${opts.returned == null ? 'NULL' : day(-opts.returned)}, '${opts.ownership ?? 'COC'}')`)
}

function status(number: string) {
  return psql(`SELECT demurrage_status FROM public.bl_containers WHERE container_number = '${number}' AND bl_id LIKE '${blPrefix}%'`)
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.list_demurrage_billing_board(bigint,bigint)') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 514 (list_demurrage_billing_board)')

function cleanup() {
  psql(`
    DELETE FROM public.alerts WHERE entity_type = 'customer' AND entity_id IN ('${customerOpen}', '${customerClosed}');
    SET session_replication_role = replica;
    CREATE TEMP TABLE r514_bls AS SELECT id FROM public.bls WHERE id LIKE '${blPrefix}%';
    CREATE TEMP TABLE r514_invoices AS SELECT id FROM public.demurrage_invoices WHERE bl_id IN (SELECT id FROM r514_bls);
    CREATE TEMP TABLE r514_effects AS SELECT id FROM public.import_pending_effects WHERE entity_id IN (SELECT id FROM r514_bls);
    CREATE TEMP TABLE r514_alerts AS SELECT id FROM public.alerts
      WHERE (entity_type = 'demurrage_invoice' AND entity_id IN (SELECT id::text FROM r514_invoices))
         OR (entity_type = 'import_effect' AND entity_id IN (SELECT id::text FROM r514_effects))
         OR (entity_type = 'bl' AND entity_id IN (SELECT id FROM r514_bls));
    CREATE TEMP TABLE r514_items AS SELECT id FROM public.alert_items
      WHERE alert_id IN (SELECT id FROM r514_alerts) OR metadata->>'bl_id' LIKE '${blPrefix}%'
         OR metadata->>'effect_id' IN (SELECT id::text FROM r514_effects);
    DELETE FROM public.internal_notifications WHERE alert_item_id IN (SELECT id FROM r514_items) OR alert_id IN (SELECT id FROM r514_alerts);
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM r514_items);
    DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM r514_items);
    DELETE FROM public.alert_notification_failures WHERE alert_item_id IN (SELECT id FROM r514_items) OR alert_id IN (SELECT id FROM r514_alerts);
    DELETE FROM public.alert_items WHERE id IN (SELECT id FROM r514_items);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM r514_alerts);
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM r514_effects);
    DELETE FROM public.import_pending_effects WHERE id IN (SELECT id FROM r514_effects);
    DELETE FROM public.portal_notifications WHERE customer_id IN (${customerOpen}, ${customerClosed}) OR bl_id IN (SELECT id FROM r514_bls);
    DELETE FROM public.itau_pix_charges WHERE demurrage_invoice_id IN (SELECT id FROM r514_invoices);
    DELETE FROM public.demurrage_calculation_snapshots WHERE demurrage_invoice_id IN (SELECT id FROM r514_invoices);
    DELETE FROM public.demurrage_mutation_requests WHERE invoice_id IN (SELECT id FROM r514_invoices);
    DELETE FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id IN (SELECT id FROM r514_invoices);
    DELETE FROM public.demurrage_invoice_history WHERE invoice_id IN (SELECT id FROM r514_invoices);
    DELETE FROM public.demurrage_invoice_items WHERE invoice_id IN (SELECT id FROM r514_invoices);
    DELETE FROM public.demurrage_invoices WHERE id IN (SELECT id FROM r514_invoices);
    DELETE FROM public.demurrage_box_waivers WHERE customer_id IN (${customerOpen}, ${customerClosed});
    DELETE FROM public.customer_demurrage_agreements WHERE customer_id IN (${customerOpen}, ${customerClosed});
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id IN (SELECT id FROM r514_bls);
    DELETE FROM public.bl_containers WHERE bl_id IN (SELECT id FROM r514_bls);
    DELETE FROM public.bls WHERE id IN (SELECT id FROM r514_bls);
    DELETE FROM public.voyage_documental_pending WHERE voyage_id IN (${voyageIds});
    DELETE FROM public.voyage_documental_state WHERE voyage_id IN (${voyageIds});
    DELETE FROM public.audit_logs WHERE changed_by = '${adminId}' OR entity_id IN (SELECT id FROM r514_bls)
      OR (entity_type IN ('demurrage_invoice', 'demurrage_invoices') AND entity_id IN (SELECT id::text FROM r514_invoices));
    DELETE FROM public.voyages WHERE id IN (${voyageIds});
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.container_types WHERE code = 'R5HC';
    SET session_replication_role = origin;
    SET vela.retention = 'on';
    DELETE FROM public.portal_provisioning_events WHERE customer_id IN (${customerOpen}, ${customerClosed})
      OR account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (${customerOpen}, ${customerClosed}));
    DELETE FROM public.portal_email_attempts WHERE account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (${customerOpen}, ${customerClosed}));
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${customerOpen}, ${customerClosed});
    DELETE FROM public.customer_billing_portal_releases WHERE customer_id IN (${customerOpen}, ${customerClosed});
    DELETE FROM public.customers WHERE id IN (${customerOpen}, ${customerClosed});
    DELETE FROM public.user_profiles WHERE id = '${adminId}';
    DELETE FROM auth.users WHERE id = '${adminId}';
  `)
}

describeLocal('Classificação da cobrança de Demurrage (migration 514)', () => {
  beforeAll(() => {
    cleanup()
    const rate = psql(`SELECT free_days || ',' || p1_usd || ',' || p2_usd || ',' || p1_day_to FROM public.demurrage_rates WHERE container_type = '40GP' AND active ORDER BY valid_from DESC LIMIT 1`).split(',')
    ;[tableFree, p1, p2, p1To] = rate.map(Number)
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'r514-admin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${adminId}', 'R514 Administrativo', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
        (${customerOpen}, '${syntheticCnpj(514001)}', 'R514 CLIENTE ABERTO'),
        (${customerClosed}, '${syntheticCnpj(514002)}', 'R514 CLIENTE SEM PORTAL');
      INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
      VALUES (${customerOpen}, 'Fixture R514: gate aberto para a Demurrage', '${adminId}', now() + interval '1 day');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'R514 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'R514 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        ${CASES.map((name) => `(${voyageOf(name)}, ${vesselId}, 'R514-${name}', 'active')`).join(',\n        ')};
    `)
    // 1 — fora no free time; 1b — borda.
    bl('INSIDE', 'inside'); box('INSIDE', 'RQCU5140001', { discharge: 10 })
    bl('BORDER', 'border'); box('BORDER', 'RQCU5140011', { discharge: tableFree }); box('BORDER', 'RQCU5140012', { discharge: tableFree + 1 })
    // 2 — fora em atraso.
    bl('RUNNING', 'running'); box('RUNNING', 'RQCU5140021', { discharge: 40 })
    // 3 — free time do B/L reduzido (status gravado na hora).
    bl('OVERRIDE', 'override', { freeTime: 30 }); box('OVERRIDE', 'RQCU5140031', { discharge: 15 })
    // 4 — devolvido com sobreestadia: com CE e gate abertos, e sem CE; Portal fechado.
    bl('TOISSUE', 'toIssue'); box('TOISSUE', 'RQCU5140041', { discharge: 40, returned: 5 })
    bl('NOCE', 'noCe', { ce: false }); box('NOCE', 'RQCU5140051', { discharge: 40, returned: 5 })
    bl('PORTAL', 'portal', { customer: customerClosed }); box('PORTAL', 'RQCU5140061', { discharge: 60, returned: 5 }) // além do acordo de 40 dias do Cliente
    // 5 — devolvido no free time.
    bl('RETFREE', 'returnedFree'); box('RETFREE', 'RQCU5140161', { discharge: 30, returned: 20 })
    // 7 — grupo: uma caixa devolvida com sobreestadia, outra ainda no free time.
    bl('WAITA', 'waiting'); bl('WAITB', 'waiting')
    box('WAITA', 'RQCU5140071', { discharge: 40, returned: 5 }); box('WAITA', 'RQCU5140072', { discharge: 5 })
    box('WAITB', 'RQCU5140072', { discharge: 5 })
    // 8 — coberta por Invoice viva; Invoice cancelada devolve a caixa.
    bl('COVERED', 'covered'); box('COVERED', 'RQCU5140081', { discharge: 40, returned: 5 })
    bl('CANCINV', 'cancelledInv'); box('CANCINV', 'RQCU5140091', { discharge: 40, returned: 5 })
    // 6 — SOC em atraso.
    bl('SOC', 'soc'); box('SOC', 'RQCU5140101', { discharge: 40, ownership: 'SOC' })
    // 13 — sem Cliente.
    bl('NOCUST', 'noCustomer', { customer: null }); box('NOCUST', 'RQCU5140111', { discharge: 40 })
    // 14 — tipo sem tarifa, fora há 3 dias.
    bl('NORATE', 'noRate'); box('NORATE', 'RQCU5140121', { discharge: 3, type: 'R5HC' })
    // 15 — acordo de 40 dias contra a tabela.
    psql(`INSERT INTO public.customer_demurrage_agreements (customer_id, free_days, valid_from, active, notes)
          VALUES (${customerClosed}, 40, '2026-01-01', true, 'R514 acordo')`)
    bl('AGREE', 'agreement', { customer: customerClosed }); box('AGREE', 'RQCU5140131', { discharge: 30 })
    // 12 — B/L cancelado com caixa devolvida com sobreestadia; Viagem cancelada.
    bl('BLCANC', 'blCancelled'); box('BLCANC', 'RQCU5140141', { discharge: 40, returned: 5 })
    psql(`SET session_replication_role = replica; UPDATE public.bls SET cancelled_at = now() WHERE id = '${blPrefix}BLCANC'`)
    bl('VOYCANC', 'voyageCancelled'); box('VOYCANC', 'RQCU5140151', { discharge: 40 })
    psql(`SET session_replication_role = replica; UPDATE public.voyages SET status = 'cancelled' WHERE id = ${voyageOf('voyageCancelled')}`)
    // Invoices: emitida pela RPC real e outra cancelada depois.
    for (const id of ['COVERED', 'CANCINV']) {
      const issued = JSON.parse(psql(`SET vela.demurrage_internal = 'on'; SELECT public.issue_demurrage_invoice_for_bl('${blPrefix}${id}')`)) as { status: string }
      expect(issued.status).toBe('issued')
    }
    psql(`SET session_replication_role = replica; UPDATE public.demurrage_invoices SET status = 'cancelled' WHERE bl_id = '${blPrefix}CANCINV'`)
  })

  afterAll(cleanup)

  describe('o que fica fora da aba', () => {
    it('caixa no free time, devolvida no free time, SOC, coberta por Invoice e Viagem cancelada', () => {
      for (const name of ['inside', 'returnedFree', 'soc', 'covered', 'voyageCancelled'] as const) {
        expect(board(voyageOf(name)), name).toEqual([])
      }
    })

    it('acordo de 40 dias segura a caixa de 30 dias', () => {
      expect(board(voyageOf('agreement'))).toEqual([])
      expect(status('RQCU5140131')).toBe('within_free_time')
    })
  })

  describe('Correndo', () => {
    it('entra no dia seguinte ao último dia livre, com o US$ de hoje', () => {
      const [group] = board(voyageOf('border'))
      expect(group.division).toBe('correndo')
      const byNumber = Object.fromEntries(group.boxes.map((item) => [item.container_number, item]))
      expect(byNumber.RQCU5140011.state).toBe('in_free_time')
      expect(byNumber.RQCU5140012.state).toBe('running')
      expect(group.usd).toBe(expectedUsd(tableFree + 1))

      const [running] = board(voyageOf('running'))
      expect(running).toMatchObject({ division: 'correndo', usd: expectedUsd(40) })
    })

    it('free time do B/L reduzido põe o container em Correndo na mesma transação (D2)', () => {
      expect(status('RQCU5140031')).toBe('within_free_time')
      expect(board(voyageOf('override'))).toEqual([])
      psql(`UPDATE public.bls SET free_time_override = 7 WHERE id = '${blPrefix}OVERRIDE'`)
      expect(status('RQCU5140031')).toBe('overdue')
      expect(board(voyageOf('override'))[0]).toMatchObject({ division: 'correndo', usd: expectedUsd(15, 7) })
    })

    it('acordo desativado põe o container em Correndo na hora (D2)', () => {
      psql(`UPDATE public.customer_demurrage_agreements SET active = false WHERE notes = 'R514 acordo'`)
      try {
        expect(status('RQCU5140131')).toBe('overdue')
        expect(board(voyageOf('agreement'))[0].division).toBe('correndo')
      } finally {
        psql(`UPDATE public.customer_demurrage_agreements SET active = true WHERE notes = 'R514 acordo'`)
      }
      expect(status('RQCU5140131')).toBe('within_free_time')
    })
  })

  describe('A emitir e Esperando', () => {
    it('tudo devolvido, CE e Portal em ordem: A emitir', () => {
      expect(board(voyageOf('toIssue'))[0]).toMatchObject({ division: 'a_emitir', reason_code: null, usd: expectedUsd(35) })
    })

    it('Invoice cancelada devolve a caixa para A emitir (D10)', () => {
      expect(board(voyageOf('cancelledInv'))[0]).toMatchObject({ division: 'a_emitir' })
    })

    it('caixa devolvida com sobreestadia esperando outra caixa do grupo: Esperando, nomeando a que falta', () => {
      const [group] = board(voyageOf('waiting'))
      expect(group.division).toBe('esperando')
      expect(group.bl_ids).toEqual([`${blPrefix}WAITA`, `${blPrefix}WAITB`])
      const waiting = group.boxes.find((item) => item.state === 'in_free_time')!
      expect(waiting.container_number).toBe('RQCU5140072')
      expect(waiting.last_free_day).toBe(psql(`SELECT (${day(-5)} + ${tableFree})::text`))
    })
  })

  describe('Travado (D4, D27)', () => {
    it('sem CE Mercante, com motivo; o B/L em Correndo sem CE leva o aviso', () => {
      expect(board(voyageOf('noCe'))[0]).toMatchObject({ division: 'travado', reason_code: 'sem_ce' })
      expect(board(voyageOf('noCe'))[0].reason).toMatch(/sem CE Mercante/)
      psql(`UPDATE public.bl_containers SET return_date = NULL WHERE container_number = 'RQCU5140051'`)
      try {
        const [group] = board(voyageOf('noCe'))
        expect(group.division).toBe('correndo')
        expect(group.warning).toMatch(/sem CE Mercante/)
      } finally {
        psql(`UPDATE public.bl_containers SET return_date = ${day(-5)} WHERE container_number = 'RQCU5140051'`)
      }
    })

    it('Gate do Portal fechado', () => {
      expect(board(voyageOf('portal'))[0]).toMatchObject({ division: 'travado', reason_code: 'portal' })
    })

    it('B/L sem Cliente', () => {
      expect(board(voyageOf('noCustomer'))[0]).toMatchObject({ division: 'travado', reason_code: 'sem_cliente' })
    })

    it('B/L cancelado com sobreestadia sem Invoice', () => {
      expect(board(voyageOf('blCancelled'))[0]).toMatchObject({ division: 'travado', reason_code: 'bl_cancelado' })
    })

    it('tipo sem tarifa entra desde a descarga; cadastrar o tipo tira de Travado e refaz o status (D27, D2)', () => {
      expect(board(voyageOf('noRate'))[0]).toMatchObject({ division: 'travado', reason_code: 'sem_tarifa', reason: 'Tipo R5HC sem tarifa de Demurrage.' })
      psql(`UPDATE public.bl_containers SET discharge_date = ${day(-30)} WHERE container_number = 'RQCU5140121'`)
      expect(status('RQCU5140121')).toBe('within_free_time')
      psql(`INSERT INTO public.container_types (code, description, rate_group) VALUES ('R5HC', 'teste 514', '40GP')`)
      expect(status('RQCU5140121')).toBe('overdue')
      expect(board(voyageOf('noRate'))[0]).toMatchObject({ division: 'correndo', usd: expectedUsd(30) })
      // O Alerta do tipo sem tarifa (Administrativo) fecha pelo gatilho do cadastro.
      expect(psql(`SELECT count(*) FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
        WHERE i.item_type = 'demurrage_travado' AND i.status = 'active' AND a.entity_id = '${blPrefix}NORATE'`)).toBe('0')
    })
  })

  describe('Alerta de Travado (migration 515; D25)', () => {
    const activeAlert = (blId: string) => psql(`SELECT string_agg(i.department, ',' ORDER BY i.id) FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'demurrage_travado' AND i.status = 'active' AND a.entity_type = 'bl' AND a.entity_id = '${blPrefix}${blId}'`)

    it('abre para o setor do motivo: Documentação (CE, Cliente, Portal) e Administrativo (B/L cancelado)', () => {
      // A rotina de 15 minutos cobre o que não passou por gatilho (aqui, o B/L cancelado sem gatilho).
      psql(`SELECT public.reconcile_demurrage_travado_alerts()`)
      expect(activeAlert('NOCE')).toBe('documentacao')
      expect(activeAlert('NOCUST')).toBe('documentacao')
      expect(activeAlert('PORTAL')).toBe('documentacao')
      expect(activeAlert('BLCANC')).toBe('administrativo')
      expect(activeAlert('TOISSUE')).toBe('')
    })

    it('gravar o CE fecha o Alerta na hora, pelo gatilho do B/L', () => {
      psql(`UPDATE public.bls SET ce_mercante = '995149999999999' WHERE id = '${blPrefix}NOCE'`)
      try {
        expect(activeAlert('NOCE')).toBe('')
        expect(board(voyageOf('noCe'))[0].division).toBe('a_emitir')
      } finally {
        psql(`UPDATE public.bls SET ce_mercante = NULL WHERE id = '${blPrefix}NOCE'`)
      }
      expect(activeAlert('NOCE')).toBe('documentacao')
    })
  })

  it('o aviso do cabeçalho conta as caixas de Correndo', () => {
    const result = run(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated';
      SET LOCAL request.jwt.claim.sub = '${adminId}'; SELECT public.count_demurrage_running_boxes(); ROLLBACK;`)
    expect(result.status, result.stderr).toBe(0)
    const total = Number(result.stdout.trim().split('\n').filter(Boolean).at(-1))
    const own = CASES.flatMap((name) => board(voyageOf(name))).flatMap((group) => group.boxes).filter((item) => item.state === 'running').length
    expect(own).toBeGreaterThan(0)
    expect(total).toBeGreaterThanOrEqual(own)
  })

  describe('B/L cancelado e dispensa da cobrança (migration 516; D7, D24, D26)', () => {
    function asAdmin(sql: string) {
      const result = run(`BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated';
        SET LOCAL request.jwt.claim.sub = '${adminId}'; ${sql}; COMMIT;`)
      return { ...result, last: result.stdout.trim().split('\n').filter(Boolean).at(-1) ?? '' }
    }
    const cancelReasons = (blId: string) => {
      const result = asAdmin(`SELECT public.cancel_bl('${blPrefix}${blId}', '', true)`)
      expect(result.status, result.stderr).toBe(0)
      return (JSON.parse(result.last) as { reasons: string[] }).reasons
    }

    it('cancelar B/L com caixa devolvida com sobreestadia sem Invoice, ou ainda fora em atraso, é recusado com o caminho', () => {
      expect(cancelReasons('TOISSUE')).toEqual([expect.stringMatching(/^Demurrage a faturar: devolva o container e emita a Invoice, ou dispense/)])
      expect(cancelReasons('RUNNING')).toEqual([expect.stringMatching(/^Demurrage a faturar/)])
      // No free time e devolvido no free time não seguram.
      expect(cancelReasons('INSIDE')).toEqual([])
      expect(cancelReasons('RETFREE')).toEqual([])
    })

    it('dispensar a caixa solta o cancelamento e tira a caixa da aba; desfazer devolve', () => {
      const waived = asAdmin(`SELECT public.waive_demurrage_box('${blPrefix}TOISSUE', 'rqcu5140041', 'Cliente isento por acordo comercial')`)
      expect(waived.status, waived.stderr).toBe(0)
      const waiverId = (JSON.parse(waived.last) as { waiver_id: number }).waiver_id
      try {
        expect(cancelReasons('TOISSUE')).toEqual([])
        expect(board(voyageOf('toIssue'))).toEqual([])
        expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_type = 'bl' AND entity_id = '${blPrefix}TOISSUE' AND field_name = 'demurrage_dispensa'`)).toBe('1')
        // A emissão não cobra a caixa dispensada.
        expect((JSON.parse(psql(`SET vela.demurrage_internal = 'on'; SELECT public.issue_demurrage_invoice_for_bl('${blPrefix}TOISSUE')`)) as { status: string }).status).toBe('existing')
        // Justificativa curta é recusada; a dispensa repetida também.
        expect(asAdmin(`SELECT public.revoke_demurrage_box_waiver(${waiverId}, 'curta')`).stderr).toMatch(/mínimo de 10 caracteres/)
        expect(asAdmin(`SELECT public.waive_demurrage_box('${blPrefix}TOISSUE', 'RQCU5140041', 'Cliente isento por acordo comercial')`).stderr).toMatch(/já está numa Invoice de Demurrage ou com a cobrança dispensada/)
      } finally {
        const revoked = asAdmin(`SELECT public.revoke_demurrage_box_waiver(${waiverId}, 'Acordo comercial não foi fechado')`)
        expect(revoked.status, revoked.stderr).toBe(0)
      }
      expect(board(voyageOf('toIssue'))[0]).toMatchObject({ division: 'a_emitir' })
      expect(cancelReasons('TOISSUE')).toEqual([expect.stringMatching(/^Demurrage a faturar/)])
    })

    it('a caixa dispensada ainda fora não segura o grupo: Esperando vira A emitir', () => {
      const waived = asAdmin(`SELECT public.waive_demurrage_box('${blPrefix}WAITB', 'RQCU5140072', 'Caixa devolvida ao armador por outra via')`)
      expect(waived.status, waived.stderr).toBe(0)
      const waiverId = (JSON.parse(waived.last) as { waiver_id: number }).waiver_id
      try {
        const [group] = board(voyageOf('waiting'))
        expect(group.division).toBe('a_emitir')
        expect(group.boxes.find((item) => item.container_number === 'RQCU5140072')?.state).toBe('waived')
      } finally {
        asAdmin(`SELECT public.revoke_demurrage_box_waiver(${waiverId}, 'Caixa ainda está com o Cliente')`)
      }
      expect(board(voyageOf('waiting'))[0].division).toBe('esperando')
    })

    it('caixa já numa Invoice viva não se dispensa; o B/L com Invoice paga segue cancelável', () => {
      expect(asAdmin(`SELECT public.waive_demurrage_box('${blPrefix}COVERED', 'RQCU5140081', 'Tentativa de dispensa indevida')`).stderr)
        .toMatch(/já está numa Invoice de Demurrage/)
      expect(cancelReasons('COVERED')).toEqual(['fatura de Demurrage em aberto'])
      psql(`SET session_replication_role = replica; UPDATE public.demurrage_invoices SET status = 'paid', paid_at = now() WHERE bl_id = '${blPrefix}COVERED'`)
      try {
        expect(cancelReasons('COVERED')).toEqual([])
      } finally {
        psql(`SET session_replication_role = replica; UPDATE public.demurrage_invoices SET status = 'issued', paid_at = NULL WHERE bl_id = '${blPrefix}COVERED'`)
      }
    })
  })

  it('usuário fora do Vela não lê a classificação', () => {
    const result = run(`BEGIN; SET LOCAL ROLE anon; SELECT public.list_demurrage_billing_board(); ROLLBACK;`)
    expect(result.status).not.toBe(0)
  })
})
