// Estado de /relatorios no endereço (lote 5b): a visão escolhida e os filtros.
// Voltar, recarregar ou compartilhar o link reabre a mesma visão e o mesmo
// recorte. Período, Navio / Viagem e Cliente valem para as quatro visões e
// atravessam a troca de aba; o resto é de cada visão e sai na troca.
import {
  defaultDemurragePeriod,
  type CustomerReportFilters,
  type DemurrageReportFilters,
  type FinancialReportFilters,
  type LocalChargesFilter,
  type OperationalReportFilters,
  type ReportScope,
  type ReviewFilter,
  type YesNoFilter,
} from '../services/reports'

export type ReportView = 'operacional' | 'financeiro' | 'por-cliente' | 'demurrage'

export const REPORT_VIEWS: Array<{ value: ReportView; label: string }> = [
  { value: 'operacional', label: 'Operacional' },
  { value: 'financeiro', label: 'Financeiro' },
  { value: 'por-cliente', label: 'Por Cliente' },
  { value: 'demurrage', label: 'Demurrage' },
]

/** Chaves comuns às quatro visões; as demais saem na troca de aba. */
const SCOPE_KEYS = ['de', 'ate', 'viagem', 'cliente', 'clienteNome'] as const

export type ReportParam =
  | (typeof SCOPE_KEYS)[number]
  | 'pol' | 'pod' | 'modalidade' | 'revisao' | 'taxas'
  | 'situacao' | 'consolidada' | 'saldo' | 'disputa' | 'vencidas'

export function reportViewFromSearch(params: URLSearchParams): ReportView {
  const value = params.get('visao')
  return REPORT_VIEWS.some((view) => view.value === value) ? (value as ReportView) : 'operacional'
}

export function withReportView(params: URLSearchParams, view: ReportView): URLSearchParams {
  const next = new URLSearchParams()
  if (view !== 'operacional') next.set('visao', view)
  for (const key of SCOPE_KEYS) {
    const value = params.get(key)
    if (value) next.set(key, value)
  }
  return next
}

/**
 * Troca um filtro preservando os demais. Vazio sai do endereço, menos as datas
 * do Demurrage: ali "de" e "até" vazios querem dizer "sem limite", não o padrão
 * do ano (ver `demurrageFiltersFromSearch`).
 */
export function withReportParam(params: URLSearchParams, key: ReportParam, value: string, keepEmpty = false): URLSearchParams {
  const next = new URLSearchParams(params)
  const text = value.trim()
  if (text || keepEmpty) next.set(key, text)
  else next.delete(key)
  if (key === 'cliente' && !text) next.delete('clienteNome')
  return next
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | '' {
  return allowed.includes(value as T) ? (value as T) : ''
}

// O endereço é digitável e compartilhável: valor fora do formato sai do
// filtro em vez de chegar ao banco (`?de=2026-02-30` era erro do Postgres) ou
// aparecer em "Filtros ativos" e na aba Filtros da planilha sem ter sido aplicado.

/** Data real no calendário, em `AAAA-MM-DD`; qualquer outra coisa vira vazio. */
export function calendarDateParam(value: string | null): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  const [, year, month, day] = match.map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value! : ''
}

/** Id de Navio / Viagem ou Cliente: inteiro positivo, sem sinal, zero à esquerda ou expoente. */
export function positiveIdParam(value: string | null): string {
  return value && /^[1-9]\d{0,14}$/.test(value) ? value : ''
}

// ponytail: só a forma do código de porto (letras e dígitos, como BRVIX); um
// código bem formado que não existe filtra para zero linhas. Upgrade: validar
// contra `usePortOptions`, que só carrega depois da leitura do endereço.
function portParam(value: string | null): string {
  return value && /^[A-Za-z0-9]{2,12}$/.test(value) ? value : ''
}

function scopeFromSearch(params: URLSearchParams): ReportScope {
  return {
    dateFrom: calendarDateParam(params.get('de')),
    dateTo: calendarDateParam(params.get('ate')),
    voyageId: positiveIdParam(params.get('viagem')),
    customerId: positiveIdParam(params.get('cliente')),
  }
}

/** Nome do Cliente escolhido, para reabrir o campo preenchido; sem Cliente válido, nenhum. */
export function customerNameFromSearch(params: URLSearchParams) {
  return positiveIdParam(params.get('cliente')) ? params.get('clienteNome') ?? '' : ''
}

export function operationalFiltersFromSearch(params: URLSearchParams): OperationalReportFilters {
  return {
    ...scopeFromSearch(params),
    pol: portParam(params.get('pol')),
    pod: portParam(params.get('pod')),
    cargoMode: oneOf(params.get('modalidade'), ['container', 'carga_solta', 'misto'] as const),
    review: oneOf<Exclude<ReviewFilter, ''>>(params.get('revisao'), ['pendente', 'em-ordem']),
    localCharges: oneOf<Exclude<LocalChargesFilter, ''>>(params.get('taxas'), ['pendente', 'emitida', 'paga', 'isenta']),
  }
}

export function financialFiltersFromSearch(params: URLSearchParams): FinancialReportFilters {
  return {
    ...scopeFromSearch(params),
    status: oneOf(params.get('situacao'), ['draft', 'issued', 'partially_paid', 'paid', 'cancelled'] as const),
    consolidated: oneOf<Exclude<YesNoFilter, ''>>(params.get('consolidada'), ['sim', 'nao']),
    balance: oneOf(params.get('saldo'), ['aberto', 'zerado'] as const),
  }
}

export function customerFiltersFromSearch(params: URLSearchParams): CustomerReportFilters {
  return scopeFromSearch(params)
}

/** Data escolhida no endereço: válida, ou apagada (vazia). Data inválida conta como não escolhida. */
export function hasDateParam(params: URLSearchParams, key: 'de' | 'ate') {
  const value = params.get(key)
  return value === '' || Boolean(calendarDateParam(value))
}

/**
 * Demurrage abre no ano corrente (calendário de Brasília) enquanto nenhuma
 * data foi escolhida; datas apagadas ficam no endereço vazias e valem "sem limite".
 */
export function demurrageFiltersFromSearch(params: URLSearchParams, now = new Date()): DemurrageReportFilters {
  const scope = scopeFromSearch(params)
  const period = hasDateParam(params, 'de') || hasDateParam(params, 'ate')
    ? { dateFrom: scope.dateFrom, dateTo: scope.dateTo }
    : defaultDemurragePeriod(now)
  return {
    ...scope,
    ...period,
    status: oneOf(params.get('situacao'), ['draft', 'issued', 'paid', 'cancelled'] as const),
    dispute: oneOf<Exclude<YesNoFilter, ''>>(params.get('disputa'), ['sim', 'nao']),
    overdue: oneOf(params.get('vencidas'), ['sim'] as const),
  }
}
