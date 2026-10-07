import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePortalScope } from "./usePortalScope";
import {
  getPortalCeUnlockModel,
  getPortalCeUnlockRequest,
  getPortalCeUnlockVip,
  listPortalCeUnlockBls,
  listPortalCeUnlockRequests,
  portalCeUnlockCommand,
} from "../services/ceUnlockService";
import { queryKeys } from "../services/queryKeys";
import { afterCeUnlockChanged } from "../services/cacheEffects";
import type { CeUnlockFilters, CeUnlockRequest } from "../types/ceUnlock";
export function usePortalCeUnlock(
  filters: CeUnlockFilters,
  page: number,
  id: string | null,
) {
  const scope = usePortalScope();
  const key = {
    mode: scope.mode,
    customerId: scope.customerId,
    authCustomer: scope.overview?.customer_id,
  };
  const client = useQueryClient();
  const list = useQuery({
    queryKey: queryKeys.ceUnlock.list(key, filters, page),
    queryFn: () => listPortalCeUnlockBls(scope, filters, page),
    refetchOnWindowFocus: "always",
  });
  const requests = useQuery({
    queryKey: ["ce-unlock", "requests", key, page],
    queryFn: () => listPortalCeUnlockRequests(scope, page),
    refetchOnWindowFocus: "always",
  });
  const vip = useQuery({
    queryKey: queryKeys.ceUnlock.vip(key),
    queryFn: () => getPortalCeUnlockVip(scope),
    refetchOnWindowFocus: "always",
  });
  const model = useQuery({
    queryKey: ["ce-unlock", "model", key],
    queryFn: () => getPortalCeUnlockModel(scope),
  });
  const detail = useQuery({
    queryKey: queryKeys.ceUnlock.request(key, id),
    queryFn: () => getPortalCeUnlockRequest(scope, id!),
    enabled: !!id,
    refetchOnWindowFocus: "always",
  });
  const command = useMutation({
    mutationFn: (input: {
      action: "draft" | "submit" | "cancel";
      payload: Record<string, unknown>;
    }) =>
      portalCeUnlockCommand<CeUnlockRequest>(
        scope,
        input.action,
        input.payload,
      ),
    onSuccess: () => afterCeUnlockChanged(client),
    onError: () => afterCeUnlockChanged(client),
  });
  return {
    scope,
    list,
    requests,
    vip,
    model,
    detail,
    command,
    refresh: () => afterCeUnlockChanged(client),
  };
}
