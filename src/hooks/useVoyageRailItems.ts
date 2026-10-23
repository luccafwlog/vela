import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useVoyages } from './useBls'
import { useVoyageRailDivergences } from './useVoyageReconciliation'
import { listVoyageEscalaSchedulesByVoyageIds } from '../services/voyageRouteSchedules'
import { buildVoyageRailItems } from '../services/voyageSummaries'

/**
 * Cards de navio/viagem das telas de lista (BLs, Containers e Vazios IMP): o
 * mesmo resumo de Viagens, Veículos e Baplie, na ordem da próxima escala para
 * a mais distante (`buildVoyageRailItems`). Clicar no card filtra a lista pela
 * viagem; a tela decide o filtro.
 */
export function useVoyageRailItems() {
  const { data: voyageRows = [], isLoading } = useVoyages()
  const voyageIds = useMemo(() => voyageRows.map((voyage) => voyage.id), [voyageRows])
  const { data: schedulesByVoyage = new Map() } = useQuery({
    queryKey: ['voyage-rail-card-schedules', voyageIds],
    enabled: voyageIds.length > 0,
    queryFn: () => listVoyageEscalaSchedulesByVoyageIds(voyageIds),
  })
  const openDivergencesByVoyage = useVoyageRailDivergences(voyageRows)
  const items = useMemo(
    () => buildVoyageRailItems(voyageRows, schedulesByVoyage, undefined, openDivergencesByVoyage),
    [voyageRows, schedulesByVoyage, openDivergencesByVoyage],
  )
  return { items, isLoading }
}

/** Card clicado de novo tira o filtro; outro card troca a viagem. */
export function toggleRailVoyage(current: string, clicked: number): string {
  return current === String(clicked) ? '' : String(clicked)
}
