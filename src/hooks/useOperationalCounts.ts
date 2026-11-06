import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../services/supabase'
import { countAlertQueue } from '../services/alerts'
import { listCeUnlockReviewQueue } from '../services/ceUnlockService'
import { queryKeys } from '../services/queryKeys'
import { groupReviewItems } from '../pages/revisaoHelpers'
import { fetchAllReviewPages, type ReviewQueueItem } from './useReview'

export type OperationalCounts = {
  /** Clientes (grupos da tela Revisão) com B/L em revisão, não B/Ls (decisão do dono de 2026-11-05). */
  pendingReview: number
  /** Solicitações de Desbloqueio de CE à espera da análise dos documentos (aba Solicitações). */
  pendingCeUnlockRequests: number
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

  // Decisão do dono de 2026-11-05: o número da Revisão conta clientes, não
  // B/Ls — resolver o cliente resolve os B/Ls dele. Agrupa pela mesma regra da
  // tela (`groupReviewItems`: CNPJ válido; sem ele, o nome), lendo só as
  // colunas que o agrupamento usa.
  const pendingReview = useQuery({
    queryKey: ['op-count', 'pending-review'],
    queryFn: async () => {
      try {
        const rows = await fetchAllReviewPages((from, to) => supabase
          .from('bls')
          .select('id, consignee, shipper, manifest_customer_cnpj_cpf, consignee_block, cargo_description, customer:customers!bls_customer_id_fkey(id, cnpj_cpf, name)')
          .eq('review_status', 'pending_review')
          // BLR-D01 (lote 10): o número da Revisão não conta B/L cancelado.
          .is('cancelled_at', null)
          .order('id')
          .range(from, to))
        return countReviewCustomers(rows as unknown as ReviewCountRow[])
      } catch {
        return 0
      }
    },
    enabled,
    staleTime: 60_000,
  })

  const pendingCeUnlockRequests = useQuery({
    queryKey: queryKeys.ceUnlock.reviewQueueCount(),
    queryFn: async () => {
      try {
        return (await listCeUnlockReviewQueue(1))?.total ?? 0
      } catch {
        return 0
      }
    },
    enabled,
    staleTime: 60_000,
    // A solicitação nasce no Portal: o número sobe sem recarregar, no mesmo
    // passo do sino.
    refetchInterval: 60_000,
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
    pendingCeUnlockRequests: pendingCeUnlockRequests.data ?? 0,
    chargeReviewRequired: chargeReviewRequired.data ?? 0,
    readyForBilling: readyForBilling.data ?? 0,
    openAlerts: openAlerts.data ?? 0,
    blsWithoutCustomer: blsWithoutCustomer.data ?? 0,
  }
}

type ReviewCountRow = Pick<ReviewQueueItem, 'id' | 'consignee' | 'shipper' | 'manifest_customer_cnpj_cpf' | 'consignee_block' | 'cargo_description' | 'customer'>

/** Quantos grupos (clientes) a tela Revisão mostra para estes B/Ls. */
export function countReviewCustomers(rows: ReviewCountRow[]): number {
  return groupReviewItems(rows.map((row) => ({ ...row, source: 'bl' }) as ReviewQueueItem)).length
}
