import { supabase } from './supabase'
import type { Database } from '../types/database'

// Liberação de faturamento sem Portal (migrations 083/084, ADR 0070).
export type BillingPortalRelease = Pick<
  Database['public']['Tables']['customer_billing_portal_releases']['Row'],
  'id' | 'customer_id' | 'justification' | 'granted_by' | 'granted_at' | 'review_at' | 'revoked_at' | 'revoked_by' | 'revoke_reason'
>

export type BillingPortalReleaseReprocess = {
  customer_id: number
  gate_open: boolean
  issued: number
  blocked: number
  failed: number
}

export type BillingPortalReleaseState = 'vigente' | 'vencida' | 'revogada'

export function billingPortalReleaseState(release: BillingPortalRelease, now = new Date()): BillingPortalReleaseState {
  if (release.revoked_at) return 'revogada'
  return new Date(release.review_at).getTime() > now.getTime() ? 'vigente' : 'vencida'
}

/** A liberação mais recente do Cliente, vigente ou não; `null` se nunca houve. */
export async function fetchLatestBillingPortalRelease(customerId: number): Promise<BillingPortalRelease | null> {
  const { data, error } = await supabase
    .from('customer_billing_portal_releases')
    .select('id, customer_id, justification, granted_by, granted_at, review_at, revoked_at, revoked_by, revoke_reason')
    .eq('customer_id', customerId)
    .order('granted_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return data?.[0] ?? null
}

/** Data de revisão (yyyy-mm-dd) vira o fim daquele dia no horário de Brasília. */
export function reviewDateToTimestamp(date: string): string {
  return `${date}T23:59:59-03:00`
}

export async function grantBillingPortalRelease(input: { customerId: number; justification: string; reviewDate: string }) {
  const { data, error } = await supabase.rpc('grant_customer_billing_portal_release', {
    p_customer_id: input.customerId,
    p_justification: input.justification.trim(),
    p_review_at: reviewDateToTimestamp(input.reviewDate),
  })
  if (error) throw error
  if (!data) throw new Error('A liberação não retornou confirmação.')
  return data as unknown as { release_id: number; reprocess: BillingPortalReleaseReprocess }
}

export async function revokeBillingPortalRelease(input: { customerId: number; reason: string }) {
  const { error } = await supabase.rpc('revoke_customer_billing_portal_release', {
    p_customer_id: input.customerId,
    p_reason: input.reason.trim(),
  })
  if (error) throw error
}
