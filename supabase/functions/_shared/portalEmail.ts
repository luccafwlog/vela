import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2'
import { maskEmail, sendEmail } from './email.ts'

export { maskEmail } from './email.ts'

export type PortalEmailKind = 'convite' | 'reenvio' | 'recuperacao' | 'alteracao_email' | 'alerta_critico' | 'resumo_diario' | 'contato_bounced_notificacao' | 'ce_unlock_notificacao' | 'senha_alterada'
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
  /**
   * Chave de envio desligada: redireciona ao suporte (ver `sendEmail`). Sem
   * valor, e-mail de Cliente lê a chave aqui; e-mail da equipe nunca redireciona.
   */
  simulate?: boolean
}

// E-mail para a própria equipe não passa pela chave de envio (ADR 0104).
const INTERNAL_KINDS: ReadonlySet<PortalEmailKind> = new Set(['resumo_diario', 'alerta_critico'])

/**
 * Chave de envio desligada? Erro na leitura conta como desligada: o e-mail vai
 * ao suporte em vez de arriscar sair para o Cliente num teste.
 */
export async function communicationsSwitchOff(admin: SupabaseClient): Promise<boolean> {
  const { data, error } = await admin.from('app_settings').select('communications_enabled').eq('id', 1).maybeSingle()
  if (error) {
    console.error('[portalEmail] falha ao ler a chave de envio; e-mail redirecionado ao suporte', error)
    return true
  }
  return !(data as { communications_enabled?: boolean } | null)?.communications_enabled
}

/**
 * `suppressed`: o endereço está na supressão do Portal (nenhuma tentativa é
 * registrada) ou o provedor o recusou como suprimido (422
 * `all_recipients_suppressed`: a tentativa fica `bounce` e o endereço entra em
 * `portal_suppressed_emails`). Nos dois casos não é falha do envio.
 */
export async function sendPortalEmail(input: SendPortalEmailInput): Promise<{ ok: boolean; suppressed: boolean }> {
  const { admin } = input
  let suppressedAddress = false
  const simulate = input.simulate ?? (INTERNAL_KINDS.has(input.kind) ? false : await communicationsSwitchOff(admin))
  const result = await sendEmail({
    kind: input.kind,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    idempotencyKey: input.idempotencyKey,
    resendApiKey: typeof Deno !== 'undefined' ? Deno.env.get('RESEND_API_KEY') : null,
    from: typeof Deno !== 'undefined' ? Deno.env.get('PORTAL_FROM_EMAIL') : null,
    replyTo: typeof Deno !== 'undefined' ? Deno.env.get('PORTAL_REPLY_TO') : null,
    simulate,
    missingConfigurationMessage: 'PORTAL_FROM_EMAIL e PORTAL_REPLY_TO são obrigatórios para envio real',
    checkSuppression: async (to) => {
      // Erro na consulta não libera o envio: sem a resposta, o endereço pode
      // estar suprimido. A exceção vira nova tentativa no chamador.
      const { data: suppressed, error } = await admin.from('portal_suppressed_emails').select('id').eq('email', to).maybeSingle()
      if (error) throw error
      suppressedAddress = Boolean(suppressed)
      return { suppressed: suppressedAddress }
    },
    // A próxima rodada para na consulta acima, sem chamar o provedor.
    // ponytail: grava só a supressão. O bounce que chega pelo webhook
    // (process_portal_email_event) também marca o Email de Recuperação da conta
    // e repara as caixas de contato do Cliente; aqui isso não roda, e a
    // supressão do provedor por reclamação também vira `bounce_permanente`.
    // Upgrade: RPC server-only com o mesmo efeito do bounce permanente do webhook.
    recordProviderSuppression: async (to) => {
      const { error } = await admin.from('portal_suppressed_emails')
        .upsert({ email: to.trim().toLowerCase(), reason: 'bounce_permanente' }, { onConflict: 'email', ignoreDuplicates: true })
      if (error) throw error
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
      if (!error && data) return { id: data.id, status: 'aceito' }

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
  return { ok: result.ok, suppressed: suppressedAddress || result.suppressed === true }
}
