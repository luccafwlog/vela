import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ceUnlockCommand,
  getCeUnlockRequest,
  listCeUnlockBls,
  listCeUnlockReviewQueue,
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
export function useCeUnlockRequest(id: string | null) {
  return useQuery({
    queryKey: queryKeys.ceUnlock.request("internal", id),
    queryFn: () => getCeUnlockRequest(id!),
    enabled: !!id,
    refetchOnWindowFocus: "always",
  });
}
