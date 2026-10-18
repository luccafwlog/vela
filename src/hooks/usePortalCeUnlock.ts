import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePortalScope } from "./usePortalScope";
import {
  fetchAllPortalCeUnlockBls,
  getPortalCeUnlockModel,
  getPortalCeUnlockRequest,
  getPortalCeUnlockVip,
  listPortalCeUnlockRequests, fetchAllPortalCeUnlockRequests,
  portalCeUnlockCommand,
} from "../services/ceUnlockService";
import { queryKeys } from "../services/queryKeys";
import { afterCeUnlockChanged } from "../services/cacheEffects";
import type { CeUnlockRequest } from "../types/ceUnlock";
export function usePortalCeUnlock(
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
  // Página 0: o recorte inteiro do Cliente; busca, cartões e paginação ficam na tela.
  const list = useQuery({
    queryKey: queryKeys.ceUnlock.list(key, {}, 0),
    queryFn: () => fetchAllPortalCeUnlockBls(scope, {}),
    refetchOnWindowFocus: "always",
  });
  const requests = useQuery({
    queryKey: ["ce-unlock", "requests", key, page],
    queryFn: () => listPortalCeUnlockRequests(scope, page),
    refetchOnWindowFocus: "always",
  });
  // Todas as solicitações (mesma chave do Painel): a prévia da mudança de B/L
  // precisa de todos os B/Ls ativos da antiga, inclusive os que o Portal não lista.
  const allRequests = useQuery({
    queryKey: ["ce-unlock", "requests", key, "all"],
    queryFn: () => fetchAllPortalCeUnlockRequests(scope),
  });
  // "Correção pedida · reenvie a procuração": a lista não diz qual documento
  // foi recusado; o detalhe de cada solicitação em correção da página diz.
  // ponytail: uma leitura por solicitação em correção (poucas por Cliente);
  // upgrade: a lista trazer o tipo do documento recusado.
  const correctionIds = (requests.data?.items ?? []).filter((r) => r.state === "changes_requested").map((r) => r.id);
  const corrections = useQueries({
    queries: correctionIds.map((requestId) => ({
      queryKey: queryKeys.ceUnlock.request(key, requestId),
      queryFn: () => getPortalCeUnlockRequest(scope, requestId),
    })),
  });
  const correctionDetails = new Map(
    corrections.flatMap((q, n) => (q.data ? [[correctionIds[n], q.data] as const] : [])),
  );
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
    allRequests,
    correctionDetails,
    vip,
    model,
    detail,
    command,
    refresh: () => afterCeUnlockChanged(client),
  };
}
