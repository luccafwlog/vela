import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 495 (ADR 0111, D6 e D7; lote 5): a simulação desfeita diz o que a
// mudança de base faz com cada alteração à mão; o evento do Sistema que
// descarta a alteração ou muda a quantidade de taxa com total alterado, sem o
// aceite do **Gravar mesmo assim**, abre o alerta **Taxa alterada à mão mudou**.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const USERS = {
  adm: '04950000-0000-4000-8000-0000000000a1',
  ope: '04950000-0000-4000-8000-0000000000a2',
} as const
const CARRIER = 49500001
const VESSEL = 49500002
const VOYAGE = 49500003
const CUSTOMER = 49500004
const T_A = 49500010
const T_B = 49500011
const THD = 49500020
const BL_FEE = 49500021
const THD_B = 49500022
const BL_FEE_B = 49500023
const POD = 'R495A'
const POD_B = 'R495B'
const BL = {
  total: 'R495-TOT', unit: 'R495-UNI', pod: 'R495-POD', ack: 'R495-ACK', queue: 'R495-QUE',
  share1: 'R495-SH1', share2: 'R495-SH2', exempt: 'R495-EXE', plain: 'R495-PLN',
} as const
const ALL_BLS = Object.values(BL)
const JUST = 'Acordado com o Cliente pelo comercial'
const thd = `auto:item:${THD}`
const blFee = `auto:item:${BL_FEE}`

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function as(userId: string, sql: string, role = 'SET LOCAL ROLE authenticated;') {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
    ${role}
    ${sql};
    COMMIT;
  `], { encoding: 'utf8' })
  const last = (run.stdout ?? '').trim().split('\n').pop() ?? ''
  return { status: run.status, stderr: run.stderr ?? '', out: last }
}

function ok(userId: string, sql: string) {
  const run = as(userId, sql)
  expect(run.status, `${sql.slice(0, 120)}\n${run.stderr}`).toBe(0)
  return run.out
}

/** Gravação do B/L com a sessão da pessoa, como a ficha (o gatilho de fim de transação recalcula). */
function saveAs(userId: string, sql: string) {
  const run = as(userId, sql, '')
  expect(run.status, run.stderr).toBe(0)
}

const q = (value: string) => `'${value.replace(/'/g, "''")}'`

function alter(blId: string, key: string, kind: 'unit' | 'total', value: number) {
  return ok(USERS.adm, `SELECT public.alter_bl_charge_value(${q(blId)}, ${q(key)}, ${q(kind)}, ${value}, ${q(JUST)}, '${USERS.adm}'::uuid)`)
}
function calculate(blId: string) {
  return ok(USERS.adm, `SELECT public.calculate_bl_local_charges(${q(blId)}, '${USERS.adm}'::uuid, true)`)
}
type ImpactItem = { charge_name: string; outcome: string; quantity: number; after_quantity: number; after_total: number | null; reason: string | null; table_name: string | null; needs_confirmation: boolean }
type Impact = { bl_id: string; manual_exempt: boolean; items: ImpactItem[] }
function impact(changes: unknown[]): Impact[] {
  return JSON.parse(ok(USERS.ope, `SELECT public.preview_bl_charge_adjustment_impact(${q(JSON.stringify(changes))}::jsonb)`))
}
function alertOf(blId: string) {
  return psql(`SELECT i.status || '|' || i.message FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'taxa_alterada_mudou' AND a.entity_id = ${q(blId)} ORDER BY i.id DESC LIMIT 1`)
}
const activeAdjustments = (blId: string) =>
  psql(`SELECT count(*) FROM public.bl_charge_adjustments WHERE bl_id = ${q(blId)} AND ended_at IS NULL`)
const eventCount = (blId: string) => psql(`SELECT count(*) FROM public.bl_charge_adjustment_events WHERE bl_id = ${q(blId)}`)

function cleanup() {
  const bls = `ARRAY[${ALL_BLS.map(q).join(',')}]::text[]`
  const users = Object.values(USERS).map(q).join(',')
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.bl_charge_adjustment_acks WHERE bl_id = ANY(${bls});
    DELETE FROM public.bl_charge_adjustment_events WHERE bl_id = ANY(${bls});
    DELETE FROM public.charge_calculations WHERE bl_id = ANY(${bls});
    DELETE FROM public.bl_charge_adjustments WHERE bl_id = ANY(${bls});
    DELETE FROM public.bl_local_charge_exemptions WHERE bl_id = ANY(${bls});
    DELETE FROM public.bl_receivables WHERE bl_id = ANY(${bls});
    DELETE FROM public.bl_charge_calculation_basis WHERE bl_id = ANY(${bls});
    DELETE FROM public.bl_price_freeze_items WHERE bl_id = ANY(${bls});
    DELETE FROM public.bl_price_freezes WHERE bl_id = ANY(${bls});
    DELETE FROM public.bl_charge_table_links WHERE bl_id = ANY(${bls});
    DELETE FROM public.import_pending_effects WHERE entity_id = ANY(${bls});
    DELETE FROM public.bl_containers WHERE bl_id = ANY(${bls});
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT i.id FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id WHERE a.entity_id = ANY(${bls}));
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_id = ANY(${bls}));
    DELETE FROM public.alerts WHERE entity_id = ANY(${bls});
    DELETE FROM public.bls WHERE id = ANY(${bls});
    DELETE FROM public.pricing_rule_versions WHERE charge_table_id IN (${T_A}, ${T_B});
    DELETE FROM public.charge_table_items WHERE charge_table_id IN (${T_A}, ${T_B});
    DELETE FROM public.charge_tables WHERE id IN (${T_A}, ${T_B});
    DELETE FROM public.voyages WHERE id = ${VOYAGE};
    DELETE FROM public.vessels WHERE id = ${VESSEL};
    DELETE FROM public.carriers WHERE id = ${CARRIER};
    DELETE FROM public.customers WHERE id = ${CUSTOMER};
    DELETE FROM public.audit_logs WHERE bl_id = ANY(${bls}) OR entity_id = ANY(${bls}) OR changed_by IN (${users});
    DELETE FROM public.user_profiles WHERE id IN (${users});
    DELETE FROM auth.users WHERE id IN (${users});
    SET session_replication_role = origin;
  `)
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.preview_bl_charge_adjustment_impact(jsonb)') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 495 (preview_bl_charge_adjustment_impact)')

describeLocal('495 — prévia, aceite e alerta da taxa alterada à mão', () => {
  beforeAll(() => {
    cleanup()
    const containerBl = (id: string) => `(${q(id)}, ${VOYAGE}, ${CUSTOMER}, ${q(POD)}, 'container', 'pending', 'not_calculated', 'reconciled')`
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES
        ('${USERS.adm}', 'adm495@test.local', 'authenticated', 'authenticated'),
        ('${USERS.ope}', 'ope495@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${USERS.adm}', 'Administrativo 495', 'administrativo', true),
        ('${USERS.ope}', 'Operações 495', 'operacoes', true)
        ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = EXCLUDED.active;
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${CUSTOMER}, '${syntheticCnpj(495001)}', 'Cliente 495');
      INSERT INTO public.exchange_rate_reference (id, roe, effective_date) VALUES (1, 5, CURRENT_DATE) ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER}, 'Carrier 495');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL}, 'Vessel 495', ${CARRIER});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE}, ${VESSEL}, 'R495', 'active');
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode) VALUES
        (${T_A}, 'Tabela 495 A', '${POD}', CURRENT_DATE - 60, true, 'container'),
        (${T_B}, 'Tabela 495 B', '${POD_B}', CURRENT_DATE - 60, true, 'container');
      INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, unit_value_usd, application_basis, category, cargo_profile, currency, manual_only) VALUES
        (${THD}, ${T_A}, 'THD', 'container', 1420, 1420, NULL, 'container_distinct_voyage', 'base', 'standard', 'BRL', false),
        (${BL_FEE}, ${T_A}, 'Taxa de B/L', 'bl', 300, 300, NULL, 'bl', 'base', 'any', 'BRL', false),
        (${THD_B}, ${T_B}, 'THD', 'container', 1500, 1500, NULL, 'container_distinct_voyage', 'base', 'standard', 'BRL', false),
        (${BL_FEE_B}, ${T_B}, 'Taxa de B/L', 'bl', 350, 350, NULL, 'bl', 'base', 'any', 'BRL', false);
      INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status)
      VALUES ${ALL_BLS.map(containerBl).join(', ')};
      INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES
        (${q(BL.total)}, 'RTAU4950001', '22G1'), (${q(BL.total)}, 'RTAU4950002', '22G1'),
        (${q(BL.unit)}, 'RTAU4950003', '22G1'), (${q(BL.unit)}, 'RTAU4950004', '22G1'),
        (${q(BL.pod)}, 'RTAU4950005', '22G1'),
        (${q(BL.ack)}, 'RTAU4950006', '22G1'),
        (${q(BL.queue)}, 'RTAU4950007', '22G1'),
        (${q(BL.share1)}, 'RTAU4950008', '22G1'), (${q(BL.share2)}, 'RTAU4950008', '22G1'),
        (${q(BL.exempt)}, 'RTAU4950009', '22G1'),
        (${q(BL.plain)}, 'RTAU4950010', '22G1');
    `)
    for (const id of ALL_BLS) calculate(id)
    alter(BL.total, thd, 'total', 2000)
    alter(BL.unit, thd, 'unit', 1200)
    alter(BL.pod, blFee, 'unit', 280)
    alter(BL.ack, blFee, 'unit', 280)
    alter(BL.queue, blFee, 'unit', 280)
    alter(BL.share1, thd, 'total', 1000)
    alter(BL.exempt, blFee, 'unit', 250)
    ok(USERS.adm, `SELECT public.exempt_bl_local_charges(${q(BL.exempt)}, ${q(JUST)}, '${USERS.adm}'::uuid)`)
  })

  afterAll(cleanup)

  it('B/L sem alteração não entra na prévia', () => {
    expect(impact([{ bl_id: BL.plain, bls: { pod: POD_B } }])).toEqual([])
  })

  it('container novo: total alterado mantido pede confirmação; a simulação não deixa rastro', () => {
    const events = eventCount(BL.total)
    const [entry] = impact([{ bl_id: BL.total, add_containers: [{ container_number: 'RTAU4950099', type: '22G1' }] }])
    const thdItem = entry.items.find((item) => item.charge_name === 'THD')!
    expect(thdItem).toMatchObject({ outcome: 'total_kept', quantity: 2, after_quantity: 3, after_total: 2000, needs_confirmation: true })
    expect(psql(`SELECT count(*) FROM public.bl_containers WHERE bl_id = ${q(BL.total)}`)).toBe('2')
    expect(eventCount(BL.total)).toBe(events)
    expect(alertOf(BL.total)).toBe('')
  })

  it('container que sai pelo número (reimportação do B/L): a quantidade cai na prévia', () => {
    const [entry] = impact([{ bl_id: BL.unit, remove_container_numbers: ['rtau4950004'] }])
    expect(entry.items.find((item) => item.charge_name === 'THD')).toMatchObject({ outcome: 'quantity', quantity: 2, after_quantity: 1 })
    expect(psql(`SELECT count(*) FROM public.bl_containers WHERE bl_id = ${q(BL.unit)}`)).toBe('2')
  })

  it('a simulação é igual ao efeito real: a gravação sem aceite muda a quantidade e abre o alerta', () => {
    saveAs(USERS.ope, `INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES (${q(BL.total)}, 'RTAU4950099', '22G1')`)
    expect(psql(`SELECT (after->>'quantity')::numeric(12,0) || '|' || (after->>'total') FROM public.bl_charge_adjustment_events
      WHERE bl_id = ${q(BL.total)} AND event = 'quantity_changed'`)).toBe('3|2000.00')
    expect(alertOf(BL.total)).toBe(`active|A quantidade da taxa THD do B/L ${BL.total} mudou de 2 para 3; o valor total alterado foi mantido em R$ 2.000,00. Confira se ainda vale.`)
  })

  it('por unidade: a quantidade muda com o total novo, sem pedir confirmação', () => {
    const [entry] = impact([{ bl_id: BL.unit, add_containers: [{ container_number: 'RTAU4950098', type: '22G1' }] }])
    expect(entry.items.find((item) => item.charge_name === 'THD')).toMatchObject({
      outcome: 'quantity', quantity: 2, after_quantity: 3, after_total: 3600, needs_confirmation: false,
    })
  })

  it('troca de POD: descartada com o motivo e a tabela nova, igual ao efeito real', () => {
    const [entry] = impact([{ bl_id: BL.pod, bls: { pod: POD_B } }])
    expect(entry.items).toEqual([expect.objectContaining({
      charge_name: 'Taxa de B/L', outcome: 'discarded', reason: 'pod', table_name: 'Tabela 495 B', needs_confirmation: true,
    })])
    expect(activeAdjustments(BL.pod)).toBe('1')
    saveAs(USERS.ope, `UPDATE public.bls SET pod = ${q(POD_B)} WHERE id = ${q(BL.pod)}`)
    expect(activeAdjustments(BL.pod)).toBe('0')
    expect(psql(`SELECT after->>'reason' || '|' || (after->>'table_name') FROM public.bl_charge_adjustment_events
      WHERE bl_id = ${q(BL.pod)} AND event = 'discarded'`)).toBe('pod|Tabela 495 B')
    expect(alertOf(BL.pod)).toBe(`active|A alteração à mão da taxa Taxa de B/L do B/L ${BL.pod} foi descartada: o B/L passou para a tabela Tabela 495 B.`)
  })

  it('com o aceite do Gravar mesmo assim, a mesma gravação não abre alerta', () => {
    expect(ok(USERS.ope, `SELECT public.ack_bl_charge_adjustment_impact(ARRAY[${q(BL.ack)}])`)).toBe('1')
    saveAs(USERS.ope, `UPDATE public.bls SET pod = ${q(POD_B)} WHERE id = ${q(BL.ack)}`)
    expect(activeAdjustments(BL.ack)).toBe('0')
    expect(alertOf(BL.ack)).toBe('')
  })

  it('sem ninguém na tela (fila de efeitos, sem sessão), o descarte abre o alerta', () => {
    psql(`UPDATE public.bls SET pod = ${q(POD_B)} WHERE id = ${q(BL.queue)}`)
    expect(activeAdjustments(BL.queue)).toBe('0')
    expect(alertOf(BL.queue)).toMatch(/^active\|A alteração à mão da taxa Taxa de B\/L do B\/L R495-QUE foi descartada/)
    expect(psql(`SELECT 'administrativo' = ANY(audience_departments) AND 'financeiro' = ANY(audience_departments)
      FROM public.alert_type_catalog WHERE type = 'taxa_alterada_mudou'`)).toBe('t')
  })

  it('Resolver com justificativa fecha o alerta', () => {
    const item = psql(`SELECT i.id FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'taxa_alterada_mudou' AND a.entity_id = ${q(BL.queue)} AND i.status = 'active'`)
    ok(USERS.adm, `SELECT public.resolve_alert_item_with_justification(${item}, 'Conferido com o comercial')`)
    expect(alertOf(BL.queue)).toMatch(/^resolved\|/)
  })

  it('container compartilhado: o irmão entra na prévia', () => {
    const result = impact([{ bl_id: BL.share2, remove_container_ids: [] , bls: { total_weight_kg: 1 } }])
    expect(result.map((entry) => entry.bl_id)).toEqual([BL.share1])
    expect(result[0].items[0]).toMatchObject({ charge_name: 'THD', outcome: 'kept' })
  })

  it('perfil do container corrigido pelo irmão: a simulação muda o container nos dois B/Ls (Part Lot)', () => {
    // Como set_bl_container_profile: o perfil vale para todos os B/Ls ativos da Viagem.
    expect(psql(`BEGIN;
      SELECT public._apply_bl_charge_simulation_change(${q(JSON.stringify({ bl_id: BL.share2, container_flags: [{ container_number: 'RTAU4950008', is_imo: true }] }))}::jsonb);
      SELECT string_agg(bl_id || '=' || is_imo, ',' ORDER BY bl_id) FROM public.bl_containers WHERE container_number = 'RTAU4950008';
      ROLLBACK;`).split('\n').pop()).toBe(`${BL.share1}=true,${BL.share2}=true`)
  })

  it('B/L isento à mão aparece como isento', () => {
    const [entry] = impact([{ bl_id: BL.exempt, bls: { pod: POD_B } }])
    expect(entry.manual_exempt).toBe(true)
  })

  it('a prévia e o aceite pedem usuário interno ativo', () => {
    const run = spawnPsql(['-X', '-At', '-q', '-d', databaseUrl, '-c', `
      BEGIN; SET LOCAL ROLE anon; SELECT public.preview_bl_charge_adjustment_impact('[]'::jsonb); COMMIT;`], { encoding: 'utf8' })
    expect(run.status).not.toBe(0)
    const ack = spawnPsql(['-X', '-At', '-q', '-d', databaseUrl, '-c', `
      BEGIN; SET LOCAL ROLE authenticated; SELECT public.ack_bl_charge_adjustment_impact(ARRAY['X']); COMMIT;`], { encoding: 'utf8' })
    expect(ack.stderr).toMatch(/Somente usuário interno ativo/)
    expect(psql(`SELECT has_table_privilege('authenticated', 'public.bl_charge_adjustment_acks', 'INSERT')`)).toBe('f')
  })
})
