import { supabase } from './supabase'
import { callPortalRpc, clientPortalScope, type PortalScope } from './portalScope'

export type PortalDepot = {
  id: string; code: string; name: string; ports: string[]; address: string;
  opening_hours: string; emails: string[]; phones: string[];
  scheduling_url: string | null; instructions: string; restrictions: string;
  published: boolean; active: boolean; updated_at: string | null;
}
export type PortAgent = { id: string; name: string; ports: string[]; emails: string[]; active: boolean }
export type PortalContact = { key: string; title: string; description: string; emails: string[]; phones: string[]; whatsapp: string | null; address: string; active: boolean }
export type CarrierTracking = { carrier_id: number; name: string; tracking_url: string | null }
export type LocalReferenceItem = { id: number; name: string; currency: string; unit_value_brl: number | null; unit_value_usd: number | null; application_basis: string; cargo_profile: string; manual_only: boolean; applies_to_soc: boolean }
export type LocalReferenceTable = { id: number; name: string; pod: string; cargo_mode: string; valid_from: string; valid_to: string | null; items: LocalReferenceItem[] }
export type InformationDemurrageRate = { id: number; container_type: string; free_days: number; p1_day_from: number; p1_day_to: number; p1_usd: number; p2_day_from: number; p2_usd: number; valid_from: string; valid_to: string | null }
export type PortalInformation = {
  depots: PortalDepot[]; agents: PortAgent[]; contacts: PortalContact[];
  carriers: CarrierTracking[]; local_tables: LocalReferenceTable[];
  demurrage_rates: InformationDemurrageRate[]; demurrage_notes: string;
  ports: { code: string; name: string }[];
}
export type ReturnGuidance = {
  container_id: number; container_number: string; bl_id: string; pod: string;
  return_date: string | null; status: 'general' | 'specific' | 'unavailable' | 'soc';
  depots: PortalDepot[]; updated_at: string | null; reason?: string;
}
export type InformationKind = 'depot' | 'agent' | 'contact' | 'carrier' | 'notes'

/** Links cadastrados jamais podem executar código ou carregar credenciais. */
export function externalInformationUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : null
  } catch { return null }
}

export async function portalGetInformation(scope: PortalScope = clientPortalScope): Promise<PortalInformation> {
  const data = await callPortalRpc<PortalInformation>(scope, 'portal_get_information')
  if (!data) throw new Error('Não foi possível consultar as informações do Portal.')
  return data
}
export async function portalGetReturnGuidance(containerId: number, scope: PortalScope = clientPortalScope): Promise<ReturnGuidance> {
  const data = await callPortalRpc<ReturnGuidance>(scope, 'portal_get_return_guidance', { p_container_id: containerId })
  if (!data) throw new Error('Não foi possível consultar a orientação de devolução.')
  return data
}

// Os tipos gerados são protegidos; os novos contratos têm seus próprios tipos.
async function internalInformationRpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const client = supabase as unknown as { rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: T; error: unknown }> }
  const { data, error } = await client.rpc(name, args)
  if (error) throw error
  return data
}
export function internalGetPortalInformation(): Promise<PortalInformation> {
  return internalInformationRpc('internal_get_portal_information')
}
export function internalSavePortalInformation(kind: InformationKind, data: Record<string, unknown>): Promise<void> {
  return internalInformationRpc('internal_save_portal_information', { p_kind: kind, p_data: data })
}
export function internalGetReturnGuidance(containerId: number): Promise<ReturnGuidance> {
  return internalInformationRpc('internal_get_return_guidance', { p_container_id: containerId })
}
export function setContainerReturnInstruction(containerId: number, depotIds: string[], reason: string): Promise<void> {
  if (!reason.trim()) return Promise.reject(new Error('Informe a justificativa da alteração.'))
  return internalInformationRpc('set_container_return_instruction', { p_container_id: containerId, p_depot_ids: depotIds, p_reason: reason.trim() })
}
