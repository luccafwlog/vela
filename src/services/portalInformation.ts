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
export type InformationKind = 'depot' | 'agent' | 'contact' | 'carrier' | 'notes'

/**
 * Agências que recebem o B/L original do Desbloqueio de CE (ponto 6 de
 * 2026-10-23, migration 447): contatos da Central de Informações, editados no
 * Vela em Informações do Portal → Contato. O Portal os mostra só no
 * Desbloqueio de CE, não na tela Contato.
 */
export const BL_DELIVERY_AGENCIES = [
  { key: 'entrega_bl_vitoria', port: 'Vitória' },
  { key: 'entrega_bl_salvador', port: 'Salvador' },
  { key: 'entrega_bl_suape', port: 'Suape' },
] as const

const BL_DELIVERY_KEYS: ReadonlySet<string> = new Set(BL_DELIVERY_AGENCIES.map((agency) => agency.key))

export function isBlDeliveryContact(key: string): boolean {
  return BL_DELIVERY_KEYS.has(key)
}

/** Texto que fica enquanto o endereço da agência não foi informado no Vela. */
export const BL_DELIVERY_ADDRESS_PENDING = 'Endereço a definir'

/** Marca do número do B/L no link de tracking do armador. */
export const TRACKING_BL_MARKER = '{BL}'

/**
 * Links cadastrados jamais podem executar código ou carregar credenciais. A
 * marca {BL} continua legível depois da normalização: o navegador a escreve
 * como %7BBL%7D no caminho, e só o que vem depois da origem volta a {BL}.
 */
export function externalInformationUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null
    return url.origin + url.href.slice(url.origin.length).replace(/%7BBL%7D/gi, TRACKING_BL_MARKER)
  } catch { return null }
}

/** O link de tracking abre já na consulta do B/L quando traz a marca {BL}. */
export function trackingUrlHasBlMarker(value: string | null | undefined): boolean {
  return externalInformationUrl(value)?.includes(TRACKING_BL_MARKER) ?? false
}

/**
 * Link de tracking com o número do B/L no lugar da marca. O número entra
 * codificado (não muda o endereço do site) e o resultado passa de novo pela
 * mesma validação; fora disso, nenhum link.
 */
export function trackingUrlForBl(value: string | null | undefined, bl: string): string | null {
  const template = externalInformationUrl(value)
  const number = bl.trim()
  if (!template || !number || !template.includes(TRACKING_BL_MARKER)) return null
  const url = externalInformationUrl(template.split(TRACKING_BL_MARKER).join(encodeURIComponent(number)))
  return url && new URL(url).origin === new URL(template).origin ? url : null
}

export async function portalGetInformation(scope: PortalScope = clientPortalScope): Promise<PortalInformation> {
  const data = await callPortalRpc<PortalInformation>(scope, 'portal_get_information')
  if (!data) throw new Error('Não foi possível consultar as informações do Portal.')
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
