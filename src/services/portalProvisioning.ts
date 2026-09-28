import { z } from 'zod'
import { supabase } from './supabase'

export type ProvisioningDecision = 'aguardando_analise' | 'aprovado_para_provisionar'
export type AccountSituation = 'sem_conta' | 'convite_pendente' | 'convite_expirado' | 'falha_no_envio' | 'ativo' | 'suspenso'
export type RecoveryEmailSource = 'candidato' | 'informado_manualmente'
export type PortalDeliveryStatus = 'aceito' | 'nao_confirmado' | 'entregue' | 'bounce' | 'complaint' | 'falha_transitoria' | 'falha_permanente'
// Saúde do Email de Recuperação, independente de `account_situation`: uma conta
// pode estar `ativo` (o cliente entra com a senha) e ainda assim ter o endereço
// de recuperação morto.
export type RecoveryEmailStatus = 'ok' | 'bounce_permanente' | 'complaint'

export type PortalProvisioningRow = {
  account_id: number
  customer_id: number
  customer_name: string
  cnpj_cpf: string
  provisioning_decision: ProvisioningDecision
  account_situation: AccountSituation
  recovery_email: string | null
  recovery_email_source: RecoveryEmailSource | null
  pending_invite_expires_at: string | null
}

export type EmailCandidate = {
  email: string
  purpose: 'geral' | 'financeiro' | 'operacional' | 'faturamento'
  origin: string
}

export type QueueRow = PortalProvisioningRow & {
  recoveryEmailStatus: RecoveryEmailStatus | null
  recoveryEmailSuppressed: boolean
  hasCriticalAlert: boolean
  hasOpenInvoice: boolean
  hasActiveProcess: boolean
  lastActivityAt: string | null
  candidates: EmailCandidate[]
  sharedEmailCount: number
  latestDeliveryStatus: PortalDeliveryStatus | null
}

export async function sendPortalInvite(customerId: number, recoveryEmail: string, source: RecoveryEmailSource = 'informado_manualmente') {
  const { error } = await supabase.functions.invoke('portal-invite-send', {
    body: { customer_id: customerId, recovery_email: recoveryEmail.trim().toLowerCase(), recovery_email_source: source },
  })
  if (error) throw error
}

export type PortalProvisioningConsolePayload = {
  account_id: number
  customer_id: number
  customer_name: string
  cnpj_cpf: string
  provisioning_decision: ProvisioningDecision
  account_situation: AccountSituation
  recovery_email: string | null
  recovery_email_source: RecoveryEmailSource | null
  pending_invite_expires_at: string | null
  recovery_email_status: RecoveryEmailStatus | null
  recovery_email_suppressed: boolean
  latest_delivery_status: PortalDeliveryStatus | null
  last_event_at: string | null
  has_critical_alert: boolean
  has_open_invoice: boolean
  has_active_process: boolean
  candidates: EmailCandidate[]
  shared_email_count: number
}

const portalProvisioningConsolePayloadSchema: z.ZodType<PortalProvisioningConsolePayload> = z.object({
  account_id: z.number(),
  customer_id: z.number(),
  customer_name: z.string(),
  cnpj_cpf: z.string(),
  provisioning_decision: z.enum(['aguardando_analise', 'aprovado_para_provisionar']),
  account_situation: z.enum(['sem_conta', 'convite_pendente', 'convite_expirado', 'falha_no_envio', 'ativo', 'suspenso']),
  recovery_email: z.string().nullable(),
  recovery_email_source: z.enum(['candidato', 'informado_manualmente']).nullable(),
  pending_invite_expires_at: z.string().nullable(),
  // Exigidas: WORKFLOW §5 manda aplicar as migrations pendentes antes de
  // publicar o frontend dependente, então a RPC já responde com as duas quando
  // este bundle sobe. Tolerar a ausência aqui esconderia justamente o deploy
  // fora de ordem que a regra existe para impedir.
  recovery_email_status: z.enum(['ok', 'bounce_permanente', 'complaint']).nullable(),
  recovery_email_suppressed: z.boolean(),
  latest_delivery_status: z.enum(['aceito', 'nao_confirmado', 'entregue', 'bounce', 'complaint', 'falha_transitoria', 'falha_permanente']).nullable(),
  last_event_at: z.string().nullable(),
  has_critical_alert: z.boolean(),
  has_open_invoice: z.boolean(),
  has_active_process: z.boolean(),
  candidates: z.array(z.object({
    email: z.string(),
    purpose: z.enum(['geral', 'financeiro', 'operacional', 'faturamento']),
    origin: z.string(),
  })),
  shared_email_count: z.number(),
})

export function effectiveSituation(situation: AccountSituation, pendingInviteExpiresAt: string | null): AccountSituation {
  if (situation === 'convite_pendente' && pendingInviteExpiresAt && new Date(pendingInviteExpiresAt).getTime() < Date.now()) return 'convite_expirado'
  return situation
}

export function comparePriority(a: QueueRow, b: QueueRow): number {
  const rank = (row: QueueRow): number => {
    if (row.hasCriticalAlert) return 0
    if (row.hasOpenInvoice) return 1
    if (row.hasActiveProcess) return 2
    if (row.lastActivityAt) return 3
    return 4
  }
  const difference = rank(a) - rank(b)
  if (difference !== 0) return difference
  return (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '')
}

export async function listPortalProvisioningQueue(customerId?: number): Promise<QueueRow[]> {
  const { data, error } = await supabase.rpc(
    'portal_list_provisioning_console',
    customerId == null ? {} : { p_customer_id: customerId },
  )
  if (error) throw error
  const parsed = z.array(portalProvisioningConsolePayloadSchema).safeParse(data ?? [])
  if (!parsed.success) throw new Error('Resposta inválida de portal_list_provisioning_console.')
  return parsed.data.map((row) => ({
    account_id: row.account_id,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    cnpj_cpf: row.cnpj_cpf,
    provisioning_decision: row.provisioning_decision,
    account_situation: effectiveSituation(row.account_situation, row.pending_invite_expires_at),
    recovery_email: row.recovery_email,
    recovery_email_source: row.recovery_email_source,
    pending_invite_expires_at: row.pending_invite_expires_at,
    recoveryEmailStatus: row.recovery_email_status,
    recoveryEmailSuppressed: row.recovery_email_suppressed,
    hasCriticalAlert: row.has_critical_alert,
    hasOpenInvoice: row.has_open_invoice,
    hasActiveProcess: row.has_active_process,
    lastActivityAt: row.last_event_at,
    candidates: row.candidates ?? [],
    sharedEmailCount: row.shared_email_count ?? 0,
    latestDeliveryStatus: row.latest_delivery_status,
  })).sort(comparePriority)
}

export async function listPortalProvisioningEvents(customerId: number, limit = 10) {
  const { data, error } = await supabase.rpc('portal_list_provisioning_events', { p_customer_id: customerId, p_limit: limit })
  if (error) throw error
  return data ?? []
}

export async function returnToAnalysis(customerId: number, reason: string) {
  const { error } = await supabase.rpc('portal_return_to_analysis', { p_customer_id: customerId, p_reason: reason })
  if (error) throw error
}

// A RPC nasceu na migration 302 e ainda não consta dos tipos gerados; mesmo
// caminho de `portal_open_inspection` em src/services/portalScope.ts.
type UntypedRpc = { rpc: (rpc: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }

export async function releaseSuppressedEmail(customerId: number, email: string, reason: string) {
  const { error } = await (supabase as unknown as UntypedRpc).rpc('portal_release_suppressed_email', { p_customer_id: customerId, p_email: email, p_reason: reason })
  if (error) throw error
}
