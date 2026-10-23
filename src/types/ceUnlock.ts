export type CeDocumentType = "termo" | "procuracao" | "model";
export type CeUnlockDocument = {
  id: string;
  version: number;
  customer_id: number | null;
  request_id: string | null;
  type: CeDocumentType;
  source: "request" | "vip_annual" | "model";
  status:
    "uploaded" | "approved" | "changes_requested" | "revoked" | "uploading";
  file_name: string;
  size_bytes: number;
  valid_from: string | null;
  valid_until: string | null;
  coverage_year: number | null;
  reason: string | null;
  created_at: string;
  /** Arquivo já removido do Storage pelo expurgo (migration 282); metadados ficam. */
  purged?: boolean;
  /** Expurgo reivindicou o arquivo e ainda não confirmou a remoção (migration 282); download recusado. */
  cleanup_pending?: boolean;
};
export type CeUnlockItem = {
  bl_id: string;
  ce_mercante: string | null;
  customer_id: number;
  customer_name: string;
  cnpj_cpf: string;
  voyage_id: number;
  voyage_number: string;
  vessel_name: string;
  pod: string | null;
  request_id: string | null;
  protocol: string | null;
  requested_at?: string | null;
  state: string;
  version: number;
  vip: boolean;
  /**
   * O termo e a procuração anuais vigentes cobrem este B/L: ele foi importado no
   * Vela dentro da vigência deles (migration 449). Sem isso, a solicitação segue
   * com termo e procuração anexados a ela.
   */
  vip_covered?: boolean;
  termo: boolean;
  procuracao: boolean;
  paid: boolean;
  /** B/L com Taxas Locais isentas: requisito atendido sem pagamento (migration 279). */
  paid_exempt?: boolean;
  /** Só no Portal (migration 298): taxas ainda sem fatura visível ao Cliente. */
  local_charges_awaiting_invoice?: boolean;
  delivered: boolean;
  can_submit: boolean;
  can_export: boolean;
  confirmed: boolean;
  /** Só o desk recebe: o Portal nunca vê envio nem conciliação com a ZPT. */
  export_state?: "not_exported" | "exported" | "confirmed";
  exported_at?: string | null;
  zpt_status?: "unlocked" | "divergent" | null;
  zpt_description?: string | null;
  zpt_pending?: string[] | null;
  zpt_updated_at?: string | null;
  zpt_without_export?: boolean | null;
  /** Início do prazo (SLA): só com os quatro requisitos; o último fato que os completou (migration 448). */
  sla_started_at?: string | null;
  reasons: string[];
  source: "request" | "vip_annual";
  delivery_version: number;
};
export type CeUnlockRequest = {
  id: string;
  protocol: string;
  state: string;
  version: number;
  source: "request" | "vip_annual";
  customer_name?: string;
  items: CeUnlockItem[];
  documents: CeUnlockDocument[];
  confirmation_records?: Array<{ bl_id: string; ce_mercante: string; reference: string; confirmed_at: string }>;
  events: Array<{
    id: number;
    action: string;
    reason: string | null;
    created_at: string;
    /** Quem fez (migration 296): nome do usuário interno, "Cliente pelo Portal" ou "Sistema". Só no detalhe interno. */
    actor?: string | null;
  }>;
};
/** Linha de "Minhas solicitações" no Portal (migration 299). */
export type CePortalRequestRow = Pick<CeUnlockRequest, "id" | "protocol" | "state" | "version" | "source"> & {
  created_at: string;
  /** B/Ls da solicitação; na cancelada, os que ela tinha. */
  bl_ids: string[];
  /** Início do prazo para desbloqueio; nulo no rascunho e na cancelada. */
  sla_started_at: string | null;
};
/** Linha da aba Solicitações: um pedido com termo de devolução/procuração a validar. */
export type CeUnlockReviewRow = {
  id: string;
  protocol: string;
  state: string;
  version: number;
  created_at: string;
  customer_name: string;
  cnpj_cpf: string;
  /** Hora do último envio pelo Cliente; a fila segue por ela (migration 448). */
  submitted_at?: string | null;
  /** Prazo: só com os quatro requisitos, então nulo enquanto há documento a analisar (448). */
  sla_started_at: string | null;
  bl_ids: string[];
  termo_status: CeUnlockDocument["status"] | null;
  procuracao_status: CeUnlockDocument["status"] | null;
};
export type CeUnlockReconcileSummary = {
  rows: number;
  unlocked: number;
  divergent: number;
  /** Bloqueado na ZPT com Data Atualização anterior à exportação: ainda não reflete o envio. */
  stale: number;
  ignored: number;
  unknown_ce: number;
};
export type CeUnlockVipCoverage = {
  customer_id: number;
  enabled: boolean;
  version: number;
  documents: CeUnlockDocument[];
  termo: boolean;
  procuracao: boolean;
};
export type CeUnlockFilters = {
  search?: string;
  customer_id?: number;
  voyage_id?: number;
  pod?: string;
  situation?: string;
  pending_requirement?: string;
};
export type CeUnlockPage<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};
export type CeUnlockExport = {
  id: string;
  rows: Array<{
    bl_id: string;
    termo: boolean;
    procuracao: boolean;
    delivered: boolean;
    paid: boolean;
  }>;
  layout_version: string;
  created_at: string;
  sent_at: string | null;
  reference: string | null;
  hash?: string;
};
