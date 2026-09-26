import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createManifestoMercante,
  linkBlToManifestoMercante,
  linkBlsToManifestoMercante,
  listManifestosMercanteByVoyage,
  type CreateManifestoMercanteInput,
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

export function useCreateManifestoMercante() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateManifestoMercanteInput) => createManifestoMercante(input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.manifestosMercante.byVoyage(variables.voyage_id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.voyages.all() })
    },
  })
}

export function useLinkBlToManifestoMercante(voyageId?: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ blId, manifestoId }: { blId: string; manifestoId: string | null }) =>
      linkBlToManifestoMercante(blId, manifestoId),
    onSuccess: () => {
      if (voyageId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.manifestosMercante.byVoyage(voyageId) })
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.bls.all() })
    },
  })
}

export function useLinkBlsToManifestoMercante(voyageId?: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ blIds, manifestoId }: { blIds: string[]; manifestoId: string | null }) =>
      linkBlsToManifestoMercante(blIds, manifestoId),
    onSuccess: () => {
      if (voyageId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.manifestosMercante.byVoyage(voyageId) })
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.bls.all() })
    },
  })
}
