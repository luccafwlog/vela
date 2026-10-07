import type { BadgeTone } from "../components/ui/Badge";

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
