import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2'
import { maskEmail, sendEmail } from './email.ts'

export { maskEmail } from './email.ts'

export type PortalEmailKind = 'convite' | 'reenvio' | 'recuperacao' | 'alteracao_email' | 'alerta_critico' | 'resumo_diario' | 'contato_bounced_notificacao'
export type SendPortalEmailInput = {
  admin: SupabaseClient
  kind: PortalEmailKind
  to: string
  subject: string
  html: string
  text: string
  idempotencyKey: string
  accountId?: number
  inviteId?: number
}

export async function sendPortalEmail(input: SendPortalEmailInput): Promise<{ ok: boolean }> {
  const { admin } = input
  return sendEmail({
    kind: input.kind,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    idempotencyKey: input.idempotencyKey,
    resendApiKey: typeof Deno !== 'undefined' ? Deno.env.get('RESEND_API_KEY') : null,
    from: typeof Deno !== 'undefined' ? Deno.env.get('PORTAL_FROM_EMAIL') : null,
    replyTo: typeof Deno !== 'undefined' ? Deno.env.get('PORTAL_REPLY_TO') : null,
    missingConfigurationMessage: 'PORTAL_FROM_EMAIL e PORTAL_REPLY_TO são obrigatórios para envio real',
    checkSuppression: async (to) => {
      const { data: suppressed } = await admin.from('portal_suppressed_emails').select('id').eq('email', to).maybeSingle()
      return { suppressed: Boolean(suppressed) }
    },
    recordAttempt: async ({ kind, to, idempotencyKey }) => {
      const { data, error } = await admin.from('portal_email_attempts').insert({
        account_id: input.accountId ?? null,
        invite_id: input.inviteId ?? null,
        kind,
        idempotency_key: idempotencyKey,
        recipient_masked: maskEmail(to),
        status: 'aceito',
      }).select('id').single()
      if (!error && data) return { id: data.id }

      // A segunda execução depois de um crash precisa reaproveitar a mesma
      // tentativa. O provider pode já ter aceito a requisição; gerar outra
      // linha quebraria a idempotência local e perderia o vínculo do evento.
      if (error?.code === '23505') {
        const { data: existing, error: lookupError } = await admin
          .from('portal_email_attempts')
          .select('id, status, provider_message_id')
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle()
        if (lookupError || !existing) throw lookupError ?? new Error('Tentativa idempotente não encontrada após conflito.')
        return {
          id: existing.id,
          status: existing.status,
          providerMessageId: existing.provider_message_id,
          existing: true,
        }
      }

      throw error ?? new Error('Não foi possível registrar a tentativa de email do Portal.')
    },
    updateAttempt: async (attemptId, update) => {
      const { error } = await admin.from('portal_email_attempts').update({
        provider_message_id: update.providerMessageId,
        retry_count: update.retryCount,
        status: update.status,
        last_error: update.lastError,
      }).eq('id', attemptId)
      if (error) throw error
    },
  })
}
