import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchAlertTypeSettings, type AlertTypeSetting } from '../services/alertTypeSettings'
import { queryKeys } from '../services/queryKeys'

/**
 * Gravidade vigente de cada tipo de alerta, com os abertos e a última troca
 * (migration 603). Mapa por tipo para a tela Regras de alertas.
 */
export function useAlertTypeSettings() {
  const query = useQuery({
    queryKey: queryKeys.alerts.typeSettings(),
    queryFn: fetchAlertTypeSettings,
    staleTime: 60_000,
  })
  const byType = useMemo(
    () => new Map<string, AlertTypeSetting>((query.data ?? []).map((setting) => [setting.type, setting])),
    [query.data],
  )
  return { ...query, byType }
}
