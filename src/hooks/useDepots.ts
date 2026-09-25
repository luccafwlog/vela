import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteDepot, listDepots, upsertDepot } from '../services/depots'

export const depotQueryKeys = {
  all: ['depots'] as const,
  list: () => [...depotQueryKeys.all, 'list'] as const,
}

export function useDepots() {
  return useQuery({ queryKey: depotQueryKeys.list(), queryFn: listDepots })
}

export function useUpsertDepot() {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: upsertDepot, onSuccess: () => queryClient.invalidateQueries({ queryKey: depotQueryKeys.all }) })
}

export function useDeleteDepot() {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => deleteDepot(id, reason), onSuccess: () => queryClient.invalidateQueries({ queryKey: depotQueryKeys.all }) })
}
