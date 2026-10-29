import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 492 (ADR 0111, D12; lote 2): Isentar Taxas Locais à mão. O B/L
// passa ao estado Isento que o sistema já trata, por cima de todo recálculo;
// as linhas ficam como referência e nenhuma taxa muda até Retirar isenção, que
// recalcula com as alterações e exclusões que o B/L tinha.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const USERS = {
  adm: '04920000-0000-4000-8000-0000000000a1',
  fin: '04920000-0000-4000-8000-0000000000a2',
  ope: '04920000-0000-4000-8000-0000000000a3',
  doc: '04920000-0000-4000-8000-0000000000a4',
  equ: '04920000-0000-4000-8000-0000000000a5',
  // Sessão sem perfil interno (como o usuário do Portal).
  outsider: '04920000-0000-4000-8000-0000000000a6',
} as const
const CARRIER = 49200001
const VESSEL = 49200002
const VOYAGE = 49200003
const CUSTOMER = 49200004
const T_CTR = 49200010
const T_CTR_B = 49200011
const THD = 49200020
const BL_FEE = 49200021
const ARMAZ = 49200022
const THD_B = 49200023
const POD = 'R492A'
const POD_B = 'R492B'
const BL = { main: 'R492-MAIN', perm: 'R492-PERM', pod: 'R492-POD', lcl: 'R492-LCL', ce: 'R492-CE' } as const
const ALL_BLS = Object.values(BL)
const JUST = 'Carga de doação, acordado com a diretoria'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function as(userId: string, sql: string) {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    ${sql};
    COMMIT;
  `], { encoding: 'utf8' })
  const last = (run.stdout ?? '').trim().split('\n').pop() ?? ''
  return { status: run.status, stderr: run.stderr ?? '', json: run.status === 0 && last.startsWith('{') ? JSON.parse(last) : null }
}

const q = (value: string) => `'${value.replace(/'/g, "''")}'`
const thd = `auto:item:${THD}`
const blFee = `auto:item:${BL_FEE}`

const exempt = (userId: string, blId: string, justification = JUST) =>
  as(userId, `SELECT public.exempt_bl_local_charges(${q(blId)}, ${q(justification)}, '${userId}'::uuid)`)
const unexempt = (userId: string, blId: string, justification = JUST) =>
  as(userId, `SELECT public.remove_bl_local_charge_exemption(${q(blId)}, ${q(justification)}, '${userId}'::uuid)`)
function calculate(blId: string) {
  const run = as(USERS.adm, `SELECT public.calculate_bl_local_charges(${q(blId)}, '${USERS.adm}'::uuid, true)`)
  expect(run.status, run.stderr).toBe(0)
  return run.json as Record<string, unknown>
}
const state = (blId: string) => psql(`SELECT charge_status || '|' || coalesce(charge_exemption_reason, '') FROM public.bls WHERE id = ${q(blId)}`)
/** `chave|situação|total` de cada linha, na moeda da taxa. */
const lines = (blId: string) => psql(`SELECT string_agg(concat_ws('|', calculation_key, status,
    coalesce(total_value_brl, total_value_usd)), ',' ORDER BY source, calculation_key)
  FROM public.charge_calculations WHERE bl_id = ${q(blId)}`)

function cleanup() {
  const bls = `ARRAY[${ALL_BLS.map(q).join(',')}]::text[]`
  const users = Object.values(USERS).map(q).join(',')
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.bl_local_charge_exemptions WHERE bl_id = ANY(${bls});
    DELETE FROM public.bl_charge_adjustment_events WHERE bl_id = ANY(${bls});
    DELETE FROM public.charge_calculations WHERE bl_id = ANY(${bls});
    DELETE FROM public.bl_charge_adjustments WHERE bl_id = ANY(${bls});
    DELETE FROM public.bl_receivables WHERE bl_id = ANY(${bls});
    DELETE FROM public.bl_charge_calculation_basis WHERE bl_id = ANY(${bls});
    DELETE FROM public.bl_price_freeze_items WHERE bl_id = ANY(${bls});
    DELETE FROM public.bl_price_freezes WHERE bl_id = ANY(${bls});
    DELETE FROM public.bl_charge_table_links WHERE bl_id = ANY(${bls});
    DELETE FROM public.import_pending_effects WHERE entity_id = ANY(${bls});
    DELETE FROM public.vehicles WHERE bl_id = ANY(${bls});
    DELETE FROM public.bl_containers WHERE bl_id = ANY(${bls});
    DELETE FROM public.alert_items WHERE metadata->>'bl_id' = ANY(${bls});
    DELETE FROM public.bls WHERE id = ANY(${bls});
    DELETE FROM public.pricing_rule_versions WHERE charge_table_id IN (${T_CTR}, ${T_CTR_B});
    DELETE FROM public.charge_table_items WHERE charge_table_id IN (${T_CTR}, ${T_CTR_B});
    DELETE FROM public.charge_tables WHERE id IN (${T_CTR}, ${T_CTR_B});
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
    return psql(`SELECT to_regprocedure('public.exempt_bl_local_charges(text,text,uuid)') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 492 (exempt_bl_local_charges)')

describeLocal('492 — Isentar Taxas Locais à mão', () => {
  beforeAll(() => {
    cleanup()
    const containerBl = (id: string) => `(${q(id)}, ${VOYAGE}, ${CUSTOMER}, ${q(POD)}, 'container', 'pending', 'not_calculated', 'reconciled')`
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES
        ${Object.entries(USERS).map(([k, id]) => `('${id}', '${k}492@test.local', 'authenticated', 'authenticated')`).join(',')};
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${USERS.adm}', 'Administrativo 492', 'administrativo', true),
        ('${USERS.fin}', 'Financeiro 492', 'financeiro', true),
        ('${USERS.ope}', 'Operações 492', 'operacoes', true),
        ('${USERS.doc}', 'Documentação 492', 'documentacao', true),
        ('${USERS.equ}', 'Equipamentos 492', 'equipamentos', true)
        ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = EXCLUDED.active;
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${CUSTOMER}, '${syntheticCnpj(492001)}', 'Cliente 492');
      INSERT INTO public.exchange_rate_reference (id, roe, effective_date) VALUES (1, 5, CURRENT_DATE) ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER}, 'Carrier 492');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL}, 'Vessel 492', ${CARRIER});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE}, ${VESSEL}, 'R492', 'active');
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode) VALUES
        (${T_CTR}, 'Tabela 492 A', '${POD}', CURRENT_DATE - 60, true, 'container'),
        (${T_CTR_B}, 'Tabela 492 B', '${POD_B}', CURRENT_DATE - 60, true, 'container');
      INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, unit_value_usd, application_basis, category, cargo_profile, currency, manual_only) VALUES
        (${THD}, ${T_CTR}, 'THD', 'container', 1420, 1420, NULL, 'container_distinct_voyage', 'base', 'standard', 'BRL', false),
        (${BL_FEE}, ${T_CTR}, 'Taxa de B/L', 'bl', 300, 300, NULL, 'bl', 'base', 'any', 'BRL', false),
        (${ARMAZ}, ${T_CTR}, 'Armazenagem', 'bl', 500, 500, NULL, 'bl', 'other_charge', 'any', 'BRL', true),
        (${THD_B}, ${T_CTR_B}, 'THD', 'container', 1500, 1500, NULL, 'container_distinct_voyage', 'base', 'standard', 'BRL', false);
      INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status)
      VALUES ${ALL_BLS.map(containerBl).join(', ')};
      UPDATE public.bls SET movement_to = 'LCL' WHERE id = ${q(BL.lcl)};
      UPDATE public.bls SET ce_mercante = '492000000000001' WHERE id = ${q(BL.ce)};
      INSERT INTO public.bl_containers (bl_id, container_number, type, is_imo, is_oog) VALUES
        ${ALL_BLS.map((id, i) => `(${q(id)}, 'RTAU492000${i}', '22G1', false, false)`).join(', ')},
        (${q(BL.main)}, 'RTAU4920099', '22G1', false, false);
    `)
    for (const id of ALL_BLS) calculate(id)
  })

  afterAll(cleanup)

  it('todos os setores isentam e retiram a isenção; justificativa curta é recusada', () => {
    expect(exempt(USERS.ope, BL.perm, 'curta').stderr).toMatch(/Justificativa obrigatória: escreva ao menos 10 caracteres/)
    const users = [USERS.adm, USERS.fin, USERS.ope, USERS.doc, USERS.equ]
    for (const [index, user] of users.entries()) {
      const on = exempt(user, BL.perm)
      expect(on.status, on.stderr).toBe(0)
      const off = unexempt(users[(index + 1) % users.length], BL.perm)
      expect(off.status, off.stderr).toBe(0)
    }
    expect(unexempt(USERS.ope, BL.perm).stderr).toMatch(/não está isento à mão/)
    const direct = as(USERS.adm, `INSERT INTO public.bl_local_charge_exemptions (bl_id, justification, created_by)
      VALUES (${q(BL.perm)}, ${q(JUST)}, '${USERS.adm}')`)
    expect(direct.stderr).toMatch(/permission denied/)
  })

  it('isentar põe o B/L em Isento, com as linhas como referência e a excluída ainda excluída', () => {
    expect(as(USERS.ope, `SELECT public.alter_bl_charge_value(${q(BL.main)}, ${q(thd)}, 'unit', 1200, ${q(JUST)}, '${USERS.ope}'::uuid)`).status).toBe(0)
    expect(as(USERS.ope, `SELECT public.exclude_bl_charge(${q(BL.main)}, ${q(blFee)}, ${q(JUST)}, '${USERS.ope}'::uuid)`).status).toBe(0)
    expect(as(USERS.ope, `SELECT public.add_manual_bl_charge(${q(BL.main)}, ${ARMAZ}, 2, NULL, '${USERS.ope}'::uuid)`).status).toBe(0)
    const run = exempt(USERS.ope, BL.main)
    expect(run.status, run.stderr).toBe(0)
    expect(run.json).toMatchObject({ status: 'exempt' })
    expect(state(BL.main)).toBe(`exempt|Isenção manual: ${JUST}`)
    const manualKey = psql(`SELECT calculation_key FROM public.charge_calculations WHERE bl_id = ${q(BL.main)} AND source = 'manual'`)
    expect(lines(BL.main)).toBe(`${thd}|exempt|0.00,${blFee}|excluded|0.00,${manualKey}|exempt|0.00`)
    expect(psql(`SELECT table_total_value_brl FROM public.charge_calculations WHERE bl_id = ${q(BL.main)} AND calculation_key = ${q(thd)}`)).toBe('2840.00')
    expect(psql(`SELECT public._quote_bl_local_charges(${q(BL.main)}, NULL)->>'status'`)).toBe('exempt')
    expect(psql(`SELECT public.bl_local_charges_state(charge_status, financial_status, cancelled_at) FROM public.bls WHERE id = ${q(BL.main)}`)).toBe('exempt')
    // Desbloqueio de CE: B/L isento sem recebível vivo tem o Financeiro atendido (449).
    expect(psql(`SELECT count(*) FROM public.bl_receivables WHERE bl_id = ${q(BL.main)} AND source = 'local_charges' AND status <> 'void'`)).toBe('0')
  })

  it('com o B/L isento à mão, nenhuma taxa se altera, exclui ou lança', () => {
    const refusal = /B\/L isento das Taxas Locais: retire a isenção para alterar as taxas/
    expect(as(USERS.ope, `SELECT public.alter_bl_charge_value(${q(BL.main)}, ${q(thd)}, 'unit', 900, ${q(JUST)}, '${USERS.ope}'::uuid)`).stderr).toMatch(refusal)
    expect(as(USERS.ope, `SELECT public.restore_bl_charge(${q(BL.main)}, ${q(blFee)}, ${q(JUST)}, '${USERS.ope}'::uuid)`).stderr).toMatch(refusal)
    expect(as(USERS.ope, `SELECT public.add_manual_bl_charge(${q(BL.main)}, ${ARMAZ}, 1, NULL, '${USERS.ope}'::uuid)`).stderr).toMatch(refusal)
    const manualId = psql(`SELECT id FROM public.charge_calculations WHERE bl_id = ${q(BL.main)} AND source = 'manual'`)
    expect(as(USERS.ope, `SELECT public.update_manual_bl_charge(${manualId}, 3, NULL, '${USERS.ope}'::uuid)`).stderr).toMatch(refusal)
    expect(as(USERS.ope, `SELECT public.delete_manual_bl_charge(${manualId}, ${q(JUST)}, '${USERS.ope}'::uuid)`).stderr).toMatch(refusal)
    expect(exempt(USERS.ope, BL.main).stderr).toMatch(/já está isento das Taxas Locais/)
  })

  // 497: a guarda vem antes de ler o B/L; quem não é usuário interno não
  // descobre que o B/L de outro Cliente existe e está isento à mão.
  it('quem não é usuário interno recebe a recusa da guarda, não a da isenção', () => {
    const manualId = psql(`SELECT id FROM public.charge_calculations WHERE bl_id = ${q(BL.main)} AND source = 'manual'`)
    for (const sql of [
      `SELECT public.add_manual_bl_charge(${q(BL.main)}, ${ARMAZ}, 1, NULL, NULL)`,
      `SELECT public.update_manual_bl_charge(${manualId}, 3, NULL, NULL)`,
    ]) {
      const run = as(USERS.outsider, sql)
      expect(run.status).not.toBe(0)
      expect(run.stderr).toMatch(/Usuário sem permissão ativa/)
      expect(run.stderr).not.toMatch(/isento/)
    }
  })

  it('a isenção se mantém no Recalcular e na troca de POD', () => {
    expect(calculate(BL.main)).toMatchObject({ status: 'exempt', manual_exemption: true })
    expect(state(BL.main)).toBe(`exempt|Isenção manual: ${JUST}`)
    expect(exempt(USERS.ope, BL.pod).status).toBe(0)
    psql(`UPDATE public.bls SET pod = ${q(POD_B)} WHERE id = ${q(BL.pod)}`)
    calculate(BL.pod)
    expect(state(BL.pod)).toBe(`exempt|Isenção manual: ${JUST}`)
    expect(lines(BL.pod)).toBe(`auto:item:${THD_B}|exempt|0.00`)
  })

  it('retirar a isenção devolve as taxas com as alterações e exclusões que o B/L tinha', () => {
    const run = unexempt(USERS.fin, BL.main)
    expect(run.status, run.stderr).toBe(0)
    expect(run.json).toMatchObject({ status: 'calculated' })
    expect(state(BL.main)).toBe('calculated|')
    const manualKey = psql(`SELECT calculation_key FROM public.charge_calculations WHERE bl_id = ${q(BL.main)} AND source = 'manual'`)
    expect(lines(BL.main)).toBe(`${thd}|calculated|2400.00,${blFee}|excluded|0.00,${manualKey}|reviewed|1000.00`)
    expect(psql(`SELECT public._quote_bl_local_charges(${q(BL.main)}, NULL)->>'status'`)).not.toBe('exempt')
    expect(psql(`SELECT string_agg(event || ':' || coalesce(charge_name, '-'), ',' ORDER BY id) FROM public.bl_charge_adjustment_events
      WHERE bl_id = ${q(BL.main)}`)).toBe('altered:THD,excluded:Taxa de B/L,exempted:-,exemption_removed:-')
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE bl_id = ${q(BL.main)} AND field_name = 'charge_adjustment'
      AND new_value::jsonb->>'event' IN ('exempted', 'exemption_removed')`)).toBe('2')
  })

  it('a isenção pelo veículo LCL vale primeiro e continua depois de retirar a isenção à mão', () => {
    expect(exempt(USERS.ope, BL.lcl).status).toBe(0)
    psql(`INSERT INTO public.vehicles (voyage_id, container_id, bl_id, chassis, brand, model, weight_kg, cbm)
      SELECT ${VOYAGE}, c.id, c.bl_id, 'R492CHASSI0000001', 'Marca', 'Modelo', 1000, 10 FROM public.bl_containers c WHERE c.bl_id = ${q(BL.lcl)}`)
    calculate(BL.lcl)
    expect(state(BL.lcl)).toMatch(/^exempt\|Carga de veiculos \/ LCL/)
    expect(unexempt(USERS.ope, BL.lcl).status).toBe(0)
    expect(state(BL.lcl)).toMatch(/^exempt\|Carga de veiculos \/ LCL/)
    expect(exempt(USERS.ope, BL.lcl).stderr).toMatch(/já está isento das Taxas Locais pelo veículo LCL/)
  })

  it('o CE não emite fatura do B/L isento à mão', () => {
    expect(exempt(USERS.ope, BL.ce).status).toBe(0)
    const emitted = as(USERS.adm, `SELECT public.emit_ce_mercante_billing(ARRAY[${q(BL.ce)}])`)
    expect(emitted.status, emitted.stderr).toBe(0)
    const result = (emitted.json as { results: Array<Record<string, string>> }).results[0]
    expect(result.status).toBe('skipped')
    expect(psql(`SELECT count(*) FROM public.invoices WHERE bl_id = ${q(BL.ce)}`)).toBe('0')
  })
})
