import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchAppSettings, setCommunicationsEnabled, setDemurrageDunningIntervalDays } from '../services/appSettings'
import { queryKeys } from '../services/queryKeys'

export function useAppSettings(enabled = true) {
  return useQuery({
    queryKey: queryKeys.appSettings(),
    queryFn: fetchAppSettings,
    enabled,
  })
}

export function useSetCommunicationsEnabled() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (enabled: boolean) => setCommunicationsEnabled(enabled),
    // Também na falha: a resposta perdida depois da gravação deixaria a tela
    // mostrando o estado anterior.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.appSettings() })
    },
  })
}

export function useSetDemurrageDunningIntervalDays() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (days: number) => setDemurrageDunningIntervalDays(days),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.appSettings() })
    },
  })
}
