import { supabase } from './supabase'

export type CustomerLocalChargesReadinessBl = {
  bl_id: string
  ce_mercante: string | null
  financial_status: string
  cargo_mode: string
  review_pendencies: string[]
  blocked_reasons: string[]
}

export type CustomerLocalChargesCommunicationReadiness = {
  voyage_id: number
  customer_id: number
  ready: boolean
  reason_code: string
  bl_count: number
  blocked_bl_count: number
  reasons: string[]
  bls: CustomerLocalChargesReadinessBl[]
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizeReadiness(value: unknown, voyageId: number, customerId: number): CustomerLocalChargesCommunicationReadiness {
  const row = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const bls = Array.isArray(row.bls)
    ? row.bls.map((item) => {
      const bl = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
      return {
        bl_id: String(bl.bl_id ?? ''),
        ce_mercante: typeof bl.ce_mercante === 'string' ? bl.ce_mercante : null,
        financial_status: String(bl.financial_status ?? 'pending'),
        cargo_mode: String(bl.cargo_mode ?? 'container'),
        review_pendencies: asStringArray(bl.review_pendencies),
        blocked_reasons: asStringArray(bl.blocked_reasons),
      }
    }).filter((bl) => Boolean(bl.bl_id))
    : []

  return {
    voyage_id: Number(row.voyage_id ?? voyageId),
    customer_id: Number(row.customer_id ?? customerId),
    ready: row.ready === true,
    reason_code: String(row.reason_code ?? (bls.length ? 'readiness_blocked' : 'no_bls')),
    bl_count: Number(row.bl_count ?? bls.length),
    blocked_bl_count: Number(row.blocked_bl_count ?? bls.filter((bl) => bl.blocked_reasons.length).length),
    reasons: asStringArray(row.reasons),
    bls,
  }
}

export async function fetchCustomerLocalChargesCommunicationReadiness(
  voyageId: number,
  customerId: number,
): Promise<CustomerLocalChargesCommunicationReadiness> {
  const { data, error } = await supabase.rpc('customer_local_charges_communication_readiness', {
    p_voyage_id: voyageId,
    p_customer_id: customerId,
  })
  if (error) throw error
  return normalizeReadiness(data, voyageId, customerId)
}

export function customerCommunicationReadinessReasonLabel(reason: string): string {
  if (reason === 'ce_mercante_ausente') return 'CE Mercante ausente'
  if (reason === 'revisao_pendente') return 'Revisão do B/L pendente'
  if (reason === 'peso_bb_ausente') return 'Peso de carga solta ausente'
  if (reason === 'faturamento_pendente') return 'Faturamento ainda não concluído'
  if (reason === 'no_bls') return 'Nenhum B/L ativo para este cliente na viagem'
  if (reason === 'sem_cliente') return 'B/L sem Cliente cadastrado'
  if (reason === 'sem_viagem') return 'B/L sem Viagem'
  return reason || 'Prontidão financeira incompleta'
}
