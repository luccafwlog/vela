import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2'
import { generateToken, hashToken } from '../_shared/portalToken.ts'
import { emailChangeAlertTemplate, emailChangeAssistedAlertTemplate, emailChangeConfirmTemplate } from '../_shared/portalEmailTemplates.ts'
import { sendPortalEmail } from '../_shared/portalEmail.ts'
import { revokePortalSessions } from '../_shared/revokePortalSessions.ts'
import { isLoginRateLimited, registerLoginFailure, registerLoginSuccess, requestIp } from '../_shared/portalLoginRateLimit.ts'
import { resolveEmailChangeConfirmation } from '../_shared/portalInvites.ts'
import { withCors } from '../_shared/cors.ts'
import { canonicalPortalOrigin, canonicalPortalUrl, portalSupportEmail } from '../_shared/portalUrls.ts'
import { derivePortalAuthPassword, portalPasswordPepper } from '../_shared/portalPasswordSecret.ts'

// Mensagem própria para o pedido que já não tem o que aplicar. Dizer "link
// inválido" aqui seria mentira -- o link estava válido -- e mandaria o cliente
// refazer uma troca que outro caminho já resolveu.
const ALREADY_RESOLVED = 'Este pedido de troca de email já foi resolvido. Nenhuma alteração era necessária.'
const RATE_LIMITED = 'Muitas tentativas com a senha atual. Aguarde alguns minutos e tente de novo.'
// Resposta que o Vela lê: sem Content-Type JSON o supabase-js entrega o corpo
// como texto, e `previous_notified` sumia -- o operador via "aviso não
// enviado" para um aviso entregue.
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const EMAIL_CHANGE_DAILY_LIMIT = 5
const SEND_FAILED = 'Não conseguimos enviar o email de confirmação. Nenhuma troca foi iniciada; tente novamente mais tarde.'

if (typeof Deno !== 'undefined') Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  const body = await req.json().catch(() => ({})) as { action?: string; current_password?: string; new_email?: string; token?: string; customer_id?: number; reason?: string }
  const url = Deno.env.get('SUPABASE_URL')!; const jwt = req.headers.get('Authorization') ?? ''; const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  if (body.action === 'request') {
    const portal = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: jwt } } })
    const { data: userData } = await portal.auth.getUser(); const authId = userData.user?.id
    if (!authId || !body.current_password || !body.new_email?.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) return new Response(JSON.stringify({ error: 'Dados inválidos.' }), { status: 422 })
    const { data: account } = await admin.from('customer_portal_accounts').select('id, customer_id, login_cnpj, recovery_email, auth_user_id, active, account_situation, customers(name, cnpj_cpf)').eq('auth_user_id', authId).single()
    if (!account?.login_cnpj) return new Response(JSON.stringify({ error: 'Não foi possível iniciar a troca de email.' }), { status: 422 })
    // Só conta ativa, e no máximo 5 pedidos por dia: cada pedido manda e-mail
    // a um endereço escolhido pelo cliente (auditoria run-2, reforço).
    if (!account.active || account.account_situation !== 'ativo') return new Response(JSON.stringify({ error: 'Não foi possível iniciar a troca de email.' }), { status: 403 })
    const { count: recentRequests, error: quotaError } = await admin.from('portal_invites').select('id', { count: 'exact', head: true }).eq('account_id', account.id).eq('purpose', 'confirmacao_email').gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    if (quotaError) return new Response(JSON.stringify({ error: 'Não foi possível iniciar a troca de email.' }), { status: 500 })
    if ((recentRequests ?? 0) >= EMAIL_CHANGE_DAILY_LIMIT) return new Response(JSON.stringify({ error: 'Limite de pedidos de troca de email atingido. Tente novamente amanhã.' }), { status: 429 })
    // Este caminho recebe a senha atual e a verifica. Sem consultar a trava,
    // quem tivesse uma sessão do Portal aberta (navegador compartilhado,
    // notebook emprestado) testaria senha sem limite por aqui, contornando as
    // 5 tentativas do login. A consulta vem ANTES de signInWithPassword: quem
    // está bloqueado não chega a ter a senha verificada.
    const rateLimitContext = { ip: requestIp(req) }
    if (await isLoginRateLimited(admin, account.login_cnpj, rateLimitContext)) return new Response(JSON.stringify({ error: RATE_LIMITED }), { status: 429 })
    const { data: authUser } = await admin.auth.admin.getUserById(authId); const technicalEmail = authUser.user?.email
    // Sem email técnico não houve senha errada: houve falha nossa ao resolver o
    // usuário do Auth. Contar isso no balde do login gastaria as 5 tentativas do
    // cliente por conta de um defeito do servidor e o trancaria por 15 minutos
    // fora do Portal, sem que ele tivesse errado nada. O balde só registra o que
    // o cliente digitou.
    if (!technicalEmail) return new Response(JSON.stringify({ error: 'Não foi possível iniciar a troca de email.' }), { status: 500 })
    const verifier = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!)
    // Senha migrada (HMAC) primeiro; a pura só vale para conta ainda legada.
    let verified = await verifier.auth.signInWithPassword({ email: technicalEmail, password: await derivePortalAuthPassword(body.current_password, portalPasswordPepper()) })
    if (verified.error) verified = await verifier.auth.signInWithPassword({ email: technicalEmail, password: body.current_password })
    if (verified.error) {
      await registerLoginFailure(admin, account.login_cnpj, rateLimitContext)
      return new Response(JSON.stringify({ error: 'Não foi possível iniciar a troca de email.' }), { status: 422 })
    }
    await registerLoginSuccess(admin, account.login_cnpj, rateLimitContext)
    // A verificação cria uma sessão do Supabase Auth que ninguém mais usa;
    // sem signOut, cada troca deixava um refresh token pendurado. O escopo é
    // `local` de propósito: o padrão do supabase-js é `global`, que revoga TODO
    // refresh token do usuário -- inclusive o da aba em que o cliente está
    // fazendo o pedido, que cairia para o login na renovação seguinte. O que
    // sobra para encerrar é a sessão que esta função acabou de criar.
    await verifier.auth.signOut({ scope: 'local' }).catch((error) => console.error('[portal-recovery-email-change] falha ao encerrar a sessão de verificação', error))
    const email = body.new_email.toLowerCase(); const { data: suppressed } = await admin.from('portal_suppressed_emails').select('id').eq('email', email).maybeSingle()
    if (suppressed) return new Response(JSON.stringify({ error: 'Não foi possível iniciar a troca de email.' }), { status: 422 })
    await admin.from('portal_invites').update({ status: 'invalidado_por_reenvio' }).eq('account_id', account.id).eq('purpose', 'confirmacao_email').eq('status', 'pendente')
    const token = generateToken(); const tokenHash = await hashToken(token)
    const { data: invite } = await admin.from('portal_invites').insert({ account_id: account.id, purpose: 'confirmacao_email', token_hash: tokenHash, sent_to_email: email, expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), status: 'pendente' }).select('id').single()
    if (!invite) return new Response(JSON.stringify({ error: 'Não foi possível iniciar a troca de email.' }), { status: 500 })
    await admin.from('customer_portal_accounts').update({ pending_recovery_email: email }).eq('id', account.id)
    const portalUrl = canonicalPortalOrigin()
    const supportEmail = portalSupportEmail()
    // Rota publica dedicada: o link chega no Email de Recuperacao, que costuma
    // ser lido pelo contato financeiro -- sem senha do Portal. Apontar para
    // /portal/perfil (rota protegida) fazia o guard redirecionar para o login
    // descartando a query string, e o token se perdia em silencio.
    const urlConfirm = canonicalPortalUrl(`confirmar-email?token=${encodeURIComponent(token)}`)
    const customer = account.customers as { name?: string } | null
    const confirmTemplate = emailChangeConfirmTemplate({ companyName: customer?.name ?? 'sua empresa', confirmUrl: urlConfirm, portalUrl, supportEmail })
    const sent = await sendPortalEmail({ admin, kind: 'alteracao_email', to: email, subject: confirmTemplate.subject, html: confirmTemplate.html, text: confirmTemplate.text, idempotencyKey: `alteracao_email:${invite.id}`, accountId: account.id, inviteId: invite.id })
    // Sem o link no novo endereço não existe troca em andamento: desfaz o
    // pedido e diz isso ao cliente, em vez de responder "enviamos um link".
    // O aviso ao endereço antigo só sai quando há o que avisar.
    if (!sent.ok) {
      await admin.from('portal_invites').update({ status: 'cancelado' }).eq('id', invite.id)
      await admin.from('customer_portal_accounts').update({ pending_recovery_email: null }).eq('id', account.id).eq('pending_recovery_email', email)
      return new Response(JSON.stringify({ error: SEND_FAILED }), { status: 502 })
    }
    if (account.recovery_email && account.recovery_email.toLowerCase() !== email) {
      const alertTemplate = emailChangeAlertTemplate({ portalUrl, supportEmail })
      await sendPortalEmail({ admin, kind: 'alteracao_email', to: account.recovery_email, subject: alertTemplate.subject, html: alertTemplate.html, text: alertTemplate.text, idempotencyKey: `alteracao_email_alerta:${invite.id}`, accountId: account.id })
    }
    return new Response(JSON.stringify({ pending: true }), { status: 200 })
  }
  if (body.action === 'confirm' && body.token) {
    const resolution = await resolveEmailChangeConfirmation(admin, await hashToken(body.token), Date.now())
    if (resolution.outcome === 'link_invalido') return new Response(JSON.stringify({ error: 'Link inválido ou expirado.' }), { status: 410 })
    if (resolution.outcome === 'pedido_ja_resolvido') return new Response(JSON.stringify({ error: ALREADY_RESOLVED }), { status: 409 })
    const { account, inviteId } = resolution
    // O endereço novo entra sem histórico de bounce; manter o sinal do anterior
    // acusaria de quebrado um endereço que nunca foi testado.
    await admin.from('customer_portal_accounts').update({ recovery_email: account.pending_recovery_email, pending_recovery_email: null, recovery_email_source: 'informado_manualmente', recovery_email_status: 'ok' }).eq('id', account.id)
    if (account.auth_user_id) await revokePortalSessions(account.auth_user_id)
    await admin.rpc('_portal_log_event', { p_customer_id: account.customer_id, p_account_id: account.id, p_invite_id: inviteId, p_prev_decision: account.provisioning_decision, p_new_decision: account.provisioning_decision, p_prev_situation: account.account_situation, p_new_situation: account.account_situation, p_actor_type: 'cliente', p_reason: 'Email de recuperação confirmado pelo cliente; sessões anteriores encerradas', p_request_id: null })
    return new Response(JSON.stringify({ confirmed: true }), { status: 200 })
  }
  // Troca assistida (Vela, Documentação/Administrativo). A RPC continua sendo
  // quem autoriza e aplica, com o JWT de quem chamou; a função só existe para
  // avisar o endereço anterior, que a RPC apaga e que o navegador não deve
  // poder escolher. O endereço é lido antes da troca, no servidor.
  if (body.action === 'assisted') {
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: jwt } } })
    const { data: before } = await admin.from('customer_portal_accounts').select('id, recovery_email').eq('customer_id', body.customer_id ?? 0).maybeSingle()
    const { error: changeError } = await caller.rpc('portal_assisted_email_change', { p_customer_id: body.customer_id, p_new_email: body.new_email, p_reason: body.reason })
    if (changeError) return json(changeError.code === '42501' ? 403 : 422, { error: changeError.code === '42501' ? 'Permissão negada.' : changeError.message })
    const previous = before?.recovery_email?.toLowerCase()
    if (!before || !previous || previous === body.new_email?.trim().toLowerCase()) return json(200, { previous_notified: 'sem_anterior' })
    const alert = emailChangeAssistedAlertTemplate({ portalUrl: canonicalPortalOrigin(), supportEmail: portalSupportEmail() })
    // A troca já foi aplicada; falhar o aviso não a desfaz, só é relatado.
    const sent = await sendPortalEmail({ admin, kind: 'alteracao_email', to: previous, subject: alert.subject, html: alert.html, text: alert.text, idempotencyKey: `alteracao_email_assistida:${before.id}:${crypto.randomUUID()}`, accountId: before.id })
    return json(200, { previous_notified: sent.ok ? 'enviado' : 'falhou' })
  }
  return new Response(JSON.stringify({ error: 'Dados inválidos.' }), { status: 422 })
}))
