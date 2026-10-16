import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ceUnlockCommand,
  getCeUnlockRequest,
  listCeUnlockBls,
  listCeUnlockReviewQueue,
  listCustomerCeUnlockRequests,
} from "../services/ceUnlockService";
import { queryKeys } from "../services/queryKeys";
import { afterCeUnlockChanged } from "../services/cacheEffects";
import type { CeUnlockFilters } from "../types/ceUnlock";
export function useCeUnlock(
  filters: CeUnlockFilters,
  page: number,
  enabled = true,
) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: queryKeys.ceUnlock.list("internal", filters, page),
    queryFn: () => listCeUnlockBls(filters, page),
    enabled,
    refetchOnWindowFocus: "always",
  });
  const command = useMutation({
    mutationFn: (input: { action: string; payload: Record<string, unknown> }) =>
      ceUnlockCommand(input.action, input.payload),
    onSuccess: () => afterCeUnlockChanged(client),
    onError: () => afterCeUnlockChanged(client),
  });
  return { list, command };
}
export function useCeUnlockReviewQueue(page: number, enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.ceUnlock.all(), "review-queue", page] as const,
    queryFn: () => listCeUnlockReviewQueue(page),
    enabled,
    refetchOnWindowFocus: "always",
  });
}
export function useCustomerCeUnlockRequests(customerId: number, blSearch: string, page: number) {
  return useQuery({
    queryKey: [...queryKeys.ceUnlock.all(), "customer-requests", customerId, blSearch.trim(), page] as const,
    queryFn: () => listCustomerCeUnlockRequests(customerId, blSearch, page),
  });
}
export function useCeUnlockRequest(id: string | null) {
  return useQuery({
    queryKey: queryKeys.ceUnlock.request("internal", id),
    queryFn: () => getCeUnlockRequest(id!),
    enabled: !!id,
    refetchOnWindowFocus: "always",
  });
}
/**
 * Contagem de cada cartão da aba Andamento dos B/Ls: o total da primeira página
 * da mesma lista com o recorte atual e a situação do cartão (mesma chave de
 * cache que a lista usa quando o cartão é o filtro aplicado).
 * ponytail: uma leitura por cartão, e cada uma materializa a elegibilidade de
 * todos os B/Ls (ver listCeUnlockBls); se pesar, devolver as contagens numa
 * só leitura de `ce_unlock_read`.
 */
export function useCeUnlockSituationCounts(filters: CeUnlockFilters, situations: string[], enabled = true) {
  const results = useQueries({
    queries: situations.map((situation) => {
      const f = { ...filters, situation };
      return {
        queryKey: queryKeys.ceUnlock.list("internal", f, 1),
        queryFn: () => listCeUnlockBls(f, 1),
        enabled,
      };
    }),
  });
  return Object.fromEntries(situations.map((s, i) => [s, results[i]?.data?.total ?? null])) as Record<string, number | null>;
}
