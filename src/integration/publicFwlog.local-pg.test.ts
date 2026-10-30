import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'
import { PORTAL_SCHEDULE_LANES, portalLaneCode } from '../services/portalScheduleLanes'
import { PUBLIC_LOOKUP_PORTS } from '../services/publicLookupPorts'
import { computeIsoContainerCheckDigit } from '../lib/containerNumber'

// Migration 542 (ADR 0114): quadro e consulta públicos do fwlog.com.br. As
// funções só atendem `service_role` (as Edge Functions públicas); o quadro é
// o mesmo do Portal, e a consulta devolve no máximo uma linha, com a mesma
// resposta vazia para todos os motivos de "não encontrado".
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const NS = 990514
const CARRIER = NS
const VESSEL_A = NS
const VESSEL_B = NS + 1
const V_PUBLIC = NS // ativa, no Portal
const V_HIDDEN = NS + 1 // ativa, fora do Portal
const V_CANCELLED = NS + 2 // cancelada, marcada no Portal
const V_OLD = NS + 3 // ativa, mais antiga, para o número repetido
const V_OUT = NS + 4 // ativa, mais de 90 dias atrás
const CUSTOMER = NS
const CUSTOMER_CNPJ = syntheticCnpj(51401)
const TODAY = "(now() AT TIME ZONE 'America/Sao_Paulo')::date"

function containerNumber(serial: number): string {
  const base = `ZQPU${String(serial).padStart(6, '0')}`
  return `${base}${computeIsoContainerCheckDigit(base)}`
}

const BOX_FOUND = containerNumber(51401) // B/L ativo, Salvador, descarga há 10 dias
const BOX_REPEATED = containerNumber(51402) // na V_OLD e na V_PUBLIC
const BOX_SHARED = containerNumber(51403) // rateado entre dois B/Ls do Cliente
const BOX_CANCELLED_BL = containerNumber(51404)
const BOX_CANCELLED_VOYAGE = containerNumber(51405)
const BOX_UNSERVED_PORT = containerNumber(51406) // POD Santos
const BOX_OUT_OF_WINDOW = containerNumber(51407) // devolvido, descarga há 120 dias
const BOX_STILL_OUT = containerNumber(51411) // sem devolução, descarga há 120 dias
const BOX_PECEM = containerNumber(51412)
const BOX_NO_CE = containerNumber(51413) // B/L sem CE Mercante: só no Vela, fora do Portal
const BOX_SOC = containerNumber(51408)
const BOX_UNKNOWN = containerNumber(51409) // formato e dígito válidos, sem registro
const BOX_WAITING = containerNumber(51410) // sem descarga, ETA futura

const BLS = {
  found: 'BL-542-FOUND',
  old: 'BL-542-OLD',
  sharedA: 'BL-542-SH-A',
  sharedB: 'BL-542-SH-B',
  cancelled: 'BL-542-CANC',
  cancelledVoyage: 'BL-542-CV',
  santos: 'BL-542-SSZ',
  out: 'BL-542-OUT',
  waiting: 'BL-542-WAIT',
  pecem: 'BL-542-PEC',
  noCe: 'BL-542-NOCE',
}

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function asRole(role: 'anon' | 'authenticated' | 'service_role', sql: string): { output: string; error: string } {
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE ${role}; SET LOCAL request.jwt.claims = '{"role":"${role}"}'; ${sql}; COMMIT;`], { encoding: 'utf8' })
  return { output: (result.stdout ?? '').trim(), error: (result.stderr ?? '').trim() }
}

function lookup(number: string): string {
  const result = asRole('service_role', `SELECT row_to_json(r)::text FROM public.public_container_lookup('${number.replaceAll("'", "''")}') AS r`)
  expect(result.error).toBe('')
  return result.output
}

function lookupRow(number: string): Record<string, unknown> {
  const output = lookup(number)
  expect(output.split('\n')).toHaveLength(1)
  return JSON.parse(output) as Record<string, unknown>
}

function migration542Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.public_container_lookup(text)') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

function cleanup() {
  const bls = Object.values(BLS).map((id) => `'${id}'`).join(',')
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.bl_containers WHERE bl_id IN (${bls});
    DELETE FROM public.bls WHERE id IN (${bls});
    DELETE FROM public.customer_demurrage_agreements WHERE customer_id = ${CUSTOMER};
    DELETE FROM public.audit_logs WHERE entity_type IN ('voyage_pol_schedule', 'voyage_pod_schedule')
      AND split_part(entity_id, '::', 1) IN ('${V_PUBLIC}', '${V_HIDDEN}', '${V_CANCELLED}', '${V_OLD}', '${V_OUT}');
    DELETE FROM public.voyages WHERE id BETWEEN ${NS} AND ${NS + 4};
    DELETE FROM public.vessels WHERE id IN (${VESSEL_A}, ${VESSEL_B});
    DELETE FROM public.carriers WHERE id = ${CARRIER};
    DELETE FROM public.customers WHERE id = ${CUSTOMER};
  `)
}

const describeLocal = describeWithProbe(migration542Applied, 'migration542Applied (funções públicas do fwlog.com.br)')

describeLocal('542 — quadro e consulta de container públicos', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${CUSTOMER}, '${CUSTOMER_CNPJ}', 'Cliente 542');
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER}, 'Carrier 542');
      INSERT INTO public.vessels (id, name, carrier_id, imo) VALUES
        (${VESSEL_A}, 'NAVIO 542 A', ${CARRIER}, '9514001'),
        (${VESSEL_B}, 'NAVIO 542 B', ${CARRIER}, NULL);
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status, show_on_portal, eta) VALUES
        (${V_PUBLIC}, ${VESSEL_A}, '542A', 'active', true, now() - interval '12 days'),
        (${V_HIDDEN}, ${VESSEL_B}, '542H', 'active', false, now()),
        (${V_CANCELLED}, ${VESSEL_B}, '542C', 'active', true, now()),
        (${V_OLD}, ${VESSEL_B}, '542O', 'active', true, now() - interval '60 days'),
        (${V_OUT}, ${VESSEL_B}, '542X', 'active', false, now() - interval '200 days');

      -- Escalas: POL Shanghai com ETD e ATD; Suape e Salvador com ETA (Salvador
      -- com ATA); Santos fora do quadro; Vitória retirada; Pecém omitida.
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification) VALUES
        ('voyage_pol_schedule', '${V_PUBLIC}::CNSHA', 'etd', NULL, '2026-09-01', NULL, 'teste 542'),
        ('voyage_pol_schedule', '${V_PUBLIC}::CNSHA', 'atd', NULL, '2026-09-02', NULL, 'teste 542'),
        ('voyage_pod_schedule', '${V_PUBLIC}::BRSUA', 'eta', NULL, '2026-10-20', NULL, 'teste 542'),
        ('voyage_pod_schedule', '${V_PUBLIC}::BRSSA', 'eta', NULL, '2026-10-18', NULL, 'teste 542'),
        ('voyage_pod_schedule', '${V_PUBLIC}::BRSSA', 'ata', NULL, '2026-10-19T08:00', NULL, 'teste 542'),
        ('voyage_pod_schedule', '${V_PUBLIC}::BRSSZ', 'eta', NULL, '2026-10-25', NULL, 'teste 542'),
        ('voyage_pod_schedule', '${V_PUBLIC}::BRVIX', 'eta', NULL, '2026-10-22', NULL, 'teste 542'),
        ('voyage_pod_schedule', '${V_PUBLIC}::BRVIX', 'deleted', NULL, 'true', NULL, 'teste 542'),
        ('voyage_pod_schedule', '${V_PUBLIC}::BRPEC', 'omitted', NULL, 'true', NULL, 'teste 542'),
        ('voyage_pod_schedule', '${V_HIDDEN}::BRSSA', 'eta', NULL, '2026-11-01', NULL, 'teste 542'),
        ('voyage_pod_schedule', '${V_CANCELLED}::BRSSA', 'eta', NULL, '2026-11-02', NULL, 'teste 542');

      INSERT INTO public.customer_demurrage_agreements (customer_id, free_days, valid_from, notes)
        VALUES (${CUSTOMER}, 14, ${TODAY} - 400, 'teste 542');

      INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode, pod, ce_mercante) VALUES
        ('${BLS.found}', ${V_PUBLIC}, ${CUSTOMER}, 'container', 'SALVADOR', 'CE542FOUND'),
        ('${BLS.old}', ${V_OLD}, ${CUSTOMER}, 'container', 'BRSSA', 'CE542OLD'),
        ('${BLS.sharedA}', ${V_PUBLIC}, ${CUSTOMER}, 'container', 'BRSUA', 'CE542SHA'),
        ('${BLS.sharedB}', ${V_PUBLIC}, ${CUSTOMER}, 'container', 'BRSUA', 'CE542SHB'),
        ('${BLS.cancelled}', ${V_PUBLIC}, ${CUSTOMER}, 'container', 'BRSSA', 'CE542CANC'),
        ('${BLS.cancelledVoyage}', ${V_CANCELLED}, ${CUSTOMER}, 'container', 'BRSSA', 'CE542CV'),
        ('${BLS.santos}', ${V_PUBLIC}, ${CUSTOMER}, 'container', 'BRSSZ', 'CE542SSZ'),
        ('${BLS.out}', ${V_OUT}, ${CUSTOMER}, 'container', 'BRSSA', 'CE542OUT'),
        ('${BLS.waiting}', ${V_HIDDEN}, ${CUSTOMER}, 'container', 'BRVIX', 'CE542WAIT'),
        ('${BLS.pecem}', ${V_PUBLIC}, ${CUSTOMER}, 'container', 'PECEM', 'CE542PEC'),
        ('${BLS.noCe}', ${V_PUBLIC}, ${CUSTOMER}, 'container', 'BRSSA', NULL);
      -- O B/L irmão tem free time próprio: a resposta tem de seguir o âncora.
      UPDATE public.bls SET free_time_override = 30 WHERE id = '${BLS.sharedB}';

      INSERT INTO public.bl_containers (bl_id, container_number, type, discharge_date, return_date, ownership) VALUES
        ('${BLS.found}', '${BOX_FOUND}', '40HC', ${TODAY} - 10, NULL, 'COC'),
        ('${BLS.old}', '${BOX_REPEATED}', '20DV', ${TODAY} - 58, ${TODAY} - 40, 'COC'),
        ('${BLS.found}', '${BOX_REPEATED}', '40HC', ${TODAY} - 10, NULL, 'COC'),
        ('${BLS.sharedB}', '${BOX_SHARED}', '40HC', ${TODAY} - 20, NULL, 'COC'),
        ('${BLS.sharedA}', '${BOX_SHARED}', '40HC', ${TODAY} - 20, NULL, 'COC'),
        ('${BLS.cancelled}', '${BOX_CANCELLED_BL}', '40HC', ${TODAY} - 10, NULL, 'COC'),
        ('${BLS.cancelledVoyage}', '${BOX_CANCELLED_VOYAGE}', '40HC', ${TODAY} - 10, NULL, 'COC'),
        ('${BLS.santos}', '${BOX_UNSERVED_PORT}', '40HC', ${TODAY} - 10, NULL, 'COC'),
        ('${BLS.out}', '${BOX_OUT_OF_WINDOW}', '40HC', ${TODAY} - 120, ${TODAY} - 100, 'COC'),
        ('${BLS.out}', '${BOX_STILL_OUT}', '40HC', ${TODAY} - 120, NULL, 'COC'),
        ('${BLS.pecem}', '${BOX_PECEM}', '20DV', ${TODAY} - 5, NULL, 'COC'),
        ('${BLS.noCe}', '${BOX_NO_CE}', '40HC', ${TODAY} - 10, NULL, 'COC'),
        ('${BLS.found}', '${BOX_SOC}', '40HC', ${TODAY} - 10, NULL, 'SOC'),
        ('${BLS.waiting}', '${BOX_WAITING}', '20DV', NULL, NULL, 'COC');
      -- Cancelamentos direto na tabela, sem os gatilhos (fixture): a escala de
      -- Viagem cancelada é somente leitura e o B/L cancela por cancel_bl.
      SET session_replication_role = replica;
      UPDATE public.bls SET cancelled_at = now() WHERE id = '${BLS.cancelled}';
      UPDATE public.voyages SET status = 'cancelled' WHERE id = ${V_CANCELLED};
      SET session_replication_role = origin;
    `)
  })

  afterAll(() => {
    cleanup()
  })

  it('anon e authenticated não executam as funções novas; service_role executa só as duas públicas', () => {
    for (const fn of ['public.public_ship_schedule()', 'public.public_container_lookup(text)']) {
      expect(psql(`SELECT has_function_privilege('anon', '${fn}', 'EXECUTE'), has_function_privilege('authenticated', '${fn}', 'EXECUTE'), has_function_privilege('service_role', '${fn}', 'EXECUTE');`)).toBe('f|f|t')
    }
    for (const fn of ['public._ship_schedule_core()', 'public._public_schedule_port_codes()', 'public._public_lookup_port_codes()', 'public._iso6346_check_digit_valid(text)']) {
      expect(psql(`SELECT has_function_privilege('anon', '${fn}', 'EXECUTE'), has_function_privilege('authenticated', '${fn}', 'EXECUTE');`)).toBe('f|f')
    }
    expect(asRole('anon', 'SELECT count(*) FROM public.public_ship_schedule()').error).toMatch(/permission denied for function public_ship_schedule/)
    expect(asRole('authenticated', `SELECT count(*) FROM public.public_container_lookup('${BOX_FOUND}')`).error).toMatch(/permission denied for function public_container_lookup/)
  })

  it('os portos do servidor são os do quadro do Portal (com Suape) e os atendidos do Portal', () => {
    expect(psql(`SELECT array_to_string(public._public_schedule_port_codes(), ',');`)).toBe(PORTAL_SCHEDULE_LANES.map(portalLaneCode).join(','))
    expect(PORTAL_SCHEDULE_LANES.map(portalLaneCode)).toContain('BRSUA')
    expect(psql(`SELECT array_to_string(public._public_lookup_port_codes(), ',');`))
      .toBe(PUBLIC_LOOKUP_PORTS.map((port) => port.code).join(','))
  })

  it('paridade: o quadro público é o do Portal nos portos do quadro, sem voyage_id', () => {
    const lanes = PORTAL_SCHEDULE_LANES.map(portalLaneCode)
    const portal = asRole('service_role', `SELECT row_to_json(r)::text FROM public.portal_ship_schedule() AS r`)
    const pub = asRole('service_role', `SELECT row_to_json(r)::text FROM public.public_ship_schedule() AS r`)
    expect(portal.error).toBe('')
    expect(pub.error).toBe('')
    type Row = Record<string, unknown>
    const portalRows = portal.output.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Row)
      .filter((row) => lanes.includes(String(row.port_code)))
    const publicRows = pub.output.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Row)
    expect(Object.keys(publicRows[0]).sort()).toEqual(['actual_value', 'date_value', 'imo', 'kind', 'omitted', 'port_code', 'vessel_name', 'voyage', 'voyage_key'])

    // Mesmo conteúdo, comparando por Viagem (o id do Portal e a chave do público
    // só agrupam); a chave pública é a ordem da mais nova para a mais antiga.
    const comparable = (row: Row, group: unknown) => JSON.stringify([group, row.vessel_name, row.voyage, row.port_code, row.kind, row.date_value, row.actual_value, row.omitted])
    const portalIds = [...new Set(portalRows.map((row) => Number(row.voyage_id)))].sort((a, b) => b - a)
    const expected = portalRows.map((row) => comparable(row, portalIds.indexOf(Number(row.voyage_id)) + 1)).sort()
    const actual = publicRows.map((row) => comparable(row, row.voyage_key)).sort()
    expect(actual).toEqual(expected)
    expect(publicRows.every((row) => row.imo === null || typeof row.imo === 'string')).toBe(true)
  })

  it('Viagem fora do Portal, cancelada e escala retirada não aparecem; Suape e a omitida aparecem', () => {
    const rows = asRole('service_role', `SELECT voyage || ':' || port_code || ':' || kind || ':' || COALESCE(date_value, '') || ':' || COALESCE(actual_value, '') || ':' || omitted
      FROM public.public_ship_schedule() WHERE voyage IN ('542A', '542H', '542C') ORDER BY 1`).output.split('\n')
    expect(rows).toEqual([
      '542A:BRPEC:pod:::true',
      '542A:BRSSA:pod:2026-10-18:2026-10-19T08:00:false',
      '542A:BRSUA:pod:2026-10-20::false',
      '542A:CNSHA:pol:2026-09-01:2026-09-02:false',
    ])
  })

  it('container encontrado: uma linha com a lista positiva, free time e data limite do Portal', () => {
    const row = lookupRow(` ${BOX_FOUND.toLowerCase().slice(0, 4)}-${BOX_FOUND.slice(4)} `)
    expect(Object.keys(row).sort()).toEqual(['container_number', 'container_type', 'discharge_date', 'discharge_port', 'free_time_days', 'free_time_until', 'return_date', 'situation', 'vessel_name', 'voyage'])
    expect(row).toMatchObject({
      container_number: BOX_FOUND, container_type: '40HC', vessel_name: 'NAVIO 542 A', voyage: '542A',
      discharge_port: 'BRSSA', return_date: null, free_time_days: 14, situation: 'no_prazo',
    })
    expect(row.free_time_until).toBe(psql(`SELECT (${TODAY} - 10 + 14)::text`))

    // O mesmo free time que o Portal do Cliente mostra para essa caixa.
    const portalFree = psql(`SELECT c->>'free_time_days'
      FROM jsonb_array_elements(public._portal_list_operation_bls_without_transshipment_core(${CUSTOMER})) AS b,
           jsonb_array_elements(b->'containers') AS c
      WHERE b->>'bl_id' = '${BLS.found}' AND c->>'container_number' = '${BOX_FOUND}'`)
    expect(Number(portalFree)).toBe(row.free_time_days)
  })

  it('número repetido em duas Viagens: só a mais recente', () => {
    expect(lookupRow(BOX_REPEATED)).toMatchObject({ voyage: '542A', container_type: '40HC', return_date: null })
  })

  it('container rateado entre B/Ls do Cliente: a resposta é a do B/L-âncora, sempre a mesma', () => {
    const first = lookup(BOX_SHARED)
    expect(JSON.parse(first)).toMatchObject({ free_time_days: 14, discharge_port: 'BRSUA' })
    expect(lookup(BOX_SHARED)).toBe(first)
  })

  it('sem devolução e descarregado há mais de 90 dias: aparece, com o prazo vencido', () => {
    expect(lookupRow(BOX_STILL_OUT)).toMatchObject({ voyage: '542X', return_date: null, free_time_days: 14, situation: 'prazo_vencido' })
  })

  it('Pecém é porto da consulta', () => {
    expect(lookupRow(BOX_PECEM)).toMatchObject({ discharge_port: 'BRPEC', situation: 'no_prazo' })
  })

  it('sem descarga: aguardando descarga, sem free time nem data limite', () => {
    expect(lookupRow(BOX_WAITING)).toMatchObject({ situation: 'aguardando_descarga', free_time_days: null, free_time_until: null, discharge_port: 'BRVIX' })
  })

  it('dígito inválido, inexistente, devolvido fora da janela, sem CE Mercante, cancelado, porto não atendido e SOC: a mesma resposta vazia', () => {
    const wrongDigit = `${BOX_FOUND.slice(0, 10)}${(Number(BOX_FOUND[10]) + 1) % 10}`
    for (const number of [wrongDigit, BOX_UNKNOWN, BOX_OUT_OF_WINDOW, BOX_CANCELLED_BL, BOX_CANCELLED_VOYAGE, BOX_UNSERVED_PORT, BOX_SOC, BOX_NO_CE, 'ZQPU51401', "ZQPU' OR 1=1 --", BOX_FOUND.slice(0, 6), '']) {
      expect(lookup(number), number).toBe('')
    }
  })
})
