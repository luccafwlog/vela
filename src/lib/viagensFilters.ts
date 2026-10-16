import { compareVoyageRailItems, type VoyageRailItem } from '../services/voyageSummaries'

export type StatusFilter = 'all' | 'active' | 'completed' | 'cancelled'
export type ConciliacaoFilter = 'all' | 'conciliada' | 'pendente'
export type PeriodoFilter = 'all' | 'hoje' | '7d' | '30d' | 'custom'

export type VoyageFilters = {
  search: string
  status: StatusFilter
  conciliacao: ConciliacaoFilter
  periodo: PeriodoFilter
  /** Usados apenas quando periodo === 'custom'. ISO (yyyy-mm-dd) ou ''. */
  dataInicio?: string
  dataFim?: string
}

function isoDay(date: Date): string {
  // Data local: `toISOString` converteria para UTC e, a leste de Greenwich,
  // devolveria o dia anterior.
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Janela do filtro de período: de hoje até hoje + N dias (inclusive). "Hoje"
 * é a janela de um dia só. O limite superior é o fim da janela — tratá-lo como
 * piso invertia o filtro, escondendo justamente as escalas dos próximos dias.
 */
function periodoEtaWindow(periodo: 'hoje' | '7d' | '30d', now: Date = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(start)
  if (periodo !== 'hoje') end.setDate(end.getDate() + (periodo === '7d' ? 7 : 30))
  return { min: isoDay(start), max: isoDay(end) }
}

export function filterVoyageRailItems(
  items: VoyageRailItem[],
  filters: VoyageFilters,
): VoyageRailItem[] {
  const term = filters.search.trim().toUpperCase()

  return items
    .filter((item) => {
      if (filters.status !== 'all' && item.status !== filters.status) return false
      if (filters.conciliacao === 'conciliada' && item.estado !== 'conciliado') return false
      // Sem a contagem de divergências ainda, a viagem não entra em nenhum dos dois.
      if (filters.conciliacao === 'pendente' && (item.estado === 'conciliado' || item.estado === 'verificando')) return false
      if (filters.periodo === 'custom') {
        const ini = filters.dataInicio?.trim() ?? ''
        const fim = filters.dataFim?.trim() ?? ''
        if (ini || fim) {
          const eta = item.proximaEscala?.eta
          if (!eta) return false
          if (ini && eta < ini) return false
          if (fim && eta > fim) return false
        }
      } else if (filters.periodo !== 'all') {
        const { min, max } = periodoEtaWindow(filters.periodo)
        const eta = item.proximaEscala?.eta
        if (!eta || eta < min || eta > max) return false
      }
      if (term) {
        const haystack = [
          item.vesselName,
          item.voyageNumber,
          item.carrierName,
          ...item.originPorts,
          ...item.destinationPorts,
        ].join(' ').toUpperCase()
        if (!haystack.includes(term)) return false
      }
      return true
    })
    .sort(compareVoyageRailItems)
}

export function countActiveFilters(filters: VoyageFilters): number {
  let n = 0
  if (filters.search.trim()) n += 1
  if (filters.status !== 'all') n += 1
  if (filters.conciliacao !== 'all') n += 1
  if (filters.periodo !== 'all') n += 1
  return n
}

export function emptyFilters(): VoyageFilters {
  return { search: '', status: 'all', conciliacao: 'all', periodo: 'all', dataInicio: '', dataFim: '' }
}
