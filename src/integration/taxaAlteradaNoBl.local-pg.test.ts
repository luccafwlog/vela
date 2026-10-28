import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 491 (ADR 0111; spec 2026-10-28, lote 1): na ficha do B/L qualquer
// setor altera o valor de uma taxa (por unidade ou total), exclui a taxa e
// desfaz, com justificativa. A alteração é decisão do B/L sobre a taxa: o
// resolvedor a aplica, então ela sobrevive aos recálculos e só se perde quando
// a tabela sai do B/L (POD ou modalidade, R1) ou passa para a taxa
// equivalente da tabela nova (preço refixado, R2).

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const USERS = {
  adm: '04910000-0000-4000-8000-0000000000a1',
  fin: '04910000-0000-4000-8000-0000000000a2',
  ope: '04910000-0000-4000-8000-0000000000a3',
  doc: '04910000-0000-4000-8000-0000000000a4',
  equ: '04910000-0000-4000-8000-0000000000a5',
  inactive: '04910000-0000-4000-8000-0000000000a6',
  portal: '04910000-0000-4000-8000-0000000000a7',
} as const
const CARRIER = 49100001
const VESSEL = 49100002
const VOYAGE = 49100003
const CUSTOMER = 49100004
const CUSTOMER_B = 49100005
const T_CTR = 49100010
const T_CTR_B = 49100011
const T_BB = 49100012
const T_CTR_NEW = 49100013
const THD = 49100020
const THD_IMO = 49100021
const THD_OOG = 49100022
const BL_FEE = 49100023
const SCANNER = 49100024
const ARMAZ = 49100025
const THD_B = 49100026
const BL_FEE_B = 49100027
const WHARF = 49100028
const THD_NEW = 49100029
const BL_FEE_NEW = 49100030
const POD = 'R491A'
const POD_B = 'R491B'
const BL = {
  main: 'R491-MAIN', unit: 'R491-UNIT', share1: 'R491-SH1', share2: 'R491-SH2', dual: 'R491-DUAL',
  misto: 'R491-MIX', usd: 'R491-USD', manual: 'R491-MAN', cancel: 'R491-CAN', refix: 'R491-RFX',
  last: 'R491-LAST', perm: 'R491-PERM',
} as const
const ALL_BLS = Object.values(BL)

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

function ok(userId: string, sql: string) {
  const run = as(userId, sql)
  expect(run.status, run.stderr).toBe(0)
  return run.json as Record<string, unknown>
}

const q = (value: string) => `'${value.replace(/'/g, "''")}'`
const JUST = 'Avaria no terminal, acordado com o Cliente'

function alter(userId: string, blId: string, key: string, kind: 'unit' | 'total', value: number, justification = JUST) {
  return as(userId, `SELECT public.alter_bl_charge_value(${q(blId)}, ${q(key)}, ${q(kind)}, ${value}, ${q(justification)}, '${userId}'::uuid)`)
}
function exclude(userId: string, blId: string, key: string, justification = JUST) {
  return as(userId, `SELECT public.exclude_bl_charge(${q(blId)}, ${q(key)}, ${q(justification)}, '${userId}'::uuid)`)
}
function restore(userId: string, blId: string, key: string, justification = JUST) {
  return as(userId, `SELECT public.restore_bl_charge(${q(blId)}, ${q(key)}, ${q(justification)}, '${userId}'::uuid)`)
}
function calculate(blId: string) {
  return ok(USERS.adm, `SELECT public.calculate_bl_local_charges(${q(blId)}, '${USERS.adm}'::uuid, true)`)
}

/** `chave|situação|qtd|unitário|total` de cada linha, na moeda da taxa. */
function lines(blId: string) {
  return psql(`SELECT string_agg(concat_ws('|', calculation_key, status, quantity::numeric(12,2),
      coalesce(unit_value_brl, unit_value_usd), coalesce(total_value_brl, total_value_usd)), ',' ORDER BY calculation_key)
    FROM public.charge_calculations WHERE bl_id = ${q(blId)}`)
}
function line(blId: string, key: string) {
  return psql(`SELECT concat_ws('|', status, quantity::numeric(12,2), coalesce(unit_value_brl, unit_value_usd),
      coalesce(total_value_brl, total_value_usd), coalesce(table_total_value_brl, table_total_value_usd), (adjustment_id IS NOT NULL)::text)
    FROM public.charge_calculations WHERE bl_id = ${q(blId)} AND calculation_key = ${q(key)}`)
}
function events(blId: string) {
  return psql(`SELECT string_agg(event, ',' ORDER BY id) FROM public.bl_charge_adjustment_events WHERE bl_id = ${q(blId)}`)
}
const thd = `auto:item:${THD}`
const blFee = `auto:item:${BL_FEE}`

function cleanup() {
  const bls = `ARRAY[${ALL_BLS.map(q).join(',')}]::text[]`
  const users = Object.values(USERS).map(q).join(',')
  psql(`
    SET session_replication_role = replica;
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
    DELETE FROM public.customer_rate_overrides WHERE customer_id IN (${CUSTOMER}, ${CUSTOMER_B});
    DELETE FROM public.pricing_rule_versions WHERE charge_table_id IN (${T_CTR}, ${T_CTR_B}, ${T_BB}, ${T_CTR_NEW});
    DELETE FROM public.charge_table_items WHERE charge_table_id IN (${T_CTR}, ${T_CTR_B}, ${T_BB}, ${T_CTR_NEW});
    DELETE FROM public.charge_tables WHERE id IN (${T_CTR}, ${T_CTR_B}, ${T_BB}, ${T_CTR_NEW});
    DELETE FROM public.voyages WHERE id = ${VOYAGE};
    DELETE FROM public.vessels WHERE id = ${VESSEL};
    DELETE FROM public.carriers WHERE id = ${CARRIER};
    DELETE FROM public.customers WHERE id IN (${CUSTOMER}, ${CUSTOMER_B});
    DELETE FROM public.audit_logs WHERE bl_id = ANY(${bls}) OR entity_id = ANY(${bls}) OR changed_by IN (${users});
    DELETE FROM public.user_profiles WHERE id IN (${users});
    DELETE FROM auth.users WHERE id IN (${users});
    SET session_replication_role = origin;
  `)
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.alter_bl_charge_value(text,text,text,numeric,text,uuid)') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 491 (alter_bl_charge_value)')

describeLocal('491 — alterar e excluir taxa calculada do B/L', () => {
  beforeAll(() => {
    cleanup()
    const containerBl = (id: string) => `(${q(id)}, ${VOYAGE}, ${CUSTOMER}, ${q(POD)}, 'container', 'pending', 'not_calculated', 'reconciled')`
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES
        ${Object.entries(USERS).map(([k, id]) => `('${id}', '${k}491@test.local', 'authenticated', 'authenticated')`).join(',')};
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${USERS.adm}', 'Administrativo 491', 'administrativo', true),
        ('${USERS.fin}', 'Financeiro 491', 'financeiro', true),
        ('${USERS.ope}', 'Operações 491', 'operacoes', true),
        ('${USERS.doc}', 'Documentação 491', 'documentacao', true),
        ('${USERS.equ}', 'Equipamentos 491', 'equipamentos', true),
        ('${USERS.inactive}', 'Inativo 491', 'operacoes', false)
        ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = EXCLUDED.active;
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
        (${CUSTOMER}, '${syntheticCnpj(491001)}', 'Cliente 491'), (${CUSTOMER_B}, '${syntheticCnpj(491002)}', 'Cliente 491 B');
      INSERT INTO public.exchange_rate_reference (id, roe, effective_date) VALUES (1, 5, CURRENT_DATE) ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER}, 'Carrier 491');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL}, 'Vessel 491', ${CARRIER});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE}, ${VESSEL}, 'R491', 'active');
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode) VALUES
        (${T_CTR}, 'Tabela 491 A', '${POD}', CURRENT_DATE - 60, true, 'container'),
        (${T_CTR_B}, 'Tabela 491 B', '${POD_B}', CURRENT_DATE - 60, true, 'container'),
        (${T_BB}, 'Tabela 491 Carga Solta', '${POD}', CURRENT_DATE - 60, true, 'carga_solta');
      INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, unit_value_usd, application_basis, category, cargo_profile, currency, manual_only) VALUES
        (${THD}, ${T_CTR}, 'THD', 'container', 1420, 1420, NULL, 'container_distinct_voyage', 'base', 'standard', 'BRL', false),
        (${THD_IMO}, ${T_CTR}, 'THD', 'container', 2130, 2130, NULL, 'container_distinct_voyage', 'base', 'imo', 'BRL', false),
        (${THD_OOG}, ${T_CTR}, 'THD', 'container', 2840, 2840, NULL, 'container_distinct_voyage', 'base', 'oog', 'BRL', false),
        (${BL_FEE}, ${T_CTR}, 'Taxa de B/L', 'bl', 300, 300, NULL, 'bl', 'base', 'any', 'BRL', false),
        (${SCANNER}, ${T_CTR}, 'Scanner', 'container', 0, NULL, 50, 'container_distinct_voyage', 'base', 'any', 'USD', false),
        (${ARMAZ}, ${T_CTR}, 'Armazenagem', 'bl', 500, 500, NULL, 'bl', 'other_charge', 'any', 'BRL', true),
        (${THD_B}, ${T_CTR_B}, 'THD', 'container', 1500, 1500, NULL, 'container_distinct_voyage', 'base', 'standard', 'BRL', false),
        (${BL_FEE_B}, ${T_CTR_B}, 'Taxa de B/L', 'bl', 350, 350, NULL, 'bl', 'base', 'any', 'BRL', false),
        (${WHARF}, ${T_BB}, 'Capatazia carga solta', 'bl', 10, 10, NULL, 'weight_ton', 'base', 'any', 'BRL', false);
      INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status)
      VALUES ${[BL.main, BL.unit, BL.share1, BL.share2, BL.dual, BL.usd, BL.manual, BL.cancel, BL.refix, BL.last, BL.perm].map(containerBl).join(', ')};
      INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status, bb_weight_ton)
      VALUES (${q(BL.misto)}, ${VOYAGE}, ${CUSTOMER}, ${q(POD)}, 'misto', 'pending', 'not_calculated', 'reconciled', 20);
      INSERT INTO public.bl_containers (bl_id, container_number, type, is_imo, is_oog) VALUES
        (${q(BL.main)}, 'RTAU4910001', '22G1', false, false), (${q(BL.main)}, 'RTAU4910002', '22G1', false, false),
        (${q(BL.unit)}, 'RTAU4910003', '22G1', false, false), (${q(BL.unit)}, 'RTAU4910004', '22G1', false, false),
        (${q(BL.share1)}, 'RTAU4910005', '22G1', false, false), (${q(BL.share2)}, 'RTAU4910005', '22G1', false, false),
        (${q(BL.dual)}, 'RTAU4910006', '22G1', true, true), (${q(BL.dual)}, 'RTAU4910007', '22G1', false, false),
        (${q(BL.misto)}, 'RTAU4910008', '22G1', false, false),
        (${q(BL.usd)}, 'RTAU4910009', '22G1', false, false),
        (${q(BL.manual)}, 'RTAU4910010', '22G1', false, false),
        (${q(BL.cancel)}, 'RTAU4910011', '22G1', false, false),
        (${q(BL.refix)}, 'RTAU4910012', '22G1', false, false),
        (${q(BL.last)}, 'RTAU4910013', '22G1', false, false),
        (${q(BL.perm)}, 'RTAU4910014', '22G1', false, false);
    `)
    for (const id of ALL_BLS) calculate(id)
  })

  afterAll(cleanup)

  describe('permissão e recusas no banco', () => {
    it('todos os setores alteram, excluem e voltam ao valor da tabela', () => {
      const keys = [thd, blFee]
      for (const [index, user] of [USERS.adm, USERS.fin, USERS.ope, USERS.doc, USERS.equ].entries()) {
        const run = alter(user, BL.perm, keys[index % 2], 'unit', 100 + index)
        expect(run.status, run.stderr).toBe(0)
      }
      expect(restore(USERS.equ, BL.perm, thd).status).toBe(0)
      expect(exclude(USERS.doc, BL.perm, blFee).status).toBe(0)
      expect(restore(USERS.fin, BL.perm, blFee).status).toBe(0)
    })

    it('recusa usuário desativado, usuário do Portal e autor diferente de quem está logado', () => {
      expect(alter(USERS.inactive, BL.perm, thd, 'unit', 900).stderr).toMatch(/Somente usuário interno ativo altera as taxas do B\/L/)
      expect(alter(USERS.portal, BL.perm, thd, 'unit', 900).stderr).toMatch(/Somente usuário interno ativo/)
      const other = as(USERS.ope, `SELECT public.alter_bl_charge_value(${q(BL.perm)}, ${q(thd)}, 'unit', 900, ${q(JUST)}, '${USERS.adm}'::uuid)`)
      expect(other.stderr).toMatch(/Autor informado difere/)
    })

    it('recusa justificativa curta, valor zero, taxa fora do cálculo e escrita direta', () => {
      expect(alter(USERS.ope, BL.perm, thd, 'unit', 900, 'curta').stderr).toMatch(/Justificativa obrigatória: escreva ao menos 10 caracteres/)
      expect(alter(USERS.ope, BL.perm, thd, 'unit', 0).stderr).toMatch(/Informe um valor maior que zero. Para não cobrar a taxa, use Excluir taxa/)
      expect(alter(USERS.ope, BL.perm, 'auto:item:1', 'unit', 10).stderr).toMatch(/Esta taxa não está mais no cálculo do B\/L; atualize a página/)
      const direct = as(USERS.adm, `INSERT INTO public.bl_charge_adjustments (bl_id, line_key, source, charge_name, currency, kind, value, justification)
        VALUES (${q(BL.perm)}, ${q(thd)}, 'auto', 'THD', 'BRL', 'unit', 1, ${q(JUST)})`)
      expect(direct.stderr).toMatch(/permission denied/)
    })

    it('recusa o valor igual ao atual', () => {
      expect(alter(USERS.ope, BL.perm, blFee, 'unit', 300).stderr).toMatch(/O valor é igual ao atual: nada a alterar/)
    })
  })

  describe('alterar, excluir e desfazer', () => {
    it('sem alteração, as linhas são as da tabela (mesmo resultado do resolvedor de antes)', () => {
      expect(psql(`SELECT count(*) FROM (
        SELECT * FROM public.resolve_bl_local_charge_items(${q(BL.main)}, ${q(POD)})
        EXCEPT SELECT * FROM public._resolve_bl_local_charge_items_table(${q(BL.main)}, ${q(POD)})) d`)).toBe('0')
      expect(lines(BL.main)).toBe(`${thd}|calculated|2.00|1420.00|2840.00,${blFee}|calculated|1.00|300.00|300.00,auto:item:${SCANNER}|calculated|2.00|50.00|100.00`)
    })

    it('por unidade: total = quantidade × valor; o valor da tabela fica ao lado', () => {
      const run = alter(USERS.ope, BL.unit, thd, 'unit', 1200)
      expect(run.status, run.stderr).toBe(0)
      expect(run.json).toMatchObject({ kind: 'unit', applied: true })
      expect(line(BL.unit, thd)).toBe('calculated|2.00|1200.00|2400.00|2840.00|true')
      expect(psql(`SELECT charge_status FROM public.bls WHERE id = ${q(BL.unit)}`)).toBe('calculated')
    })

    it('a alteração por unidade se mantém no Recalcular e acompanha um container novo (3 × R$ 1.200)', () => {
      calculate(BL.unit)
      expect(line(BL.unit, thd)).toBe('calculated|2.00|1200.00|2400.00|2840.00|true')
      psql(`INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES (${q(BL.unit)}, 'RTAU4910099', '22G1')`)
      calculate(BL.unit)
      expect(line(BL.unit, thd)).toBe('calculated|3.00|1200.00|3600.00|4260.00|true')
    })

    it('pelo total: o total digitado vale e o Unitário é total ÷ quantidade', () => {
      expect(alter(USERS.fin, BL.main, thd, 'total', 2000).status).toBe(0)
      expect(line(BL.main, thd)).toBe('calculated|2.00|1000.00|2000.00|2840.00|true')
    })

    it('D7: o total alterado se mantém com quantidade nova, com evento no histórico', () => {
      psql(`INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES (${q(BL.main)}, 'RTAU4910098', '22G1')`)
      calculate(BL.main)
      expect(line(BL.main, thd)).toBe('calculated|3.00|666.67|2000.00|4260.00|true')
      const event = psql(`SELECT before->>'quantity' || '>' || (after->>'quantity')::numeric(12,0) || '|' || (after->>'total')
        FROM public.bl_charge_adjustment_events WHERE bl_id = ${q(BL.main)} AND event = 'quantity_changed'`)
      expect(event).toBe('2.000000>3|2000.00')
    })

    it('troca de Cliente mantém a alteração; a Condição do Cliente novo vale só nas taxas não alteradas', () => {
      psql(`INSERT INTO public.customer_rate_overrides (customer_id, charge_item_id, override_value, valid_from, active) VALUES
        (${CUSTOMER_B}, ${THD}, 1100, CURRENT_DATE - 90, true), (${CUSTOMER_B}, ${BL_FEE}, 250, CURRENT_DATE - 90, true)`)
      psql(`UPDATE public.bls SET customer_id = ${CUSTOMER_B} WHERE id = ${q(BL.main)}`)
      // O preço fixo do primeiro cálculo (ADR 0094) é refeito para olhar a Condição nova.
      psql(`DELETE FROM public.bl_price_freeze_items WHERE bl_id = ${q(BL.main)}; DELETE FROM public.bl_price_freezes WHERE bl_id = ${q(BL.main)}`)
      calculate(BL.main)
      expect(line(BL.main, thd)).toBe('calculated|3.00|666.67|2000.00|3300.00|true')
      expect(line(BL.main, blFee)).toBe('calculated|1.00|250.00|250.00|250.00|false')
    })

    it('exclui a taxa: linha fica com situação excluded e total zero, fora da cobrança', () => {
      const before = psql(`SELECT sum(coalesce(total_value_brl, 0)) FROM public.charge_calculations WHERE bl_id = ${q(BL.main)}`)
      expect(exclude(USERS.equ, BL.main, blFee).status).toBe(0)
      expect(line(BL.main, blFee)).toBe('excluded|1.00|250.00|0.00|250.00|true')
      const after = psql(`SELECT sum(coalesce(total_value_brl, 0)) FROM public.charge_calculations WHERE bl_id = ${q(BL.main)}`)
      expect(Number(before) - Number(after)).toBe(250)
      calculate(BL.main)
      expect(line(BL.main, blFee)).toBe('excluded|1.00|250.00|0.00|250.00|true')
      expect(alter(USERS.ope, BL.main, blFee, 'unit', 100).stderr).toMatch(/Taxa excluída: use Incluir taxa de novo/)
    })

    it('incluir de novo e voltar ao valor da tabela', () => {
      expect(restore(USERS.doc, BL.main, blFee).json).toMatchObject({ event: 'reincluded' })
      expect(line(BL.main, blFee)).toBe('calculated|1.00|250.00|250.00|250.00|false')
      expect(restore(USERS.doc, BL.main, thd).json).toMatchObject({ event: 'restored' })
      expect(line(BL.main, thd)).toBe('calculated|3.00|1100.00|3300.00|3300.00|false')
      expect(restore(USERS.doc, BL.main, thd).stderr).toMatch(/Esta taxa não tem alteração à mão para desfazer/)
    })

    it('recusa excluir a última taxa cobrada', () => {
      expect(exclude(USERS.ope, BL.last, thd).status).toBe(0)
      expect(exclude(USERS.ope, BL.last, `auto:item:${SCANNER}`).status).toBe(0)
      expect(exclude(USERS.ope, BL.last, blFee).stderr).toMatch(/Esta é a última taxa cobrada do B\/L. Para não cobrar nada, use Isentar Taxas Locais/)
    })

    it('a linha THD IMO e OOG se altera sozinha; o THD Padrão não muda', () => {
      expect(alter(USERS.ope, BL.dual, `${thd}:imo_oog`, 'unit', 3000).status).toBe(0)
      expect(line(BL.dual, `${thd}:imo_oog`)).toBe('calculated|1.00|3000.00|3000.00|3550.00|true')
      expect(line(BL.dual, thd)).toBe('calculated|1.00|1420.00|1420.00|1420.00|false')
    })

    it('container compartilhado: a alteração vale só para a parte deste B/L', () => {
      expect(alter(USERS.ope, BL.share1, thd, 'unit', 1000).status).toBe(0)
      expect(line(BL.share1, thd)).toBe('calculated|0.50|1000.00|500.00|710.00|true')
      calculate(BL.share2)
      expect(line(BL.share2, thd)).toBe('calculated|0.50|1420.00|710.00|710.00|false')
    })

    it('taxa em dólar se altera em US$', () => {
      expect(alter(USERS.fin, BL.usd, `auto:item:${SCANNER}`, 'unit', 40).status).toBe(0)
      expect(psql(`SELECT concat_ws('|', unit_value_brl, unit_value_usd, total_value_brl, total_value_usd, table_total_value_usd)
        FROM public.charge_calculations WHERE bl_id = ${q(BL.usd)} AND calculation_key = 'auto:item:${SCANNER}'`)).toBe('40.00|40.00|50.00')
    })

    it('item desativado deixa a alteração dormente; reativado, ela volta', () => {
      expect(alter(USERS.ope, BL.usd, thd, 'unit', 999).status).toBe(0)
      psql(`UPDATE public.charge_table_items SET active = false WHERE id = ${THD}`)
      calculate(BL.usd)
      expect(line(BL.usd, thd)).toBe('')
      expect(psql(`SELECT count(*) FROM public.bl_charge_adjustments WHERE bl_id = ${q(BL.usd)} AND line_key = ${q(thd)} AND ended_at IS NULL`)).toBe('1')
      psql(`UPDATE public.charge_table_items SET active = true WHERE id = ${THD}`)
      calculate(BL.usd)
      expect(line(BL.usd, thd)).toBe('calculated|1.00|999.00|999.00|1420.00|true')
    })
  })

  describe('troca de tabela (D5, R1, R2)', () => {
    it('troca de POD descarta a alteração, com o motivo no histórico', () => {
      expect(alter(USERS.ope, BL.unit, blFee, 'unit', 280).status).toBe(0)
      psql(`UPDATE public.bls SET pod = ${q(POD_B)} WHERE id = ${q(BL.unit)}`)
      calculate(BL.unit)
      expect(line(BL.unit, `auto:item:${THD_B}`)).toBe('calculated|3.00|1500.00|4500.00|4500.00|false')
      expect(psql(`SELECT count(*) FROM public.bl_charge_adjustments WHERE bl_id = ${q(BL.unit)} AND ended_at IS NULL`)).toBe('0')
      expect(psql(`SELECT string_agg(after->>'reason' || ':' || (after->>'table_name') || ':' || (after->>'pod'), ',' ORDER BY id)
        FROM public.bl_charge_adjustment_events WHERE bl_id = ${q(BL.unit)} AND event = 'discarded'`))
        .toBe(`pod:Tabela 491 B:${POD_B},pod:Tabela 491 B:${POD_B}`)
    })

    it('R1: o B/L misto que perde a carga solta perde só as alterações da tabela de carga solta', () => {
      expect(alter(USERS.ope, BL.misto, thd, 'unit', 1300).status).toBe(0)
      expect(alter(USERS.ope, BL.misto, `auto:item:${WHARF}`, 'unit', 8).status).toBe(0)
      psql(`UPDATE public.bls SET cargo_mode = 'container', bb_weight_ton = NULL WHERE id = ${q(BL.misto)}`)
      calculate(BL.misto)
      expect(line(BL.misto, thd)).toBe('calculated|1.00|1300.00|1300.00|1420.00|true')
      expect(psql(`SELECT event || ':' || (after->>'reason') FROM public.bl_charge_adjustment_events
        WHERE bl_id = ${q(BL.misto)} AND event = 'discarded'`)).toBe('discarded:modalidade')
    })

    it('R2: refixar com tabela nova do mesmo escopo passa a alteração para a mesma taxa; sem ela, descarta', () => {
      expect(alter(USERS.ope, BL.refix, thd, 'unit', 1250).status).toBe(0)
      expect(alter(USERS.ope, BL.refix, `auto:item:${SCANNER}`, 'unit', 45).status).toBe(0)
      psql(`INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
              VALUES (${T_CTR_NEW}, 'Tabela 491 A 2027', '${POD}', CURRENT_DATE, true, 'container');
            INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency) VALUES
              (${THD_NEW}, ${T_CTR_NEW}, 'THD', 'container', 1600, 1600, 'container_distinct_voyage', 'base', 'standard', 'BRL'),
              (${BL_FEE_NEW}, ${T_CTR_NEW}, 'Taxa de B/L', 'bl', 320, 320, 'bl', 'base', 'any', 'BRL')`)
      psql(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false); SELECT public.refix_bl_local_charge_prices(ARRAY[${q(BL.refix)}], 'aceite da reimportação 491')`)
      expect(line(BL.refix, `auto:item:${THD_NEW}`)).toBe('calculated|1.00|1250.00|1250.00|1600.00|true')
      expect(line(BL.refix, `auto:item:${BL_FEE_NEW}`)).toBe('calculated|1.00|320.00|320.00|320.00|false')
      expect(events(BL.refix)).toBe('altered,altered,remapped,discarded')
      psql(`UPDATE public.charge_tables SET active = false WHERE id = ${T_CTR_NEW}`)
    })
  })

  describe('cobrança manual, cancelamento e histórico', () => {
    let manualId = 0
    let manualKey = ''

    it('cobrança manual se altera e se exclui por setor que não é o Administrativo', () => {
      const added = ok(USERS.ope, `SELECT public.add_manual_bl_charge(${q(BL.manual)}, ${ARMAZ}, 2, NULL, '${USERS.ope}'::uuid)`)
      manualId = Number(added.id)
      manualKey = psql(`SELECT calculation_key FROM public.charge_calculations WHERE id = ${manualId}`)
      expect(alter(USERS.ope, BL.manual, manualKey, 'total', 800).status).toBe(0)
      expect(line(BL.manual, manualKey)).toBe('reviewed|2.00|400.00|800.00|1000.00|true')
      // Editar a quantidade mantém o total alterado (D7).
      ok(USERS.ope, `SELECT public.update_manual_bl_charge(${manualId}, 4, 'quatro volumes', '${USERS.ope}'::uuid)`)
      expect(line(BL.manual, manualKey)).toBe('reviewed|4.00|200.00|800.00|2000.00|true')
      calculate(BL.manual)
      expect(line(BL.manual, manualKey)).toBe('reviewed|4.00|200.00|800.00|2000.00|true')
      expect(restore(USERS.ope, BL.manual, manualKey).status).toBe(0)
      expect(line(BL.manual, manualKey)).toBe('reviewed|4.00|500.00|2000.00|2000.00|false')
      const removed = as(USERS.doc, `SELECT public.delete_manual_bl_charge(${manualId}, ${q(JUST)}, '${USERS.doc}'::uuid)`)
      expect(removed.status, removed.stderr).toBe(0)
      expect(line(BL.manual, manualKey)).toBe('')
    })

    it('a assinatura antiga da exclusão de cobrança manual saiu da API', () => {
      expect(psql(`SELECT has_function_privilege('authenticated', 'public.delete_manual_bl_charge(bigint,uuid)', 'EXECUTE')`)).toBe('f')
      expect(as(USERS.doc, `SELECT public.delete_manual_bl_charge(1, 'curta', '${USERS.doc}'::uuid)`).stderr)
        .toMatch(/Esta taxa não está mais no cálculo do B\/L|Justificativa obrigatória/)
    })

    it('Histórico das taxas lista as ações com autor, frase e justificativa; a aba Histórico também', () => {
      expect(events(BL.manual)).toBe('altered,quantity_changed,restored,manual_deleted')
      const history = ok(USERS.equ, `SELECT json_build_object('rows', json_agg(json_build_object('event', h.event,
        'actor_name', h.actor_name, 'justification', h.justification) ORDER BY h.id)) FROM public.list_bl_charge_history(${q(BL.manual)}) h`)
      const rows = history.rows as Array<Record<string, string | null>>
      expect(rows).toHaveLength(4)
      expect(rows[0]).toMatchObject({ event: 'altered', actor_name: 'Operações 491', justification: JUST })
      expect(rows[1]).toMatchObject({ event: 'quantity_changed' })
      expect(rows[3]).toMatchObject({ event: 'manual_deleted', actor_name: 'Documentação 491' })
      const timeline = spawnPsql(['-X', '-At', '-q', '-d', databaseUrl, '-c', `
        BEGIN;
        SELECT set_config('request.jwt.claims', '{"sub":"${USERS.equ}","role":"authenticated"}', true);
        SET LOCAL ROLE authenticated;
        SELECT string_agg(family || ':' || field_name, ',') FROM public.bl_timeline(${q(BL.manual)}, 100, 0) WHERE field_name = 'charge_adjustment';
        COMMIT;`], { encoding: 'utf8' })
      expect(timeline.stdout.trim().split('\n').pop()).toBe(Array(4).fill('taxas:charge_adjustment').join(','))
    })

    it('B/L cancelado não se altera; reativado, a alteração das taxas calculadas volta', () => {
      expect(alter(USERS.ope, BL.cancel, thd, 'unit', 1111).status).toBe(0)
      ok(USERS.adm, `SELECT public.cancel_bl(${q(BL.cancel)}, 'não embarcou 491', false)`)
      expect(alter(USERS.ope, BL.cancel, thd, 'unit', 1000).stderr).toMatch(/cancelado e somente leitura; reative o B\/L para alterar as taxas/)
      ok(USERS.adm, `SELECT public.reactivate_bl(${q(BL.cancel)}, 'cancelado por engano 491')`)
      calculate(BL.cancel)
      expect(line(BL.cancel, thd)).toBe('calculated|1.00|1111.00|1111.00|1420.00|true')
    })

    it('B/L faturado ainda é recusado neste lote', () => {
      psql(`SET session_replication_role = replica; UPDATE public.bls SET financial_status = 'invoiced' WHERE id = ${q(BL.perm)}`)
      expect(alter(USERS.ope, BL.perm, thd, 'unit', 900).stderr).toMatch(/B\/L faturado/)
      psql(`UPDATE public.bls SET financial_status = 'pending' WHERE id = ${q(BL.perm)}`)
    })
  })
})
