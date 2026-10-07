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
  termo: boolean;
  procuracao: boolean;
  paid: boolean;
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
  /** Início do prazo (SLA): envio, entrega do original ou liquidação mais recente. */
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
  }>;
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
  sla_started_at: string | null;
  bl_ids: string[];
  termo_status: CeUnlockDocument["status"] | null;
  procuracao_status: CeUnlockDocument["status"] | null;
};
export type CeUnlockReconcileSummary = {
  rows: number;
  unlocked: number;
  divergent: number;
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
