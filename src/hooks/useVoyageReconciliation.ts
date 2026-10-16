import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { countOpenBaplieDivergences, reconcileBaplieWithManifest } from '../services/baplieReconciliation'

function reconciliationQuery(voyageId: number) {
  return {
    queryKey: ['baplie-reconciliation', String(voyageId)],
    staleTime: 60_000,
    queryFn: () => reconcileBaplieWithManifest(voyageId),
  }
}

/**
 * Conciliação Baplie ↔ Manifesto de uma única viagem (a aberta no detalhe).
 * Compartilha a chave de cache com a página Baplie e com a faixa de viagens.
 */
export function useVoyageReconciliation(voyageId: number | null | undefined) {
  return useQuery({
    ...reconciliationQuery(Number(voyageId)),
    queryKey: ['baplie-reconciliation', voyageId == null ? '' : String(voyageId)],
    enabled: voyageId != null,
  })
}

/**
 * Divergências abertas por viagem, para o cartão da faixa mostrar
 * "Divergente". Só viagens ativas com Baplie gravado (sem Baplie não há
 * divergência), numa consulta só para todas (`countOpenBaplieDivergences`, a
 * mesma regra da ficha). A família `['baplie-reconciliation']` é invalidada
 * junto com a da ficha depois de gravar carga, Baplie ou escala.
 * ponytail: viagem concluída ou cancelada não entra (o histórico inteiro de
 * Baplie seria lido a cada abertura); o cartão dela segue só a cobertura de CE.
 */
export function useVoyageRailDivergences(
  voyages: ReadonlyArray<{ id: number; status?: string | null; baplieCount?: number | null }> | null | undefined,
): ReadonlyMap<number, number> {
  const voyageIds = useMemo(
    () => (voyages ?? [])
      .filter((voyage) => (voyage.baplieCount ?? 0) > 0 && voyage.status !== 'completed' && voyage.status !== 'cancelled')
      .map((voyage) => voyage.id)
      .sort((a, b) => a - b),
    [voyages],
  )
  const { data } = useQuery({
    queryKey: ['baplie-reconciliation', 'rail', voyageIds],
    enabled: voyageIds.length > 0,
    staleTime: 60_000,
    queryFn: () => countOpenBaplieDivergences(voyageIds),
  })
  return data ?? EMPTY_DIVERGENCES
}

const EMPTY_DIVERGENCES: ReadonlyMap<number, number> = new Map()
