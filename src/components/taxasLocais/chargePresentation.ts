// Leitura das Tabelas de Taxas Locais e das Condições de Cliente para a tela
// /taxas-locais/tabelas. Só traduz o cadastro no que o motor faz com ele; o
// cálculo continua em `resolve_bl_local_charge_items` (migration 171, a partir
// da 129) e a escolha da tabela em `resolve_local_charge_table_id`
// (migration 274).
// Se o motor mudar, as notas abaixo precisam acompanhar.

import { formatBRL, formatDate, formatUSD } from '../../lib/utils'
import {
  chargeTableScopeKey,
  normalizeChargeTablePod,
  resolveChargeTableStates,
  type ChargeTableEngineState,
} from '../../pages/taxasLocaisHelpers'
import type { LocalChargeTableWithItems } from '../../services/charges/chargeTableService'
import type { LocalChargeOverrideItem } from '../../services/charges/chargeRateService'

export type ChargeTable = LocalChargeTableWithItems
export type ChargeItem = LocalChargeTableWithItems['charge_table_items'][number]
export type CargoMode = 'container' | 'carga_solta' | 'granito'

export const CARGO_MODE_OPTIONS: ReadonlyArray<{ value: CargoMode; label: string }> = [
  { value: 'container', label: 'Container' },
  { value: 'carga_solta', label: 'Carga solta' },
  { value: 'granito', label: 'Granito' },
]

export function cargoModeLabel(mode: string | null | undefined) {
  return CARGO_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? 'Container'
}

export function scopeLabel(mode: string | null | undefined, pod: string | null | undefined) {
  const normalized = normalizeChargeTablePod(pod)
  return `${cargoModeLabel(mode)} · ${normalized || 'sem POD'}`
}

/** PODs cadastrados, já na grafia que o motor usa para agrupar. */
export function podOptions(tables: Array<{ pod: string | null }>) {
  return [...new Set(tables.map((table) => normalizeChargeTablePod(table.pod)).filter(Boolean))].sort()
}

/** Base de aplicação: rótulo do campo e a unidade que acompanha o preço. */
export const APPLICATION_BASIS_OPTIONS = [
  {
    value: 'bl',
    label: 'Por B/L',
    unit: 'por B/L',
    hint: 'Uma vez por B/L. No B/L misto, só do lado container.',
  },
  {
    value: 'container_distinct_voyage',
    label: 'Por container',
    unit: 'por container',
    hint: 'Cada container da viagem. Container dividido entre B/Ls é rateado entre eles.',
  },
  {
    value: 'weight_ton',
    label: 'Por tonelada',
    unit: 'por tonelada',
    hint: 'Peso da carga solta. Sem peso informado, o B/L vai para revisão.',
  },
] as const

export function basisUnit(basis: string | null | undefined) {
  if (basis === 'teu') return 'por TEU'
  return APPLICATION_BASIS_OPTIONS.find((option) => option.value === basis)?.unit ?? '—'
}

export const CARGO_PROFILE_OPTIONS = [
  { value: 'any', label: 'Todos' },
  { value: 'standard', label: 'Padrão' },
  { value: 'imo', label: 'IMO' },
  { value: 'oog', label: 'OOG' },
] as const

export function cargoProfileLabel(profile: string | null | undefined) {
  return CARGO_PROFILE_OPTIONS.find((option) => option.value === (profile ?? 'any'))?.label ?? 'Todos'
}

export function currencyPrefix(currency: string | null | undefined) {
  return currency === 'USD' ? 'US$' : 'R$'
}

export function formatRate(currency: string | null | undefined, value: number | string | null | undefined) {
  return currency === 'USD' ? formatUSD(value ?? 0) : formatBRL(value ?? 0)
}

export function itemUnitValue(item: Pick<ChargeItem, 'currency' | 'unit_value_brl' | 'unit_value_usd'>) {
  return Number((item.currency === 'USD' ? item.unit_value_usd : item.unit_value_brl) ?? 0)
}

export function isThdItem(name: string | null | undefined) {
  return String(name ?? '').trim().toUpperCase().startsWith('THD')
}

/**
 * Nome do item com o perfil quando o perfil separa a cobrança (THD por
 * container): "THD · IMO". Sem isso, os três THD da tabela ficam iguais na
 * escolha e na lista de Condições de Cliente.
 */
export function itemDisplayName(item: { name: string | null; cargo_profile?: string | null; application_basis?: string | null }) {
  const name = item.name ?? '—'
  if (!isThdItem(item.name) || item.application_basis !== 'container_distinct_voyage') return name
  if (!item.cargo_profile || item.cargo_profile === 'any') return name
  return `${name} · ${cargoProfileLabel(item.cargo_profile)}`
}

/** `short` é o rótulo curto da coluna Aviso; a frase inteira vai no title e na edição. */
export type ChargeNote = { tone: 'danger' | 'warning' | 'info'; text: string; short?: string }

/**
 * O que o motor faz com o item além do valor (migration 129). Só itens
 * automáticos: o item manual entra pelo lançamento do usuário.
 */
export function itemEngineNotes(item: {
  name: string | null
  application_basis: string | null
  cargo_profile: string | null
  manual_only: boolean | null
}): ChargeNote[] {
  if (item.manual_only) return []
  const notes: ChargeNote[] = []
  const profile = item.cargo_profile ?? 'any'
  const perContainer = item.application_basis === 'container_distinct_voyage'
  if (item.application_basis === 'teu') {
    notes.push({ tone: 'danger', short: 'TEU não calculado', text: 'Base TEU não é calculada: o B/L vai para revisão.' })
  }
  if (perContainer && isThdItem(item.name)) {
    if (profile === 'any') {
      notes.push({ tone: 'danger', short: 'THD sem perfil', text: 'THD com perfil "Todos" não é calculado: o B/L vai para revisão. Use Padrão, IMO ou OOG.' })
    } else if (profile === 'standard') {
      notes.push({ tone: 'info', short: 'Base de IMO e OOG', text: 'Também é a base do container IMO e OOG ao mesmo tempo (THD × 2,5).' })
    }
  } else if (perContainer && profile !== 'any') {
    notes.push({ tone: 'warning', short: 'Perfil não separa', text: 'O perfil não separa este item: o cálculo cobra todos os containers. Só itens THD separam por perfil.' })
  }
  return notes
}

export type ScopeGroup = {
  key: string
  label: string
  cargoMode: string | null
  applied: ChargeTable | null
  tables: ChargeTable[]
}

const MODE_ORDER: Record<string, number> = { container: 0, carga_solta: 1, granito: 2 }

function stateRank(state: ChargeTableEngineState | undefined) {
  if (!state || state.kind === 'inactive') return 2
  return state.kind === 'applied' ? 0 : 1
}

/**
 * Agrupa as tabelas pelo escopo que o motor usa para escolher (modo de carga +
 * POD normalizado). Em cada escopo: a aplicada, as ativas que perdem o
 * desempate e as inativas, cada grupo da vigência inicial mais recente para a
 * mais antiga.
 */
export function groupTablesByScope(
  tables: ChargeTable[],
  states: Map<number, ChargeTableEngineState>,
  /** Todas as tabelas, para achar a em uso de um escopo que a lente escondeu. */
  allTables: ChargeTable[] = tables,
): ScopeGroup[] {
  const groups = new Map<string, ScopeGroup>()
  for (const table of tables) {
    const key = chargeTableScopeKey(table)
    let group = groups.get(key)
    if (!group) {
      group = { key, label: scopeLabel(table.cargo_mode, table.pod), cargoMode: table.cargo_mode, applied: null, tables: [] }
      groups.set(key, group)
    }
    group.tables.push(table)
  }
  for (const table of allTables) {
    const group = groups.get(chargeTableScopeKey(table))
    if (group && states.get(table.id)?.kind === 'applied') group.applied = table
  }
  for (const group of groups.values()) {
    group.tables.sort((a, b) => {
      const byState = stateRank(states.get(a.id)) - stateRank(states.get(b.id))
      if (byState !== 0) return byState
      if (a.valid_from !== b.valid_from) return a.valid_from < b.valid_from ? 1 : -1
      return b.id - a.id
    })
  }
  return [...groups.values()].sort((a, b) => {
    const byMode = (MODE_ORDER[a.cargoMode ?? 'container'] ?? 9) - (MODE_ORDER[b.cargoMode ?? 'container'] ?? 9)
    return byMode !== 0 ? byMode : a.label.localeCompare(b.label, 'pt-BR')
  })
}

export type TableReading = {
  state: ChargeTableEngineState
  /** Frase curta da situação no cálculo. */
  stateLabel: string
  /** Tom do StatusText: âmbar só na ativa que não é usada (pede ação). */
  stateTone: 'default' | 'warning' | 'muted'
  /** Explicação da situação (title da situação na lista). */
  stateDetail: string | null
  validityNote: string | null
  autoItems: number
  manualItems: number
  inactiveItems: number
  itemNotes: number
  /** A tabela aplicada não gera nenhuma taxa automática. */
  noAutomaticItems: boolean
  hasWarning: boolean
  /** Algum item ativo com aviso, numa tabela que não está desativada. */
  hasItemWarning: boolean
}

export function readTable(
  table: ChargeTable,
  states: Map<number, ChargeTableEngineState>,
  tablesById: Map<number, ChargeTable>,
  today: string,
): TableReading {
  const state = states.get(table.id) ?? { kind: 'inactive' as const }
  const activeItems = table.charge_table_items.filter((item) => item.active !== false)
  const autoItems = activeItems.filter((item) => !item.manual_only).length
  const manualItems = activeItems.filter((item) => item.manual_only).length
  const inactiveItems = table.charge_table_items.length - activeItems.length
  const itemNotes = activeItems.filter((item) => itemEngineNotes(item).some((note) => note.tone !== 'info')).length

  let stateLabel = 'Desativada'
  let stateTone: TableReading['stateTone'] = 'muted'
  let stateDetail: string | null = 'Fora do cálculo: fica guardada para consulta e pode ser reativada pelo Administrativo.'
  if (state.kind === 'applied') {
    stateLabel = 'Em uso no cálculo'
    stateTone = 'default'
    stateDetail = 'É a tabela que o sistema usa para calcular os B/Ls deste escopo.'
  } else if (state.kind === 'shadowed') {
    const winner = tablesById.get(state.winnerId)
    stateLabel = 'Ativa, mas não usada'
    stateTone = 'warning'
    stateDetail = `Está ligada, mas "${winner?.name ?? 'outra tabela'}" começou depois e é a usada; os valores desta não entram em nenhum cálculo. Desative uma das duas.`
  }

  // Só a tabela em uso está no cálculo; numa "Ativa, mas não usada" o aviso de
  // vigência contradiria o estado.
  let validityNote: string | null = null
  if (state.kind !== 'applied') {
    validityNote = null
  } else if (table.valid_to && table.valid_to < today) {
    validityNote = `Vigência encerrada em ${formatDate(table.valid_to)}, mas continua no cálculo enquanto estiver ativa.`
  } else if (table.valid_from > today) {
    validityNote = `Vigência começa em ${formatDate(table.valid_from)}, mas já está no cálculo por estar ativa.`
  }

  const noAutomaticItems = state.kind === 'applied' && autoItems === 0
  return {
    state,
    stateLabel,
    stateTone,
    stateDetail,
    validityNote,
    autoItems,
    manualItems,
    inactiveItems,
    itemNotes,
    noAutomaticItems,
    // Tabela inativa não entra no cálculo: aviso de item nela não é urgente.
    // "Ativa, mas não usada" tem cartão próprio e fica fora do aviso.
    hasWarning: Boolean(validityNote) || noAutomaticItems || (state.kind !== 'inactive' && itemNotes > 0),
    hasItemWarning: state.kind !== 'inactive' && itemNotes > 0,
  }
}

export function formatPeriod(from: string | null | undefined, to: string | null | undefined) {
  if (!from && !to) return 'Sem limite de vigência'
  if (!to) return `${formatDate(from)} – sem data final`
  if (!from) return `Até ${formatDate(to)}`
  return `${formatDate(from)} – ${formatDate(to)}`
}

/**
 * Prévia da situação no cálculo de uma tabela em edição: o que acontece no
 * escopo dela se for gravada como está.
 */
export function previewTableState(
  draft: { id: number | null; name: string; cargoMode: string; pod: string; validFrom: string; active: boolean },
  tables: ChargeTable[],
): ChargeNote | null {
  if (!draft.pod.trim() || !draft.validFrom) return null
  const draftId = draft.id ?? -1
  const draftRow = {
    id: draftId,
    cargo_mode: draft.cargoMode as CargoMode,
    pod: draft.pod,
    valid_from: draft.validFrom,
    valid_to: null,
    active: draft.active,
  }
  const rows = [...tables.filter((table) => table.id !== draftId), draftRow]
  const states = resolveChargeTableStates(rows)
  const scope = scopeLabel(draft.cargoMode, draft.pod)
  const state = states.get(draftId)
  if (!state || state.kind === 'inactive') {
    return { tone: 'info', text: `Fica desativada: não entra no cálculo de ${scope}.` }
  }
  if (state.kind === 'shadowed') {
    const winner = tables.find((table) => table.id === state.winnerId)
    return {
      tone: 'warning',
      text: `Fica ativa, mas não usada: "${winner?.name ?? 'outra tabela'}" é ativa em ${scope} com vigência inicial mais recente e é a usada.`,
    }
  }
  const replaced = tables.find((table) => {
    if (table.id === draftId) return false
    const before = resolveChargeTableStates(tables).get(table.id)
    return before?.kind === 'applied' && chargeTableScopeKey(table) === chargeTableScopeKey(draftRow)
  })
  return replaced
    ? { tone: 'warning', text: `Passa a ser a tabela em uso no cálculo de ${scope}, no lugar de "${replaced.name}". Cálculos novos usam os itens desta tabela.` }
    : { tone: 'info', text: `Será a tabela em uso no cálculo de ${scope}.` }
}

// Condição de Cliente ------------------------------------------------------

export type ConditionPeriod = 'current' | 'future' | 'ended' | 'disabled'

export function conditionPeriod(
  row: Pick<LocalChargeOverrideItem, 'active' | 'valid_from' | 'valid_to'>,
  today: string,
): ConditionPeriod {
  if (row.active === false) return 'disabled'
  if (row.valid_to && row.valid_to < today) return 'ended'
  if (row.valid_from && row.valid_from > today) return 'future'
  return 'current'
}

export function conditionPeriodLabel(
  row: Pick<LocalChargeOverrideItem, 'active' | 'valid_from' | 'valid_to'>,
  today: string,
) {
  const period = conditionPeriod(row, today)
  if (period === 'disabled') return 'Desativada'
  if (period === 'ended') return 'Encerrada'
  if (period === 'future') return `Começa em ${formatDate(row.valid_from)}`
  return 'Vigente'
}

/**
 * Por que uma condição cadastrada não muda a cobrança. O motor só olha a
 * condição de item ativo da tabela aplicada e usa o valor dela na moeda do
 * item (migration 171; até a 129, item em dólar saía pelo valor da tabela).
 */
export function conditionEffectNotes(
  item: {
    currency: string | null
    active?: boolean | null
    charge_table: { id: number; name: string } | null
  } | null,
  states: Map<number, ChargeTableEngineState>,
  tablesById: Map<number, ChargeTable>,
): ChargeNote[] {
  if (!item) return [{ tone: 'danger', text: 'Item de taxa não encontrado.' }]
  const notes: ChargeNote[] = []
  const tableId = item.charge_table?.id
  const state = tableId != null ? states.get(tableId) : undefined
  if (state?.kind === 'inactive') {
    notes.push({ tone: 'warning', text: `A tabela "${item.charge_table?.name}" está desativada: a condição não entra no cálculo.` })
  } else if (state?.kind === 'shadowed') {
    const winner = tablesById.get(state.winnerId)
    notes.push({
      tone: 'warning',
      text: `A tabela "${item.charge_table?.name}" está ativa, mas não usada ("${winner?.name ?? 'outra tabela'}" está em uso no cálculo): a condição não entra no cálculo.`,
    })
  }
  if (item.active === false) {
    notes.push({ tone: 'warning', text: 'O item está inativo: a condição não entra no cálculo.' })
  }
  return notes
}

export function describeDifference(base: number, negotiated: number) {
  if (!Number.isFinite(base) || !Number.isFinite(negotiated) || base <= 0) return null
  const ratio = (negotiated - base) / base
  if (Math.abs(ratio) < 0.0005) return 'Igual ao valor da tabela'
  const percent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(Math.abs(ratio) * 100)
  return `${ratio < 0 ? '−' : '+'}${percent}% em relação à tabela`
}

/** Diferença curta para a coluna "Valor da tabela": "−12%", "+5,5%" ou null. */
export function shortDifference(base: number, negotiated: number) {
  const text = describeDifference(base, negotiated)
  if (!text) return null
  return text === 'Igual ao valor da tabela' ? 'igual' : text.replace(' em relação à tabela', '')
}
