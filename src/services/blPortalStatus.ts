import { z } from 'zod'
import { supabase } from './supabase'

/**
 * `visible`: o Cliente vê o B/L (CE Mercante, Cliente vinculado e conta do Portal
 * ativa). `billingReady`: Portal pronto para faturar (conta ativa, acesso criado e
 * e-mail de recuperação válido e entregável). São coisas diferentes (POR-D12):
 * com o e-mail de recuperação devolvido o Cliente entra e vê o B/L, mas a fatura
 * fica retida. `accountSituation` decide se o convite é aceito.
 */
export type BlPortalVisibility = { visible: boolean; reasons: string[]; billingReady: boolean; accountSituation: string | null }

/** Situações em que o servidor aceita o convite (Edge `portal-invite-send`). */
export const PORTAL_INVITE_SITUATIONS = ['sem_conta', 'convite_pendente', 'convite_expirado', 'falha_no_envio'] as const

export function computeBlPortalVisibility(input: {
  ceMercante: string | null
  customerId: number | null
  accountSituation?: string | null
  portalAccessReady?: boolean | null
}): BlPortalVisibility {
  const reasons: string[] = []
  if (!input.ceMercante?.trim()) reasons.push('Sem CE Mercante')
  if (input.customerId == null) reasons.push('Sem cliente vinculado')
  if (input.accountSituation !== 'ativo') reasons.push('Conta do Portal não está ativa')
  return {
    visible: reasons.length === 0,
    reasons,
    billingReady: input.accountSituation === 'ativo' && input.portalAccessReady === true,
    accountSituation: input.accountSituation ?? null,
  }
}

export type BlPortalNotification = { id: number; type: string; title: string; created_at: string; read_at: string | null }

const blPortalStatusSchema = z.object({
  ce_mercante: z.string().nullable(),
  customer_id: z.number().nullable(),
  account_situation: z.string().nullable(),
  portal_access_ready: z.boolean().nullable().optional(),
  notifications: z.array(z.object({
    id: z.number(),
    type: z.string(),
    title: z.string(),
    created_at: z.string(),
    read_at: z.string().nullable(),
  })).default([]),
  open_disputes: z.array(z.object({
    id: z.number(),
    doc_number: z.string().nullable(),
    dispute_status: z.string().nullable(),
  })).default([]),
})

export async function getBlPortalStatus(input: { blId: string; ceMercante: string | null; customerId: number | null }) {
  // O Portal mantém notifications/accounts protegidas por RLS; a leitura interna
  // passa pelo RPC SECURITY DEFINER, que valida o usuário e escopa pelo B/L.
  const { data, error } = await supabase.rpc('get_bl_portal_status', { p_bl_id: input.blId })
  if (error) throw error
  const result = blPortalStatusSchema.parse(data)
  return {
    visibility: computeBlPortalVisibility({
      ceMercante: result.ce_mercante,
      customerId: result.customer_id,
      accountSituation: result.account_situation,
      portalAccessReady: result.portal_access_ready ?? null,
    }),
    notifications: result.notifications ?? [],
    openDisputes: result.open_disputes ?? [],
  }
}
