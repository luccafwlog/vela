import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../services/supabase'
import { countAlertQueue } from '../services/alerts'
import { queryKeys } from '../services/queryKeys'

export type OperationalCounts = {
  pendingReview: number
  chargeReviewRequired: number
  readyForBilling: number
  openAlerts: number
  blsWithoutCustomer: number
}

/**
 * Retorna contagens de pendências operacionais para exibição no nav.
 * staleTime de 60s — atualiza em background sem bloquear navegação.
 * Em caso de erro retorna 0 em todos os campos para não quebrar o layout.
 */
export function useOperationalCounts(): OperationalCounts {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    // Navigation should not compete with five badge-count requests. Let the
    // route paint first, then hydrate the non-critical indicators.
    const timer = window.setTimeout(() => setEnabled(true), 0)
    return () => window.clearTimeout(timer)
  }, [])

  // ponytail: o número de Alertas é relido a cada 60 s (ALE-D17); os demais
  // seguem pelo staleTime. Realtime só depois de `alerts` entrar em
  // supabase_realtime.

  const pendingReview = useQuery({
    queryKey: ['op-count', 'pending-review'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('bls')
        .select('*', { count: 'exact', head: true })
        .eq('review_status', 'pending_review')
        // BLR-D01 (lote 10): o número da Revisão não conta B/L cancelado.
        .is('cancelled_at', null)
      if (error) return 0
      return count ?? 0
    },
    enabled,
    staleTime: 60_000,
  })

  const chargeReviewRequired = useQuery({
    queryKey: ['op-count', 'charge-review-required'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('bls')
        .select('*', { count: 'exact', head: true })
        .eq('charge_status', 'review_required')
      if (error) return 0
      return count ?? 0
    },
    enabled,
    staleTime: 60_000,
  })

  const readyForBilling = useQuery({
    queryKey: ['op-count', 'ready-for-billing'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('bls')
        .select('*', { count: 'exact', head: true })
        .eq('charge_status', 'ready_for_billing')
      if (error) return 0
      return count ?? 0
    },
    enabled,
    staleTime: 60_000,
  })

  const openAlerts = useQuery({
    queryKey: queryKeys.alerts.operationalCount(),
    queryFn: () => countAlertQueue('active'),
    enabled,
    staleTime: 60_000,
    // ALE-D17: alertas abertos pela rodada ou por colegas entram no número
    // sem recarregar, no mesmo passo do sino.
    refetchInterval: 60_000,
  })

  const blsWithoutCustomer = useQuery({
    queryKey: ['op-count', 'bls-without-customer'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('bls')
        .select('*', { count: 'exact', head: true })
        .is('customer_id', null)
      if (error) return 0
      return count ?? 0
    },
    enabled,
    staleTime: 60_000,
  })

  return {
    pendingReview: pendingReview.data ?? 0,
    chargeReviewRequired: chargeReviewRequired.data ?? 0,
    readyForBilling: readyForBilling.data ?? 0,
    openAlerts: openAlerts.data ?? 0,
    blsWithoutCustomer: blsWithoutCustomer.data ?? 0,
  }
}
