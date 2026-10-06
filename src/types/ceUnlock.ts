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
  export_state: string;
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
