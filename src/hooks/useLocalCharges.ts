import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../services/queryKeys'
import {
  addManualBlCharge,
  calculateBlLocalCharges,
  calculateLocalChargesBatch,
  listLocalChargeOperationalRowsWithMeta,
  deleteManualBlCharge,
  listManualChargeItemsForBl,
  markBlChargesReviewed,
  markBlReadyForBilling,
  listBlLocalChargeLines,
  getInvoicedSubtotalForBl,
  updateManualBlCharge,
} from '../services/charges/chargeOperationsService'
import {
  deleteChargeTableItem,
  listLocalChargeTables,
  saveChargeTable,
  saveChargeTableItem,
  setChargeTableActive,
  setChargeTableItemActive,
} from '../services/charges/chargeTableService'
import {
  deleteCustomerRateOverride,
  setCustomerRateOverrideActive,
  listCustomerRateOverrides,
  listOverrideChargeItems,
  listOverrideCustomers,
  saveCustomerRateOverride,
} from '../services/charges/chargeRateService'
import {
  listCustomerReconciliationQueue,
} from '../services/charges/chargeReconciliationService'

export function useBlLocalChargeLines(blId?: string) {
  return useQuery({
    queryKey: queryKeys.bls.localChargeLines(blId ?? ''),
    enabled: Boolean(blId),
    queryFn: () => listBlLocalChargeLines(blId!),
  })
}

// Só para B/L faturado: é nesse estado que a conferência tem com o que
// comparar. Enquanto o B/L não foi faturado não existe número congelado.
export function useInvoicedSubtotalForBl(blId?: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.invoices.blSubtotal(blId ?? ''),
    enabled: Boolean(blId) && enabled,
    queryFn: () => getInvoicedSubtotalForBl(blId!),
  })
}

export function useManualChargeItemsForBl(blId?: string) {
  return useQuery({
    queryKey: queryKeys.bls.manualChargeItems(blId ?? ''),
    enabled: Boolean(blId),
    queryFn: () => listManualChargeItemsForBl(blId!),
  })
}

export function useAddManualBlCharge(blId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: { chargeItemId: number; quantity: number; notes?: string | null; actorId?: string | null }) =>
      addManualBlCharge(blId!, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.localChargeLines(blId ?? '') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.detail(blId ?? '') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.pendencies() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.voyages.all() }),
      ])
    },
  })
}

export function useUpdateManualBlCharge(blId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: { chargeCalculationId: number; quantity: number; notes?: string | null; actorId?: string | null }) =>
      updateManualBlCharge(payload.chargeCalculationId, {
        quantity: payload.quantity,
        notes: payload.notes,
        actorId: payload.actorId,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.localChargeLines(blId ?? '') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.detail(blId ?? '') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.pendencies() }),
      ])
    },
  })
}

export function useDeleteManualBlCharge(blId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: { chargeCalculationId: number; actorId?: string | null }) =>
      deleteManualBlCharge(payload.chargeCalculationId, payload.actorId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.localChargeLines(blId ?? '') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.detail(blId ?? '') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.pendencies() }),
      ])
    },
  })
}

export function useMarkBlChargesReviewed(blId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload?: { actorId?: string | null }) => markBlChargesReviewed(blId!, payload?.actorId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.localChargeLines(blId ?? '') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.detail(blId ?? '') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.pendencies() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.voyages.all() }),
      ])
    },
  })
}

export function useMarkBlReadyForBilling(blId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload?: { actorId?: string | null }) => markBlReadyForBilling(blId!, payload?.actorId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.localChargeLines(blId ?? '') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.detail(blId ?? '') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.pendencies() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.voyages.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all() }),
      ])
    },
  })
}

export function useCalculateBlLocalCharges(blId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload?: { actorId?: string | null; recalculate?: boolean }) =>
      calculateBlLocalCharges(blId!, {
        actorId: payload?.actorId ?? null,
        recalculate: payload?.recalculate ?? true,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.localChargeLines(blId ?? '') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.detail(blId ?? '') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.operations() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.pendencies() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.voyages.all() }),
      ])
    },
  })
}

export function useLocalChargeTables(filters?: { cargoMode?: '' | 'container' | 'carga_solta' | 'granito'; pod?: string }) {
  return useQuery({
    queryKey: queryKeys.charges.tables(filters),
    queryFn: () => listLocalChargeTables(filters),
  })
}

export function useSaveChargeTable() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: saveChargeTable,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.charges.tables() })
    },
  })
}

export function useSetChargeTableActive() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => setChargeTableActive(id, active),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.charges.tables() })
    },
  })
}

export function useSetChargeTableItemActive() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => setChargeTableItemActive(id, active),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.charges.tables() })
    },
  })
}

export function useSetCustomerRateOverrideActive() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => setCustomerRateOverrideActive(id, active),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.overrides() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.localChargeLines('') }),
      ])
    },
  })
}

export function useSaveChargeTableItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: saveChargeTableItem,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.tables() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.manualChargeItems('') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.overrideItems() }),
      ])
    },
  })
}

export function useDeleteChargeTableItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => deleteChargeTableItem(id, reason),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.tables() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.manualChargeItems('') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.overrideItems() }),
      ])
    },
  })
}

export function useLocalChargeOperations(filters?: {
  search?: string
  cargoMode?: '' | 'container' | 'carga_solta' | 'misto' | 'granito'
  pod?: string
  voyageId?: number | null
  chargeStatus?: '' | 'not_calculated' | 'calculated' | 'review_required' | 'reviewed' | 'ready_for_billing' | 'exempt'
  includeResolved?: boolean
  limit?: number
}) {
  return useQuery({
    queryKey: queryKeys.charges.operations(filters),
    queryFn: () => listLocalChargeOperationalRowsWithMeta(filters),
  })
}
export function useCustomerReconciliationQueue(status?: '' | 'pending' | 'approved' | 'rejected', limit = 200) {
  return useQuery({
    queryKey: queryKeys.reconciliation.queue(status, limit),
    queryFn: () => listCustomerReconciliationQueue(status, limit),
  })
}

export function useCustomerRateOverrides(filters?: {
  customerSearch?: string
  cargoMode?: '' | 'container' | 'carga_solta' | 'granito'
  pod?: string
  limit?: number
}) {
  return useQuery({
    queryKey: queryKeys.charges.overrides(filters),
    queryFn: () => listCustomerRateOverrides(filters),
  })
}

export function useOverrideChargeItems() {
  return useQuery({
    queryKey: queryKeys.charges.overrideItems(),
    queryFn: () => listOverrideChargeItems(),
  })
}

export function useOverrideCustomers(search: string) {
  return useQuery({
    queryKey: queryKeys.charges.overrideCustomers(search),
    queryFn: () => listOverrideCustomers(search),
  })
}

export function useSaveCustomerRateOverride() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: saveCustomerRateOverride,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.overrides() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.localChargeLines('') }),
      ])
    },
  })
}

export function useDeleteCustomerRateOverride() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => deleteCustomerRateOverride(id, reason),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.overrides() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.localChargeLines('') }),
      ])
    },
  })
}

export function useBatchCalculateLocalCharges() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: { blIds: string[]; actorId?: string | null; recalculate?: boolean }) =>
      calculateLocalChargesBatch(payload.blIds, {
        actorId: payload.actorId ?? null,
        recalculate: payload.recalculate ?? true,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.operations() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.pendencies() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.detail('') }),
        queryClient.invalidateQueries({ queryKey: queryKeys.voyages.all() }),
      ])
    },
  })
}
