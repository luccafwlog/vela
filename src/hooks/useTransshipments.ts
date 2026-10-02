import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { afterBlInvoiceBasisAlterada } from '../services/cacheEffects'
import { queryKeys } from '../services/queryKeys'
import {
  listBlTransshipments,
  listVoyageOmissions,
  omitVoyageEscala,
  revertVoyageOmission,
  setBlCod,
  setBlTransshipment,
  updateVoyageOmission,
  type BlTransshipment,
  type VoyageOmission,
} from '../services/transshipments'

export function useVoyageTransshipments(voyageId: number | null) {
  return useQuery({
    queryKey: voyageId ? queryKeys.transshipments.byVoyage(voyageId) : ['transshipments', 'none'],
    enabled: voyageId != null,
    queryFn: async (): Promise<{ omissions: VoyageOmission[]; transshipments: BlTransshipment[] }> => {
      const omissions = await listVoyageOmissions(voyageId as number)
      // ponytail: 1 query de omissoes + N de transbordos por viagem aberta; ok no volume atual (0-1 omissao/viagem). Upgrade = SELECT unico por omission_id in (...).
      const transshipments = (await Promise.all(omissions.map((omission) => listBlTransshipments(omission.id)))).flat()
      return { omissions, transshipments }
    },
  })
}

export function useUpdateVoyageOmission(voyageId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateVoyageOmission,
    onSuccess: () => {
      invalidateVoyageOmissionCaches(queryClient, voyageId)
    },
  })
}

export function useOmitEscala(voyageId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: omitVoyageEscala,
    onSuccess: () => {
      invalidateVoyageOmissionCaches(queryClient, voyageId)
    },
  })
}

export function useRevertVoyageOmission(voyageId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: revertVoyageOmission,
    onSuccess: () => {
      invalidateVoyageOmissionCaches(queryClient, voyageId)
    },
  })
}

function invalidateVoyageOmissionCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  voyageId: number,
  blId?: string,
) {
  queryClient.invalidateQueries({ queryKey: queryKeys.transshipments.byVoyage(voyageId) })
  queryClient.invalidateQueries({ queryKey: ['voyage-pod-schedules'] })
  queryClient.invalidateQueries({ queryKey: queryKeys.voyages.escalaSchedules() })
  queryClient.invalidateQueries({ queryKey: queryKeys.voyages.escalaTerminalAll() })
  queryClient.invalidateQueries({ queryKey: queryKeys.agencyReports.all() })
  queryClient.invalidateQueries({ queryKey: ['voyage-timeline'] })
  queryClient.invalidateQueries({ queryKey: ['voyages'] })
  queryClient.invalidateQueries({ queryKey: ['bls'] })
  queryClient.invalidateQueries({ queryKey: queryKeys.bls.cockpit() })
  queryClient.invalidateQueries({ queryKey: queryKeys.bls.detail() })
  queryClient.invalidateQueries({ queryKey: queryKeys.bls.timeline() })
  queryClient.invalidateQueries({ queryKey: queryKeys.portal.blStatus() })
  queryClient.invalidateQueries({ queryKey: ['portal-operation-bls'] })
  queryClient.invalidateQueries({ queryKey: ['portal-schedule-voyages'] })
  if (blId !== undefined) {
    queryClient.invalidateQueries({ queryKey: queryKeys.portal.blStatus(blId) })
  }
  queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] })
  queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] })
  return afterBlInvoiceBasisAlterada(queryClient)
}

export function useSetBlDisposition(voyageId: number) {
  const queryClient = useQueryClient()
  const invalidate = (variables: { blId: string }) => {
    return invalidateVoyageOmissionCaches(queryClient, voyageId, variables.blId)
  }
  return {
    setTransshipment: useMutation({ mutationFn: setBlTransshipment, onSuccess: (_, variables) => invalidate(variables) }),
    setCod: useMutation({ mutationFn: setBlCod, onSuccess: (_, variables) => invalidate(variables) }),
  }
}
