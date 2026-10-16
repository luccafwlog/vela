import type { BadgeTone } from "../components/ui/Badge";
import type { CeUnlockItem } from "../types/ceUnlock";

export const ceStateLabel = (state: string) =>
  ({
    draft: "Rascunho",
    submitted: "Enviado",
    in_review: "Em análise",
    changes_requested: "Correção solicitada",
    cancelled: "Cancelado",
    completed: "Documentação validada",
    no_request: "Sem solicitação",
    approved: "Aprovado",
    uploaded: "Aguardando análise",
    revoked: "Revogado",
    uploading: "Upload pendente",
    not_exported: "Não exportado",
    exported: "Exportado para a ZPT",
    unlocked: "Desbloqueado na ZPT",
    divergent: "Divergente na ZPT",
  })[state] ?? state;

/** Cor do badge de cada estado de pedido, documento ou envio. */
export const ceStateTone = (state: string): BadgeTone =>
  (
    ({
      draft: "slate",
      submitted: "blue",
      in_review: "blue",
      changes_requested: "yellow",
      cancelled: "slate",
      completed: "green",
      no_request: "slate",
      approved: "green",
      uploaded: "yellow",
      revoked: "red",
      uploading: "slate",
      not_exported: "slate",
      exported: "blue",
      unlocked: "green",
      divergent: "red",
    }) as Record<string, BadgeTone>
  )[state] ?? "slate";

export const ceDocumentName = (type: string) =>
  ({ termo: "Termo de devolução", procuracao: "Procuração", model: "Modelo do termo de devolução" })[type] ??
  "Documento";

export const ceActionLabel = (action: string) =>
  ({
    draft: "Rascunho criado",
    submit: "Pedido enviado",
    review: "Documento analisado",
    delivery: "Entrega física atualizada",
    cancel: "Pedido cancelado",
    complete: "Documentação validada",
    reopen: "Validação reaberta",
    confirm: "Andamento atualizado",
    apply_vip: "Renovação VIP aplicada",
    set_vip: "Condição VIP atualizada",
    reconfirm_ce: "CE reconferido",
    export: "Planilha gerada",
    upload_termo: "Termo apresentado",
    upload_procuracao: "Procuração apresentada",
    upload_model: "Modelo disponibilizado",
    expire_draft: "Rascunho expirado por inatividade",
  })[action] ?? "Andamento atualizado";

/** Data e hora de um evento (timestamptz) no fuso da operação. */
export const ceDateTime = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      })
    : "—";

/** Tom do texto de situação (StatusText) de um documento. */
export type CeDocumentStatusTone = "default" | "warning" | "paid";

/**
 * Situação de um documento em texto (lote 3 da identidade): aguardando
 * análise, recusado e revogado em âmbar (pedem ação); "✓ Aprovado";
 * "Não enviado" em tinta normal. Concorda com o gênero do documento.
 */
export function ceDocumentStatusText(
  type: string,
  status: string | null | undefined,
): { label: string; tone: CeDocumentStatusTone } {
  const a = type === "procuracao" ? "a" : "o";
  switch (status) {
    case null:
    case undefined:
      return { label: `Não enviad${a}`, tone: "default" };
    case "uploaded":
      return { label: "Aguardando análise", tone: "warning" };
    case "approved":
      return { label: `Aprovad${a}`, tone: "paid" };
    case "changes_requested":
      return { label: `Recusad${a}`, tone: "warning" };
    case "revoked":
      return { label: `Revogad${a}`, tone: "warning" };
    case "uploading":
      return { label: "Envio em andamento", tone: "default" };
    default:
      return { label: ceStateLabel(status), tone: "default" };
  }
}

/** Data dd/mm no fuso da operação. */
export const ceShortDate = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" })
    : "";

/** Data dd/mm/aaaa no fuso da operação. */
export const ceDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";

/**
 * Impedimento que não é requisito (os quatro requisitos já têm coluna própria):
 * o texto curto da coluna "Na ZPT". Reconhece os motivos de `ce_unlock_private.item`.
 */
export function ceUnlockImpediment(reasons: string[]): string | null {
  for (const r of reasons) {
    if (r.includes("CE alterado")) return "CE alterado: reconferir";
    if (r.includes("B/L cancelado")) return "B/L cancelado";
    if (r.includes("Troca de Cliente")) return "Troca de Cliente";
    if (r.includes("Cliente do B/L alterado")) return "Cliente alterado";
  }
  return null;
}

export type CeUnlockZptItem = Pick<
  CeUnlockItem,
  "zpt_status" | "zpt_description" | "zpt_pending" | "zpt_without_export" | "reasons" | "can_export" | "export_state" | "exported_at" | "confirmed"
>;

/**
 * Texto da coluna "Na ZPT", também usado na planilha: estado da ZPT
 * (Divergente, Desbloqueado), o impedimento que não é requisito, ou o envio
 * (Exportado dd/mm, Apto não exportado, Não exportado).
 */
export function ceUnlockZptText(item: CeUnlockZptItem): {
  text: string;
  tone: "default" | "strong" | "warning" | "danger" | "muted" | "paid";
  title?: string;
} {
  if (item.zpt_status === "divergent") {
    const title = [item.zpt_description, item.zpt_pending?.length ? `Pendente na ZPT: ${item.zpt_pending.join(", ")}` : null]
      .filter(Boolean)
      .join(". ");
    return { text: "Divergente", tone: "danger", title: title || undefined };
  }
  if (item.zpt_status === "unlocked")
    return { text: "Desbloqueado", tone: "paid", title: item.zpt_without_export ? "Sem exportação pelo Vela" : undefined };
  const impediment = ceUnlockImpediment(item.reasons ?? []);
  if (impediment) return { text: impediment, tone: "warning" };
  if (item.confirmed || item.export_state === "confirmed") return { text: "Confirmação externa registrada", tone: "default" };
  if (item.export_state === "exported") return { text: `Exportado ${ceShortDate(item.exported_at)}`.trim(), tone: "default" };
  if (item.can_export) return { text: "Apto, não exportado", tone: "strong" };
  return { text: "Não exportado", tone: "muted" };
}
