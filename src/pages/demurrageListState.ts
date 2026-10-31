// Estado de /demurrage na URL: aba, busca, divisão da aba Containers, Invoice
// aberta e Disputa em foco. Links de outras telas (ficha do B/L, ficha do
// Cliente, Alertas) abrem a Invoice por `?fatura=` e a Disputa por `?dispute=`.

export type DemurrageTab = 'containers' | 'emitidas' | 'pagas' | 'canceladas' | 'clientes' | 'disputas'
import { DEMURRAGE_DIVISIONS, type DemurrageDivision } from '../services/demurrage/demurrageDivisions'

export type { DemurrageDivision }

const TAB_PARAM: Record<DemurrageTab, string> = {
  containers: 'containers',
  emitidas: 'faturas',
  pagas: 'pagas',
  canceladas: 'canceladas',
  clientes: 'clientes',
  disputas: 'disputas',
}

const TAB_BY_PARAM = new Map(Object.entries(TAB_PARAM).map(([tab, param]) => [param, tab as DemurrageTab]))

export type DemurrageListState = {
  tab: DemurrageTab
  search: string
  /** Divisão da aba Containers (ADR 0112, D1); `?divisao=`. */
  division: DemurrageDivision
  invoiceId: number | null
  disputeId: number | null
}

function positiveId(value: string | null): number | null {
  const id = Number(value ?? '')
  return Number.isInteger(id) && id > 0 ? id : null
}

export function demurrageStateFromSearch(params: URLSearchParams): DemurrageListState {
  const disputeId = positiveId(params.get('dispute'))
  const requested = TAB_BY_PARAM.get(params.get('tab') ?? '')
  const division = params.get('divisao')
  return {
    // O alerta de Disputa aberta no Portal manda só `?dispute=`.
    tab: requested ?? (disputeId ? 'disputas' : 'containers'),
    search: params.get('busca') ?? '',
    // O link antigo `?lente=atraso` (cabeçalho, ficha do Cliente) abre Correndo.
    division: (DEMURRAGE_DIVISIONS as readonly string[]).includes(division ?? '') ? division as DemurrageDivision : 'correndo',
    invoiceId: positiveId(params.get('fatura')),
    disputeId,
  }
}

/** Troca uma chave preservando as demais; o valor padrão sai da URL. */
export function withDemurrageParam(
  params: URLSearchParams,
  key: 'tab' | 'busca' | 'divisao' | 'fatura' | 'dispute',
  value: string | number | null,
): URLSearchParams {
  const next = new URLSearchParams(params)
  const raw = value == null ? '' : String(value)
  // A busca é o que a pessoa está digitando: tirar o espaço aqui comeria o
  // espaço entre "ACME" e "LTDA" a cada tecla. Quem filtra é que faz o trim.
  const text = key === 'busca' ? raw : raw.trim()
  const isDefault = !text.trim() || (key === 'tab' && text === 'containers') || (key === 'divisao' && text === 'correndo')
  if (isDefault) next.delete(key)
  else next.set(key, text)
  // A lente antiga sai quando a divisão é escolhida.
  if (key === 'divisao') next.delete('lente')
  return next
}

export function withDemurrageTab(params: URLSearchParams, tab: DemurrageTab): URLSearchParams {
  const next = withDemurrageParam(params, 'tab', TAB_PARAM[tab])
  // A divisão só vale para Containers; a Disputa em foco, só para Disputas.
  if (tab !== 'containers') {
    next.delete('divisao')
    next.delete('lente')
  }
  if (tab !== 'disputas') next.delete('dispute')
  return next
}

/** Link que abre a Invoice de Demurrage direto no detalhe. */
export function demurrageInvoiceHref(invoiceId: number): string {
  return `/demurrage?fatura=${invoiceId}`
}
