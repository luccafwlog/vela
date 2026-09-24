import { supabase } from './supabase'

// Liberação de faturamento sem Portal (migration 083, ADR 0070). A tabela e as
// RPCs ainda não estão no bloco gerado de src/types/database.ts: a regeneração
// depende do CLI do Supabase. Os tipos abaixo espelham a migration.
export type BillingPortalRelease = {
  id: number
  customer_id: number
  justification: string
  granted_by: string
  granted_at: string
  review_at: string
  revoked_at: string | null
  revoked_by: string | null
  revoke_reason: string | null
}

export type BillingPortalReleaseReprocess = {
  customer_id: number
  gate_open: boolean
  issued: number
  blocked: number
  failed: number
}

type RpcResult<T> = Promise<{ data: T | null; error: Error | null }>

const releaseClient = supabase as unknown as {
  from: (table: 'customer_billing_portal_releases') => {
    select: (columns: string) => {
      eq: (column: 'customer_id', value: number) => {
        order: (column: 'granted_at', options: { ascending: boolean }) => {
          limit: (count: number) => RpcResult<BillingPortalRelease[]>
        }
      }
    }
  }
  rpc: {
    (fn: 'grant_customer_billing_portal_release', args: { p_customer_id: number; p_justification: string; p_review_at: string }): RpcResult<{ release_id: number; reprocess: BillingPortalReleaseReprocess }>
    (fn: 'revoke_customer_billing_portal_release', args: { p_customer_id: number; p_reason: string }): RpcResult<{ release_id: number; revoked: boolean }>
  }
}

export type BillingPortalReleaseState = 'vigente' | 'vencida' | 'revogada'

export function billingPortalReleaseState(release: BillingPortalRelease, now = new Date()): BillingPortalReleaseState {
  if (release.revoked_at) return 'revogada'
  return new Date(release.review_at).getTime() > now.getTime() ? 'vigente' : 'vencida'
}

/** A liberação mais recente do Cliente, vigente ou não; `null` se nunca houve. */
export async function fetchLatestBillingPortalRelease(customerId: number): Promise<BillingPortalRelease | null> {
  const { data, error } = await releaseClient
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
  const { data, error } = await releaseClient.rpc('grant_customer_billing_portal_release', {
    p_customer_id: input.customerId,
    p_justification: input.justification.trim(),
    p_review_at: reviewDateToTimestamp(input.reviewDate),
  })
  if (error) throw error
  if (!data) throw new Error('A liberação não retornou confirmação.')
  return data
}

export async function revokeBillingPortalRelease(input: { customerId: number; reason: string }) {
  const { error } = await releaseClient.rpc('revoke_customer_billing_portal_release', {
    p_customer_id: input.customerId,
    p_reason: input.reason.trim(),
  })
  if (error) throw error
}
