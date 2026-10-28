import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { afterBlInvoiceBasisAlterada, afterReferenciaPortalAlterada, afterTaxasDoBlAlteradas } from '../services/cacheEffects'
import { queryKeys } from '../services/queryKeys'
import {
  quoteManualInvoiceCharge,
  addManualBlCharge,
  calculateBlLocalCharges,
  calculateLocalChargesBatch,
  listLocalChargeOperationalRowsWithMeta,
  deleteManualBlCharge,
  listManualChargeItemsForBl,
  listBlLocalChargeLines,
  getInvoicedSubtotalForBl,
  updateManualBlCharge,
  alterBlChargeValue,
  excludeBlCharge,
  restoreBlCharge,
  listBlChargeHistory,
  setBlLocalChargeExemption,
} from '../services/charges/chargeOperationsService'
import {
  deleteChargeTableItem,
  listChargeTablesInUse,
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
  countActiveConditionsForItem,
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

export function useDeleteManualBlCharge() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: { chargeCalculationId: number; justification: string; actorId?: string | null }) =>
      deleteManualBlCharge(payload.chargeCalculationId, payload.justification, payload.actorId),
    onSuccess: () => afterTaxasDoBlAlteradas(queryClient),
  })
}

export function useBlChargeHistory(blId?: string) {
  return useQuery({
    queryKey: queryKeys.bls.chargeHistory(blId ?? ''),
    enabled: Boolean(blId),
    queryFn: () => listBlChargeHistory(blId!),
  })
}

/** Alterar valor, excluir taxa e desfazer (ADR 0111); todas pedem justificativa. */
export function useChangeBlCharge(blId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload:
      | { action: 'alter'; lineKey: string; kind: 'unit' | 'total'; value: number; justification: string; actorId?: string | null }
      | { action: 'exclude' | 'restore'; lineKey: string; justification: string; actorId?: string | null }) => {
      const base = { blId: blId!, lineKey: payload.lineKey, justification: payload.justification, actorId: payload.actorId }
      if (payload.action === 'alter') return alterBlChargeValue({ ...base, kind: payload.kind, value: payload.value })
      if (payload.action === 'exclude') return excludeBlCharge(base)
      return restoreBlCharge(base)
    },
    onSuccess: () => afterTaxasDoBlAlteradas(queryClient),
  })
}

export function useSetBlLocalChargeExemption(blId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: { exempt: boolean; justification: string; actorId?: string | null }) =>
      setBlLocalChargeExemption({ blId: blId!, ...payload }),
    onSuccess: () => afterTaxasDoBlAlteradas(queryClient),
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
        // F-50: o cálculo muda o "a faturar" do Cliente, a fila de faturamento e o Desbloqueio de CE.
        afterBlInvoiceBasisAlterada(queryClient),
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

/** Tabelas já usadas, para a tela mostrar a correção de item só a quem o banco aceita. */
export function useChargeTablesInUse(tableIds: readonly number[]) {
  return useQuery({
    queryKey: queryKeys.charges.tablesInUse(tableIds),
    queryFn: () => listChargeTablesInUse(tableIds),
    enabled: tableIds.length > 0,
  })
}

export function useSaveChargeTable() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: saveChargeTable,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.tables() }),
        afterReferenciaPortalAlterada(queryClient),
      ])
    },
  })
}

export function useSetChargeTableActive() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, active, reason }: { id: number; active: boolean; reason?: string }) => setChargeTableActive(id, active, reason),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.tables() }),
        afterReferenciaPortalAlterada(queryClient),
      ])
    },
  })
}

export function useSetChargeTableItemActive() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, active, reason }: { id: number; active: boolean; reason?: string }) => setChargeTableItemActive(id, active, reason),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.tables() }),
        afterReferenciaPortalAlterada(queryClient),
        // Correção de item ou Condição reprecifica os B/Ls e reemite ou deixa
        // desatualizadas as faturas (migration 354; ADR 0093, decisão 2).
        afterBlInvoiceBasisAlterada(queryClient),
      ])
    },
  })
}

export function useSetCustomerRateOverrideActive() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, active, reason }: { id: number; active: boolean; reason?: string }) => setCustomerRateOverrideActive(id, active, reason),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.overrides() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.localChargeLines() }),
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
        afterReferenciaPortalAlterada(queryClient),
        // Correção de item ou Condição reprecifica os B/Ls e reemite ou deixa
        // desatualizadas as faturas (migration 354; ADR 0093, decisão 2).
        afterBlInvoiceBasisAlterada(queryClient),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.manualChargeItems() }),
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
        afterReferenciaPortalAlterada(queryClient),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.manualChargeItems() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.overrideItems() }),
      ])
    },
  })
}

export function useLocalChargeOperations(filters?: {
  search?: string
  cargoMode?: '' | 'container' | 'carga_solta' | 'misto'
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

/** Condições ativas do item em edição; invalidada junto com as condições. */
export function useActiveConditionCount(chargeItemId: number | null) {
  return useQuery({
    queryKey: queryKeys.charges.overrides({ activeForItem: chargeItemId }),
    queryFn: () => countActiveConditionsForItem(chargeItemId as number),
    enabled: chargeItemId != null,
  })
}

export function useOverrideCustomers(search: string) {
  return useQuery({
    queryKey: queryKeys.charges.overrideCustomers(search),
    queryFn: () => listOverrideCustomers(search),
  })
}

/**
 * Busca de Cliente sob demanda para o Combobox da Condição de Cliente: mesma
 * consulta e chave de `useOverrideCustomers`, devolvida como promessa.
 */
export function useOverrideCustomerLookup() {
  const queryClient = useQueryClient()
  return useCallback(
    (search: string) => queryClient.fetchQuery({
      queryKey: queryKeys.charges.overrideCustomers(search),
      queryFn: () => listOverrideCustomers(search),
      staleTime: 30_000,
    }),
    [queryClient],
  )
}

export function useSaveCustomerRateOverride() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: saveCustomerRateOverride,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.charges.overrides() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.localChargeLines() }),
        // Correção de item ou Condição reprecifica os B/Ls e reemite ou deixa
        // desatualizadas as faturas (migration 354; ADR 0093, decisão 2).
        afterBlInvoiceBasisAlterada(queryClient),
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
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.localChargeLines() }),
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
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.detail() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.voyages.all() }),
        // F-50: o cálculo muda o "a faturar" do Cliente, a fila de faturamento e o Desbloqueio de CE.
        afterBlInvoiceBasisAlterada(queryClient),
      ])
    },
  })
}

export function useManualInvoiceQuote(blId: string | null, itemId: number | null) {
  return useQuery({
    queryKey: [...queryKeys.bls.manualChargeItems(blId ?? ''), 'invoice-quote', itemId],
    enabled: Boolean(blId && itemId),
    queryFn: () => quoteManualInvoiceCharge(blId!, itemId!),
  })
}
