import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2'
import { hashToken } from '../_shared/portalToken.ts'
import { revokePortalSessions } from '../_shared/revokePortalSessions.ts'
import { resetPortalPasswordFailClosed } from '../_shared/portalPasswordResetFlow.ts'
import { withCors } from '../_shared/cors.ts'
import { PASSWORD_RULE_MESSAGE, isValidPassword } from '../_shared/passwordPolicy.ts'
import { derivePortalAuthPassword, portalPasswordPepper } from '../_shared/portalPasswordSecret.ts'
if (typeof Deno !== 'undefined') Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  const body = await req.json().catch(() => ({})) as { token?: string; password?: string }
  if (!body.token || typeof body.password !== 'string') return new Response(JSON.stringify({ error: 'Link inválido ou senha inválida.' }), { status: 422 })
  // A regra da senha não é oráculo de token: dizer o que falta na senha não revela
  // nada sobre o link, e a mensagem genérica acima continua cobrindo o token.
  if (!isValidPassword(body.password)) return new Response(JSON.stringify({ error: PASSWORD_RULE_MESSAGE }), { status: 422 })
  // O GoTrue guarda HMAC(pepper, senha) (auditoria run-2, #7); sem pepper, não consome o link.
  const authPassword = await derivePortalAuthPassword(body.password, portalPasswordPepper())
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: reset, error: beginError } = await admin.rpc('portal_begin_password_reset', { p_token_hash: await hashToken(body.token) })
  if (beginError) throw new Error('Could not authorize portal password reset')
  if (!reset) return new Response(JSON.stringify({ error: 'Link inválido ou expirado. Solicite uma nova recuperação.' }), { status: 410 })
  const { account, inviteId } = reset
  await resetPortalPasswordFailClosed(account.auth_user_id, authPassword, {
    now: () => Date.now(),
    revokeSessions: revokePortalSessions,
    quarantineSessions: async (userId, revokedUntil) => {
      const { data, error } = await admin
        .from('customer_portal_accounts')
        .update({ credentials_revoked_at: revokedUntil })
        .eq('auth_user_id', userId)
        .select('id')
        .maybeSingle()
      if (error || !data) throw new Error('Could not quarantine portal sessions')
    },
    updatePassword: async (userId, password) => {
      const { error } = await admin.auth.admin.updateUserById(userId, { password })
      if (error) throw new Error('Could not update portal password')
    },
    completeReset: async () => {
      const { error } = await admin.rpc('portal_finish_password_reset', { p_account_id: account.id, p_invite_id: inviteId })
      if (error) throw new Error('Could not complete portal password reset')
    },
  })
  await admin.rpc('_portal_log_event', { p_customer_id: account.customer_id, p_account_id: account.id, p_invite_id: inviteId, p_prev_decision: account.provisioning_decision, p_new_decision: account.provisioning_decision, p_prev_situation: account.account_situation, p_new_situation: account.account_situation, p_actor_type: 'cliente', p_reason: 'Recuperação de senha concluída pelo cliente', p_request_id: null })
  return new Response(JSON.stringify({ reset: true }), { status: 200 })
}))
