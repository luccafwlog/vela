// Mapa literal único dos contratos Portal cliente/inspeção + variantes ADR by_report_id.
// Fonte do dispatcher (portalScope), do teste de completude e do índice S14.
// Leitura tem wrapper portal_inspect_*; escrita nunca ganha variante; ship_schedule
// é a exceção sem escopo de cliente e mantém o nome nas duas modalidades.
export const PORTAL_READ_INSPECT_MAP = {
  portal_list_ce_unlock_bls: 'portal_inspect_list_ce_unlock_bls',
  portal_list_ce_unlock_requests: 'portal_inspect_list_ce_unlock_requests',
  portal_get_ce_unlock_request: 'portal_inspect_get_ce_unlock_request',
  portal_get_ce_unlock_vip_coverage: 'portal_inspect_get_ce_unlock_vip_coverage',
  portal_get_ce_unlock_model: 'portal_inspect_get_ce_unlock_model',
  portal_get_information: 'portal_inspect_get_information',
  portal_list_consolidatable_receivables: 'portal_inspect_list_consolidatable_receivables',
  portal_list_invoices: 'portal_inspect_list_invoices',
  portal_list_invoices_page: 'portal_inspect_list_invoices_page',
  portal_invoice_details: 'portal_inspect_invoice_details',
  portal_get_current_roe: 'portal_inspect_get_current_roe',
  portal_list_demurrage_invoices: 'portal_inspect_list_demurrage_invoices',
  portal_list_demurrage_invoices_page: 'portal_inspect_list_demurrage_invoices_page',
  portal_get_demurrage_invoice_detail: 'portal_inspect_get_demurrage_invoice_detail',
  portal_list_notifications: 'portal_inspect_list_notifications',
  portal_notification_unread_count: 'portal_inspect_notification_unread_count',
  portal_list_operation_bls: 'portal_inspect_list_operation_bls',
  portal_get_profile: 'portal_inspect_get_profile',
  portal_get_contact_configuration: 'portal_inspect_get_contact_configuration',
  portal_list_disputes: 'portal_inspect_list_disputes',
  portal_ship_schedule: 'portal_ship_schedule',
} as const

export type PortalReadContract = keyof typeof PORTAL_READ_INSPECT_MAP

export const PORTAL_WRITE_CONTRACTS = [
  'portal_ce_unlock_command',
  'portal_open_demurrage_dispute',
  'portal_add_dispute_message',
  'add_demurrage_dispute_attachment',
  'portal_request_dispute_reopen',
  'portal_update_profile',
  'portal_create_consolidation',
  'portal_obsolete_consolidation',
  'portal_mark_notification_read',
  'portal_mark_all_notifications_read',
  'portal_save_contact_configuration',
] as const

export type PortalWriteContract = (typeof PORTAL_WRITE_CONTRACTS)[number]

export type PortalContract = PortalReadContract | PortalWriteContract

// Variantes terminalizadas do ADR: mesma operação, a variante by_report_id
// acrescenta p_report_id aos argumentos do legado (voyage/port + payload).
export const REPORT_ID_RPC_VARIANTS = {
  set_agency_report_signoff: 'set_agency_report_signoff_by_report_id',
  set_agency_report_section_observation: 'set_agency_report_section_observation_by_report_id',
  set_agency_report_department_signoff: 'set_agency_report_department_signoff_by_report_id',
  close_agency_departure_report: 'close_agency_departure_report_by_report_id',
  reopen_agency_departure_report: 'reopen_agency_departure_report_by_report_id',
} as const

export type ReportLegacyRpc = keyof typeof REPORT_ID_RPC_VARIANTS
export type ReportIdRpc = (typeof REPORT_ID_RPC_VARIANTS)[ReportLegacyRpc]

export function isPortalWriteContract(name: string): name is PortalWriteContract {
  return (PORTAL_WRITE_CONTRACTS as readonly string[]).includes(name)
}

export function isPortalReadContract(name: string): name is PortalReadContract {
  return Object.hasOwn(PORTAL_READ_INSPECT_MAP, name)
}

export function resolvePortalRpcName(scopeMode: 'client' | 'inspect', name: PortalContract): string {
  if (scopeMode !== 'inspect') return name
  if (isPortalWriteContract(name)) throw new Error('Ação do cliente indisponível em Modo Inspeção.')
  if (name === 'portal_ship_schedule') return name
  return PORTAL_READ_INSPECT_MAP[name as PortalReadContract]
}
