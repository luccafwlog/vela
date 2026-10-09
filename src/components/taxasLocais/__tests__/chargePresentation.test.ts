import { describe, expect, it } from 'vitest'
import { resolveChargeTableStates } from '../../../pages/taxasLocaisHelpers'
import {
  basisUnit,
  conditionEffectNotes,
  conditionPeriodLabel,
  describeDifference,
  formatPeriod,
  groupTablesByScope,
  itemDisplayName,
  itemEngineNotes,
  previewTableState,
  readTable,
  type ChargeTable,
} from '../chargePresentation'

const table = (id: number, over: Partial<ChargeTable> = {}): ChargeTable => ({
  id,
  name: `Tabela ${id}`,
  cargo_mode: 'container',
  pod: 'BRVIT',
  valid_from: '2026-01-01',
  valid_to: null,
  active: true,
  notes: null,
  charge_table_items: [],
  ...over,
})

const autoItem = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'ISPS',
  category: 'base',
  application_basis: 'container_distinct_voyage',
  cargo_profile: 'any',
  currency: 'BRL',
  unit_value_brl: 115,
  unit_value_usd: null,
  manual_only: false,
  applies_to_soc: true,
  active: true,
  sort_order: 10,
  ...over,
})

describe('itemEngineNotes (migration 129)', () => {
  it('THD por container com perfil "Todos" vai para revisão', () => {
    expect(itemEngineNotes(autoItem({ name: 'THD', cargo_profile: 'any' }))[0]).toMatchObject({ tone: 'danger' })
  })

  it('THD Padrão também é a base do container IMO e OOG', () => {
    expect(itemEngineNotes(autoItem({ name: 'thd 40', cargo_profile: 'standard' }))).toEqual([
      expect.objectContaining({ tone: 'info', text: expect.stringContaining('× 2,5') }),
    ])
  })

  it('perfil num item que não é THD não separa containers', () => {
    expect(itemEngineNotes(autoItem({ name: 'Logística OOG', cargo_profile: 'oog' }))[0]).toMatchObject({ tone: 'warning' })
  })

  it('THD por tonelada e item manual não recebem nota de perfil; TEU automático vai para revisão', () => {
    expect(itemEngineNotes(autoItem({ name: 'THD', application_basis: 'weight_ton', cargo_profile: 'any' }))).toEqual([])
    expect(itemEngineNotes(autoItem({ name: 'Booking', application_basis: 'teu', manual_only: true }))).toEqual([])
    expect(itemEngineNotes(autoItem({ name: 'Booking', application_basis: 'teu' }))[0]).toMatchObject({ tone: 'danger' })
  })
})

describe('leitura da tabela', () => {
  const today = '2026-10-09'

  it('tabela aplicada sem item automático avisa que o escopo não gera taxa', () => {
    const tables = [table(1, { charge_table_items: [autoItem({ manual_only: true })] as ChargeTable['charge_table_items'] })]
    const states = resolveChargeTableStates(tables)
    const reading = readTable(tables[0], states, new Map(tables.map((t) => [t.id, t])), today)
    expect(reading).toMatchObject({ stateLabel: 'Aplicada no cálculo', noAutomaticItems: true, manualItems: 1, hasWarning: true })
  })

  it('vigência vencida em tabela ativa é aviso, não exclusão (ADR 0040)', () => {
    const tables = [table(1, { valid_from: '2025-01-01', valid_to: '2025-12-31', charge_table_items: [autoItem()] as ChargeTable['charge_table_items'] })]
    const states = resolveChargeTableStates(tables)
    const reading = readTable(tables[0], states, new Map(tables.map((t) => [t.id, t])), today)
    expect(reading.stateLabel).toBe('Aplicada no cálculo')
    expect(reading.validityNote).toContain('continua no cálculo')
  })

  it('agrupa por escopo com a aplicada primeiro', () => {
    const tables = [table(1, { valid_from: '2025-01-01' }), table(2, { pod: 'Vitoria' }), table(3, { cargo_mode: 'carga_solta', pod: 'BRSSA' }), table(4, { active: false, valid_from: '2027-01-01' })]
    const groups = groupTablesByScope(tables, resolveChargeTableStates(tables))
    expect(groups.map((group) => group.label)).toEqual(['Container · BRVIX', 'Carga solta · BRSSA'])
    expect(groups[0].tables.map((t) => t.id)).toEqual([2, 1, 4])
    expect(groups[0].applied?.id).toBe(2)
  })
})

describe('aviso de vigência', () => {
  it('não diz "continua no cálculo" numa tabela que não é a aplicada', () => {
    const old = table(1, { valid_from: '2025-01-01', valid_to: '2025-12-31' })
    const current = table(2, { valid_from: '2026-01-01' })
    const tables = [old, current]
    const states = resolveChargeTableStates(tables)
    const byId = new Map(tables.map((row) => [row.id, row]))
    const reading = readTable(old, states, byId, '2026-10-09')
    expect(reading.stateLabel).toBe('Não aplicada')
    expect(reading.validityNote).toBeNull()
  })
})

describe('itemDisplayName', () => {
  it('mostra o perfil só no THD por container, onde ele separa a cobrança', () => {
    expect(itemDisplayName({ name: 'THD', cargo_profile: 'imo', application_basis: 'container_distinct_voyage' })).toBe('THD · IMO')
    expect(itemDisplayName({ name: 'THD', cargo_profile: 'standard', application_basis: 'container_distinct_voyage' })).toBe('THD · Padrão')
    expect(itemDisplayName({ name: 'THD', cargo_profile: 'any', application_basis: 'weight_ton' })).toBe('THD')
    expect(itemDisplayName({ name: 'ISPS', cargo_profile: 'oog', application_basis: 'container_distinct_voyage' })).toBe('ISPS')
  })
})

describe('previewTableState', () => {
  const tables = [table(1, { name: 'Vitória 2026' })]
  const draft = { id: null, name: 'Nova', cargoMode: 'container', pod: 'brvix', validFrom: '2027-01-01', active: true }

  it('nova tabela ativa mais recente toma o lugar da aplicada', () => {
    expect(previewTableState(draft, tables)?.text).toContain('no lugar de "Vitória 2026"')
  })

  it('mais antiga não é aplicada; inativa fica fora do cálculo', () => {
    expect(previewTableState({ ...draft, validFrom: '2020-01-01' }, tables)).toMatchObject({ tone: 'warning', text: expect.stringContaining('Não será aplicada') })
    expect(previewTableState({ ...draft, active: false }, tables)?.text).toContain('Fica inativa')
  })

  it('editar a própria tabela aplicada não acusa troca', () => {
    expect(previewTableState({ ...draft, id: 1, pod: 'BRVIT' }, tables)?.text).toBe('Será a tabela aplicada em Container · BRVIX.')
  })
})

describe('Condição de Cliente', () => {
  const tables = [table(1, { name: 'Vigente' }), table(2, { name: 'Antiga', valid_from: '2024-01-01' }), table(3, { name: 'Desligada', active: false, pod: 'BRSSA' })]
  const states = resolveChargeTableStates(tables)
  const byId = new Map(tables.map((t) => [t.id, t]))

  it('na tabela aplicada e em reais não tem aviso', () => {
    expect(conditionEffectNotes({ currency: 'BRL', active: true, charge_table: { id: 1, name: 'Vigente' } }, states, byId)).toEqual([])
  })

  it('avisa tabela não aplicada, inativa e item inativo; item em dólar vale como o em reais (migration 171)', () => {
    expect(conditionEffectNotes({ currency: 'BRL', charge_table: { id: 2, name: 'Antiga' } }, states, byId)[0].text).toContain('"Vigente" vence')
    expect(conditionEffectNotes({ currency: 'BRL', charge_table: { id: 3, name: 'Desligada' } }, states, byId)[0].text).toContain('inativa')
    expect(conditionEffectNotes({ currency: 'BRL', active: false, charge_table: { id: 1, name: 'Vigente' } }, states, byId)[0].text).toContain('item está inativo')
    expect(conditionEffectNotes({ currency: 'USD', active: true, charge_table: { id: 1, name: 'Vigente' } }, states, byId)).toEqual([])
  })

  it('situação pela data de hoje', () => {
    const today = '2026-10-09'
    expect(conditionPeriodLabel({ active: true, valid_from: null, valid_to: null }, today)).toBe('Vigente hoje')
    expect(conditionPeriodLabel({ active: true, valid_from: '2026-11-01', valid_to: null }, today)).toBe('Começa em 01/11/2026')
    expect(conditionPeriodLabel({ active: true, valid_from: null, valid_to: '2025-12-31' }, today)).toBe('Encerrada em 31/12/2025')
    expect(conditionPeriodLabel({ active: false, valid_from: null, valid_to: null }, today)).toBe('Desativada')
  })

  it('formata período, unidade e diferença', () => {
    expect(formatPeriod(null, null)).toBe('Sem limite de vigência')
    expect(formatPeriod('2026-01-01', null)).toBe('01/01/2026 – sem data final')
    expect(basisUnit('weight_ton')).toBe('por tonelada')
    expect(describeDifference(100, 80)).toBe('−20% em relação à tabela')
    expect(describeDifference(0, 80)).toBeNull()
  })
})
