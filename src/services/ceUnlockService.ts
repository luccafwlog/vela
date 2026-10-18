import { supabase, supabasePortal } from "./supabase";
import { toError } from "../lib/errors";
import {
  callPortalRpc,
  isPortalReadOnly,
  type PortalScope,
} from "./portalScope";
import type {
  CePortalRequestRow,
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
/** Recorte inteiro (todas as páginas) para a planilha comum da aba Andamento dos B/Ls. */
// ponytail: a planilha comum lê o recorte na paginação da tela (25 por página), quatro páginas por vez;
// cada página recalcula a situação de todos os B/Ls com CE no banco, então o custo é O(páginas × B/Ls).
// Um B/L que muda de posição entre páginas sai uma vez só (dedupe por B/L). Upgrade: uma leitura
// própria da exportação no `ce_unlock_read`, sem paginação.
export const fetchAllCeUnlockBls = (filters: CeUnlockFilters): Promise<CeUnlockItem[]> =>
  readAllCeUnlockPages((page) => listCeUnlockBls(filters, page));
async function readAllCeUnlockPages(read: (page: number) => Promise<CeUnlockPage<CeUnlockItem> | null>): Promise<CeUnlockItem[]> {
  const first = await read(1);
  if (!first) return [];
  const pages = Math.ceil(first.total / (first.page_size || 25));
  const byBl = new Map(first.items.map((i) => [i.bl_id, i]));
  for (let start = 2; start <= pages; start += 4) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(4, pages - start + 1) }, (_, n) => read(start + n)),
    );
    for (const result of batch) for (const i of result?.items ?? []) if (!byBl.has(i.bl_id)) byBl.set(i.bl_id, i);
  }
  return [...byBl.values()];
}
export const listCeUnlockReviewQueue = (page: number) =>
  ceUnlockRead<CeUnlockPage<CeUnlockReviewRow>>("review_queue", { page });
/** Solicitações de um Cliente, em todos os estados (migration 224), para a ficha do Cliente. */
export const listCustomerCeUnlockRequests = (customerId: number, blSearch: string, page: number) =>
  internalRpc<CeUnlockPage<CeUnlockReviewRow>>("ce_unlock_customer_requests", {
    p_customer_id: customerId,
    p_bl_search: blSearch.trim() || null,
    p_page: page,
  });
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
/**
 * Todos os B/Ls com CE do Cliente, para os cartões que contam e filtram a Nova
 * solicitação e para a confirmação de B/L que muda de solicitação.
 */
// ponytail: lê as páginas do Portal (25 por página, quatro por vez) e a tela
// conta, filtra e pagina no navegador; cada página recalcula todos os B/Ls do
// Cliente no banco, então o custo é O(páginas × B/Ls). Upgrade: contagens e
// filtros dos cartões no próprio `portal_list_ce_unlock_bls`.
export const fetchAllPortalCeUnlockBls = (scope: PortalScope, filters: CeUnlockFilters): Promise<CeUnlockItem[]> =>
  readAllCeUnlockPages((page) => listPortalCeUnlockBls(scope, filters, page));
export const listPortalCeUnlockRequests = (scope: PortalScope, page: number) =>
  callPortalRpc<CeUnlockPage<CePortalRequestRow>>(scope, "portal_list_ce_unlock_requests", { p_filters: {}, p_page: page });
// ponytail: a lista do Portal é paginada (25 por página) e não filtra por
// situação; quem precisa de todas (Painel, prévia da mudança de B/L) lê todas
// as páginas. Upgrade: contagem e B/Ls por solicitação no próprio RPC.
export async function fetchAllPortalCeUnlockRequests(scope: PortalScope): Promise<CePortalRequestRow[]> {
  const first = await listPortalCeUnlockRequests(scope, 1);
  if (!first) return [];
  const pages = Math.ceil(first.total / (first.page_size || 25));
  const rest = await Promise.all(Array.from({ length: Math.max(pages - 1, 0) }, (_, index) => listPortalCeUnlockRequests(scope, index + 2)));
  return [first, ...rest].flatMap((page) => page?.items ?? []);
}
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
  // O modelo do desk é DOCX (o cliente preenche); todo anexo do cliente é PDF. A função revalida o conteúdo.
  const model = context.source === "model";
  if (file.size > 10485760)
    throw new Error(model ? "Use o modelo em DOCX de até 10 MiB." : "O arquivo passa de 10 MiB. Envie um PDF menor.");
  if (
    !file.name.toLowerCase().endsWith(model ? ".docx" : ".pdf") ||
    (!model && file.type !== "application/pdf") ||
    file.size <= 0
  )
    throw new Error(model ? "Use o modelo em DOCX de até 10 MiB." : "O arquivo não é um PDF. Salve o documento como PDF antes de anexar.");
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
