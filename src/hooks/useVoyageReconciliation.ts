import { useCallback, useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { reconcileBaplieWithManifest } from '../services/baplieReconciliation'

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
 * "Divergente". Só consulta viagens ativas que têm Baplie gravado: sem Baplie
 * não há divergência.
 * ponytail: uma conciliação por viagem com Baplie, calculada no navegador
 * (a mesma da ficha, com o cache compartilhado). Com dezenas de viagens ativas
 * com Baplie, trocar por uma RPC que devolva a contagem de todas de uma vez.
 */
export function useVoyageRailDivergences(
  voyages: ReadonlyArray<{ id: number; status?: string | null; baplieCount?: number | null }> | null | undefined,
): ReadonlyMap<number, number> {
  const voyageIds = useMemo(
    () => (voyages ?? [])
      .filter((voyage) => (voyage.baplieCount ?? 0) > 0 && voyage.status !== 'completed' && voyage.status !== 'cancelled')
      .map((voyage) => voyage.id),
    [voyages],
  )
  // `combine` estável: o React Query só remonta o mapa quando as consultas mudam.
  const combine = useCallback(
    (results: Array<{ data?: { items: unknown[] } }>) => new Map(voyageIds.map((voyageId, index) => [voyageId, results[index]?.data?.items.length ?? 0])),
    [voyageIds],
  )
  return useQueries({ queries: voyageIds.map((voyageId) => reconciliationQuery(voyageId)), combine })
}
