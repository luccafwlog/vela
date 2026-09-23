import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { hashToken } from '../_shared/portalToken.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { PASSWORD_RULE_MESSAGE, isValidPassword } from '../_shared/passwordPolicy.ts'
import { beginPortalRateLimitAttempt, completePortalRateLimitAttempt, requestIp } from '../_shared/portalLoginRateLimit.ts'
import { logEdgeFailure } from '../_shared/logger.ts'
import { verifyTurnstileRequest } from '../_shared/turnstile.ts'

const GENERIC_INVALID = 'Link inválido ou expirado. Solicite um novo convite à empresa.'

if (typeof Deno !== 'undefined') Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } })
    const maskCnpj = (value: string) => { const d = value.replace(/[^0-9a-z]/gi, '').toUpperCase(); return d.length === 14 ? `${d.slice(0, 2)}.***.***/${d.slice(8, 12)}-${d.slice(12)}` : '***' }
  if (req.method === 'OPTIONS') return cors(204, null)
  if (req.method !== 'POST') return cors(405, { error: 'Method not allowed' })
  const body = await req.json().catch(() => ({})) as { action?: string; token?: string; password?: string; turnstile_token?: unknown }
  if (!['inspect', 'activate'].includes(body.action ?? '')) return cors(400, { error: GENERIC_INVALID })
  if (!await verifyTurnstileRequest(req, body.turnstile_token, 'portal_activation')) {
    return cors(403, { error: 'Verificação de segurança inválida. Atualize e tente novamente.' })
  }
  if (!body.token) return cors(400, { error: GENERIC_INVALID })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const tokenHash = await hashToken(body.token)
  const { data: invite } = await admin.from('portal_invites').select('id, account_id, status, expires_at, sent_to_email').eq('token_hash', tokenHash).eq('purpose', 'convite').maybeSingle()
  const valid = Boolean(invite && invite.status === 'pendente' && new Date(invite.expires_at).getTime() > Date.now())
  if (body.action === 'inspect') {
    if (!valid) return cors(410, { error: GENERIC_INVALID })
    const { data: account } = await admin.from('customer_portal_accounts').select('login_cnpj, customers(name)').eq('id', invite.account_id).single()
    const customer = account?.customers as { name?: string } | null
    return cors(200, { company_name: customer?.name ?? '', cnpj_masked: maskCnpj(account?.login_cnpj ?? '') })
  }
  if (!valid) return cors(410, { error: GENERIC_INVALID })
  if (body.action !== 'activate' || typeof body.password !== 'string') return cors(400, { error: GENERIC_INVALID })
  const { data: accountForRateLimit } = await admin.from('customer_portal_accounts').select('login_cnpj').eq('id', invite.account_id).maybeSingle()
  const loginCnpj = typeof accountForRateLimit?.login_cnpj === 'string' ? accountForRateLimit.login_cnpj : ''
  if (!loginCnpj) return cors(429, { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' })
  const rateLimitContext = { ip: requestIp(req) }
  const rateLimitAttempt = await beginPortalRateLimitAttempt(admin, 'activation', loginCnpj, rateLimitContext)
  if (rateLimitAttempt.blocked) return cors(429, { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' })
  if (!isValidPassword(body.password)) {
    await completePortalRateLimitAttempt(admin, 'activation', loginCnpj, rateLimitAttempt, 'failure')
    return cors(422, { error: PASSWORD_RULE_MESSAGE })
  }
  // A política da senha foi satisfeita; uma ativação falhada mais adiante é
  // erro de servidor/estado do convite, não uma senha incorreta do usuário.
  await completePortalRateLimitAttempt(admin, 'activation', loginCnpj, rateLimitAttempt, 'success')
  const { data: consumed } = await admin.from('portal_invites').update({ status: 'consumido', consumed_at: new Date().toISOString() }).eq('id', invite.id).eq('status', 'pendente').gt('expires_at', new Date().toISOString()).select('id').maybeSingle()
  if (!consumed) return cors(410, { error: GENERIC_INVALID })
  const technicalEmail = `p-${crypto.randomUUID()}@${Deno.env.get('PORTAL_TECH_EMAIL_DOMAIN') ?? 'portal-interno.transhippingdesk.invalid'}`
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email: technicalEmail, password: body.password, email_confirm: true })
  if (createError || !created.user) {
    await admin.from('portal_invites').update({ status: 'pendente', consumed_at: null }).eq('id', invite.id)
    return cors(500, { error: 'Não foi possível ativar. Tente novamente.' })
  }
  const { data: account, error: accountError } = await admin.from('customer_portal_accounts').update({ auth_user_id: created.user.id, active: true, account_situation: 'ativo' }).eq('id', invite.account_id).select('customer_id, provisioning_decision, account_situation').single()
  if (accountError || !account) {
    await admin.auth.admin.deleteUser(created.user.id)
    await admin.from('portal_invites').update({ status: 'pendente', consumed_at: null }).eq('id', invite.id).eq('status', 'consumido')
    return cors(500, { error: 'Não foi possível ativar. Tente novamente.' })
  }
  const { error: auditError } = await admin.rpc('_portal_log_event', { p_customer_id: account.customer_id, p_account_id: invite.account_id, p_invite_id: invite.id, p_prev_decision: account.provisioning_decision, p_new_decision: account.provisioning_decision, p_prev_situation: 'convite_pendente', p_new_situation: 'ativo', p_actor_type: 'cliente', p_reason: 'Ativação concluída pelo cliente', p_request_id: null })
  if (auditError) {
    await admin.from('customer_portal_accounts').update({ auth_user_id: null, active: false, account_situation: 'convite_pendente' }).eq('id', invite.account_id).eq('auth_user_id', created.user.id)
    await admin.auth.admin.deleteUser(created.user.id)
    await admin.from('portal_invites').update({ status: 'pendente', consumed_at: null }).eq('id', invite.id).eq('status', 'consumido')
    return cors(500, { error: 'Não foi possível registrar a ativação. Tente novamente.' })
  }
  // A ativação muda o gate de faturamento. O reprocessamento roda no banco,
  // com a mesma autorização/idempotência dos caminhos internos; uma falha de
  // emissão não desfaz a ativação e permanece registrada no alerta do B/L.
  const { data: reprocess, error: reprocessError } = await admin.rpc('reprocess_customer_billing_after_portal_activation', {
    p_customer_id: account.customer_id,
  })
  const { error: reconcileError } = await admin.rpc('reconcile_client_portal_alerts')
  if (reprocessError) logEdgeFailure({ functionName: 'portal-invite-activate', job: 'activation_reprocess', errorCode: 'activation_reprocess_failed' })
  if (reconcileError) logEdgeFailure({ functionName: 'portal-invite-activate', job: 'alert_reconciliation', errorCode: 'alert_reconciliation_failed' })
  return cors(200, {
    activated: true,
    reprocess: reprocess ?? null,
    reprocess_error: reprocessError ? 'failed' : null,
  })
})
