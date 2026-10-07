import { supabase, supabasePortal } from "./supabase";
import { toError } from "../lib/errors";
import {
  callPortalRpc,
  isPortalReadOnly,
  type PortalScope,
} from "./portalScope";
import type {
  CeUnlockDocument,
  CeUnlockExport,
  CeUnlockFilters,
  CeUnlockItem,
  CeUnlockPage,
  CeUnlockReconcileSummary,
  CeUnlockRequest,
  CeUnlockReviewRow,
  CeUnlockVipCoverage,
} from "../types/ceUnlock";

type RpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
};
async function internalRpc<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await (supabase as unknown as RpcClient).rpc(
    name,
    args,
  );
  if (error) throw toError(error);
  return data as T;
}
export const ceUnlockRead = <T>(
  kind: string,
  payload: Record<string, unknown> = {},
) => internalRpc<T>("ce_unlock_read", { p_kind: kind, p_payload: payload });
// ponytail: backend list materializes candidate eligibility before pagination (O(n));
// move predicates/counts into an indexed read model when operational volume warrants it.
export const listCeUnlockBls = (filters: CeUnlockFilters, page: number) =>
  ceUnlockRead<CeUnlockPage<CeUnlockItem>>("bls", { filters, page });
export const listCeUnlockReviewQueue = (page: number) =>
  ceUnlockRead<CeUnlockPage<CeUnlockReviewRow>>("review_queue", { page });
export const ceUnlockReconcile = (rows: unknown[]) =>
  internalRpc<CeUnlockReconcileSummary>("ce_unlock_reconcile", { p_rows: rows });
export const getCeUnlockRequest = (id: string) =>
  ceUnlockRead<CeUnlockRequest>("request", { request_id: id });
export const getCeUnlockVip = (customerId: number) =>
  ceUnlockRead<CeUnlockVipCoverage>("vip", { customer_id: customerId });
export const ceUnlockCommand = <T>(
  action: string,
  payload: Record<string, unknown>,
) =>
  internalRpc<T>("ce_unlock_command", { p_action: action, p_payload: payload });
export const listPortalCeUnlockBls = (
  scope: PortalScope,
  filters: CeUnlockFilters,
  page: number,
) =>
  callPortalRpc<CeUnlockPage<CeUnlockItem>>(
    scope,
    "portal_list_ce_unlock_bls",
    { p_filters: filters, p_page: page },
  );
export const listPortalCeUnlockRequests = (scope: PortalScope, page: number) =>
  callPortalRpc<
    CeUnlockPage<
      Pick<CeUnlockRequest, "id" | "protocol" | "state" | "version" | "source">
    >
  >(scope, "portal_list_ce_unlock_requests", { p_filters: {}, p_page: page });
export const getPortalCeUnlockRequest = (scope: PortalScope, id: string) =>
  callPortalRpc<CeUnlockRequest>(scope, "portal_get_ce_unlock_request", {
    p_request_id: id,
  });
export const getPortalCeUnlockVip = (scope: PortalScope) =>
  callPortalRpc<CeUnlockVipCoverage>(
    scope,
    "portal_get_ce_unlock_vip_coverage",
  );
export const getPortalCeUnlockModel = (scope: PortalScope) =>
  callPortalRpc<CeUnlockDocument | null>(scope, "portal_get_ce_unlock_model");
export const portalCeUnlockCommand = <T>(
  scope: PortalScope,
  action: "draft" | "submit" | "cancel",
  payload: Record<string, unknown>,
) =>
  callPortalRpc<T>(scope, "portal_ce_unlock_command", {
    p_action: action,
    p_payload: payload,
  }).catch(error => { throw toError(error); });
export async function uploadCeUnlockDocument(
  context: Record<string, unknown>,
  file: File,
  scope?: PortalScope,
): Promise<CeUnlockDocument> {
  if (scope && isPortalReadOnly(scope))
    throw new Error("Ação indisponível em Modo Inspeção.");
  if (
    file.type !== "application/pdf" ||
    !file.name.toLowerCase().endsWith(".pdf") ||
    file.size <= 0 ||
    file.size > 10485760
  )
    throw new Error("Use PDF de até 10 MiB.");
  const form = new FormData();
  form.set("file", file);
  form.set("context", JSON.stringify(context));
  const { data, error } = await (
    scope ? supabasePortal : supabase
  ).functions.invoke("portal-ce-unlock-document", { body: form });
  if (error) throw await edgeError(error);
  return data as CeUnlockDocument;
}
async function edgeError(error: unknown): Promise<Error> {
  const context = (error as { context?: Response })?.context;
  if (context) {
    const body = await context
      .clone()
      .json()
      .catch(() => null);
    if (body?.error) return new Error(body.error);
  }
  return error instanceof Error
    ? error
    : new Error("Não foi possível concluir a ação.");
}
export async function downloadCeUnlockDocument(
  documentId: string,
  scope?: PortalScope,
): Promise<void> {
  const { data, error } = await (
    scope?.mode === "client" ? supabasePortal : supabase
  ).functions.invoke("ce-unlock-document-download", {
    body: { document_id: documentId },
  });
  if (error) throw await edgeError(error);
  // Create link after authorization; no tab is opened before an async permission check.
  const a = document.createElement("a");
  a.href = data.url;
  a.rel = "noopener";
  a.target = "_blank";
  a.click();
}
export async function downloadCeUnlockExport(payload: {
  bl_ids?: string[];
  request_key?: string;
  export_id?: string;
  reexport_of?: string;
}): Promise<void> {
  const { data, error } = await supabase.functions.invoke("ce-unlock-export", {
    body: payload,
  });
  if (error) throw await edgeError(error);
  const blob =
    data instanceof Blob
      ? data
      : new Blob([data], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "desbloqueio-ce-zpt.xlsx";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const listCeUnlockExports = () =>
  ceUnlockRead<CeUnlockExport[]>("exports");
