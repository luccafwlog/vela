import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchBlCommunicationHistory,
  fetchCustomerCommunicationConference,
  fetchCustomerCommunicationHistory,
  fetchVoyageCommunicationCoverage,
  type CustomerCommunicationHistoryFilters,
  fetchCustomerCommunicationSavedTemplates,
  saveCustomerCommunicationSavedTemplate,
  type CustomerCommunicationFilters,
} from '../services/customerCommunications'
import {
  dispatchCustomerCommunication,
  runCustomerCommunicationBatch,
  type CustomerCommunicationBatchItem,
} from '../services/customerCommunicationDispatches'
import { dispatchCeMercanteTaxasCommunication } from '../services/customerFinanceCommunications'
import type { CustomerCommunicationKind } from '../services/customerCommunicationTemplates'
import type { CustomerCommunicationNature } from '../types/database'
import { queryKeys } from '../services/queryKeys'
import { afterCustomerCommunicationBatchDispatched } from '../services/cacheEffects'
import type { CustomerCommunicationAudience } from '../services/customerCommunicationBoxes'

export function useCustomerCommunicationConference(input: {
  filters: CustomerCommunicationFilters
  kind: CustomerCommunicationKind
  nature?: CustomerCommunicationNature
  audience?: CustomerCommunicationAudience
  enabled?: boolean
}) {
  return useQuery({
    queryKey: queryKeys.customerCommunications.conference(input.filters, input.kind, input.nature, input.audience),
    enabled: input.enabled ?? true,
    queryFn: () => fetchCustomerCommunicationConference({ filters: input.filters, kind: input.kind, nature: input.nature, audience: input.audience }),
  })
}

export function useCustomerCommunicationHistory(filters?: number | CustomerCommunicationHistoryFilters, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.customerCommunications.history(filters),
    enabled: options.enabled ?? true,
    queryFn: () => fetchCustomerCommunicationHistory(filters),
  })
}

/** A Cobertura lê a prontidão de cada Cliente × Viagem: só carrega na aba dela (plano dos e-mails, 3.7). */
export function useVoyageCommunicationCoverage(filters?: { vessel?: string; voyage?: string; month?: string }, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...queryKeys.customerCommunications.all(), 'coverage', filters],
    enabled: options.enabled ?? true,
    queryFn: () => fetchVoyageCommunicationCoverage(filters),
  })
}

export function useCustomerCommunicationSavedTemplates() {
  return useQuery({
    queryKey: [...queryKeys.customerCommunications.all(), 'saved-templates'],
    queryFn: fetchCustomerCommunicationSavedTemplates,
  })
}

export function useSaveCustomerCommunicationSavedTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: saveCustomerCommunicationSavedTemplate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...queryKeys.customerCommunications.all(), 'saved-templates'] }),
  })
}

export function useBlCommunicationHistory(blId?: string) {
  return useQuery({
    queryKey: queryKeys.customerCommunications.byBl(blId ?? 'nil'),
    enabled: Boolean(blId),
    queryFn: () => fetchBlCommunicationHistory(blId!),
  })
}

/**
 * Disparo em lote da conferência: segue depois de uma falha e invalida o cache
 * uma vez, no fim (plano dos e-mails, 3.2). Repetir as falhas passa os mesmos
 * itens de volta.
 */
export function useDispatchCustomerCommunicationBatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (items: readonly CustomerCommunicationBatchItem[]) => runCustomerCommunicationBatch(items, dispatchCustomerCommunication),
    onSettled: async (_outcomes, _error, items) => {
      await afterCustomerCommunicationBatchDispatched(queryClient, {
        customerIds: [...new Set(items.map((item) => item.input.customerId))],
        blIds: items.flatMap((item) => [...(item.input.blIds ?? [])]),
      })
    },
  })
}

/**
 * "Reenviar CE e Taxas" (D5): novo discriminador, conferência de prontidão e de
 * contatos no serviço; o envio que sai fecha `comunicado_ce_reenvio_pendente`.
 */
export function useResendCeMercanteTaxasCommunication() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { voyageId: number; customerId: number }) =>
      dispatchCeMercanteTaxasCommunication(input.voyageId, input.customerId, { forceRetry: true }),
    onSettled: async (_summary, _error, input) => {
      await afterCustomerCommunicationBatchDispatched(queryClient, { customerIds: [input.customerId] })
    },
  })
}
