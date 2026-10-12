import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  listManifestosMercanteByVoyage,
  listVoyageBlsForManifesto,
  moveBlsToManifestoMercante,
  unlinkBlsFromManifestoMercante,
  type ExpectedManifestos,
  type ManifestoMercante,
} from '../services/manifestosMercanteService'
import { queryKeys } from '../services/queryKeys'

export function useManifestosMercanteByVoyage(voyageId: number | null | undefined) {
  return useQuery<ManifestoMercante[]>({
    queryKey: queryKeys.manifestosMercante.byVoyage(voyageId ?? 0),
    enabled: voyageId != null && voyageId > 0,
    queryFn: () => listManifestosMercanteByVoyage(voyageId!),
  })
}

export function useVoyageBlsForManifesto(voyageId: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.manifestosMercante.byVoyage(voyageId ?? 0), 'bls'],
    enabled: enabled && voyageId != null && voyageId > 0,
    queryFn: () => listVoyageBlsForManifesto(voyageId!),
  })
}

async function afterManifestoChanged(queryClient: ReturnType<typeof useQueryClient>, voyageId?: number | null) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.manifestosMercante.all() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.bls.all() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.voyages.all() }),
    ...(voyageId ? [queryClient.invalidateQueries({ queryKey: queryKeys.voyages.detail(voyageId) })] : []),
  ])
}

export function useMoveBlsToManifestoMercante(voyageId?: number | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ blIds, numero, reason, expected }: { blIds: string[]; numero: string; reason: string; expected: ExpectedManifestos }) =>
      moveBlsToManifestoMercante(blIds, numero, reason, expected),
    onSuccess: () => afterManifestoChanged(queryClient, voyageId),
  })
}

export function useUnlinkBlsFromManifestoMercante(voyageId?: number | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ blIds, reason, expected }: { blIds: string[]; reason: string; expected: ExpectedManifestos }) =>
      unlinkBlsFromManifestoMercante(blIds, reason, expected),
    onSuccess: () => afterManifestoChanged(queryClient, voyageId),
  })
}
