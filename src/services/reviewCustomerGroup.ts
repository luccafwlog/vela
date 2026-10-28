import { canonicalizeValidCnpj } from '../lib/cnpj'
import { classifyDbError } from '../lib/errors'
import { ConcurrentEditError } from './review'
import { sendPortalInvite } from './portalProvisioning'
import { supabase } from './supabase'

type UntypedRpc = { rpc: (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }> }

export type CompleteReviewCustomerGroupInput = {
  blIds: string[]
  customerId: number | null
  cnpjCpf: string
  name: string
  email: string
  changedBy: string
  sendPortalInvite?: boolean
}

export type ReviewCustomerGroupResult = {
  customer: { id: number; cnpj_cpf: string; name: string }
  bls: Array<{ blId: string; reviewStatus: string | null; pendencias: string[]; resolved: boolean }>
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export async function completeReviewCustomerGroup(input: CompleteReviewCustomerGroupInput): Promise<ReviewCustomerGroupResult> {
  const cnpjCpf = canonicalizeValidCnpj(input.cnpjCpf)
  const email = normalizeEmail(input.email)
  if (!cnpjCpf) throw new Error('Informe um CNPJ válido antes de vincular o grupo.')
  if (!input.name.trim()) throw new Error('Informe a razão social do cliente.')
  // Sem e-mail: quem não edita contatos cadastra só o Cliente (D10 de 2026-10-27).
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe um e-mail válido para o cliente.')
  if (!input.blIds.length) throw new Error('Nenhum B/L informado para o grupo.')

  const { data, error } = await (supabase as unknown as UntypedRpc).rpc('complete_review_customer_group', {
    p_bl_ids: input.blIds,
    p_customer_id: input.customerId,
    p_cnpj_cpf: cnpjCpf,
    p_name: input.name.trim(),
    p_email: email || null,
    p_changed_by: input.changedBy,
  })
  if (error) {
    const message = error.message ?? ''
    const isConcurrentConflict = error.code === '40001' || (error.code === 'PT409' && /grupo alterado|não estão mais pendentes|foi alterado por outro usuário/i.test(message))
    if (isConcurrentConflict) throw new ConcurrentEditError(message || 'O grupo foi alterado por outro usuário.')
    const classified = classifyDbError(error)
    throw Object.assign(new Error(message || classified.message), { code: error.code })
  }

  const payload = (data ?? {}) as { customer?: { id?: number; cnpj_cpf?: string; name?: string }; bls?: Array<{ bl_id?: string; review_status?: string | null; pendencias?: unknown; resolved?: boolean }> }
  if (!payload.customer?.id || !payload.customer.cnpj_cpf || !payload.customer.name) throw new Error('Resposta inválida do onboarding da revisão.')
  return {
    customer: { id: payload.customer.id, cnpj_cpf: payload.customer.cnpj_cpf, name: payload.customer.name },
    bls: (payload.bls ?? []).map((bl) => ({ blId: bl.bl_id ?? '', reviewStatus: bl.review_status ?? null, pendencias: Array.isArray(bl.pendencias) ? bl.pendencias.map(String) : [], resolved: Boolean(bl.resolved) })),
  }
}

export async function sendReviewPortalInvite(customerId: number, email: string): Promise<void> {
  await sendPortalInvite(customerId, normalizeEmail(email), 'informado_manualmente')
}
