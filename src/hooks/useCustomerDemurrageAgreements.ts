import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../services/queryKeys'
import {
  deleteCustomerDemurrageAgreement,
  listCustomerDemurrageAgreements,
  saveCustomerDemurrageAgreement,
  toggleCustomerDemurrageAgreementActive,
  type CustomerDemurrageAgreementFilters,
} from '../services/demurrage/customerDemurrageAgreements'
import type { CustomerDemurrageAgreementFormInput } from '../types/customerDemurrageAgreements'

// `enabled` existe porque "sem customerId" e um filtro legitimo — a aba de
// acordos lista todos de proposito. Quem pergunta pelos acordos DE UM cliente
// precisa nao consultar quando nao ha cliente: sem o guard, a lista volta com
// os acordos de todo mundo e o chamador aplica o de outro cliente.
export function useCustomerDemurrageAgreements(
  filters?: CustomerDemurrageAgreementFilters,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.demurrage.customerAgreements(filters),
    queryFn: () => listCustomerDemurrageAgreements(filters),
    enabled,
  })
}

function useInvalidateCustomerAgreements() {
  const queryClient = useQueryClient()
  return (customerId?: number) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.demurrage.customerAgreements() })
    if (customerId) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.customerFicha.demurrageAgreements(customerId) })
    }
  }
}

export function useSaveCustomerDemurrageAgreement() {
  const invalidate = useInvalidateCustomerAgreements()
  return useMutation({
    mutationFn: (input: CustomerDemurrageAgreementFormInput) => saveCustomerDemurrageAgreement(input),
    onSuccess: (_, variables) => invalidate(variables.customer_id),
  })
}

export function useDeleteCustomerDemurrageAgreement() {
  const invalidate = useInvalidateCustomerAgreements()
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string; customerId?: number }) => deleteCustomerDemurrageAgreement(id, reason),
    onSuccess: (_, variables) => invalidate(variables.customerId),
  })
}

export function useToggleCustomerDemurrageAgreementActive() {
  const invalidate = useInvalidateCustomerAgreements()
  return useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean; customerId?: number }) =>
      toggleCustomerDemurrageAgreementActive(id, active),
    onSuccess: (_, variables) => invalidate(variables.customerId),
  })
}
