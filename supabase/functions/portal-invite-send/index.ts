import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { generateToken, hashToken } from '../_shared/portalToken.ts'
import { inviteTemplate, resendTemplate } from '../_shared/portalEmailTemplates.ts'
import { sendPortalEmail } from '../_shared/portalEmail.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { canonicalPortalOrigin, canonicalPortalUrl, portalSupportEmail } from '../_shared/portalUrls.ts'
import { instrumentEdgeHandler } from '../_shared/telemetry.ts'

const json = (status: number, body: unknown, origin: string | null) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } })
const maskCnpj = (value: string) => { const d = value.replace(/[^0-9a-z]/gi, '').toUpperCase(); return d.length === 14 ? `${d.slice(0, 2)}.***.***/${d.slice(8, 12)}-${d.slice(12)}` : '***' }

if (typeof Deno !== 'undefined') Deno.serve(instrumentEdgeHandler('portal-invite-send', async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return json(204, null, origin)
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, origin)
  const body = await req.json().catch(() => ({})) as { customer_id?: number; recovery_email?: string; recovery_email_source?: string; reason?: string }
  if (!body.customer_id || !body.recovery_email?.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) return json(422, { error: 'Email inválido.' }, origin)
  const url = Deno.env.get('SUPABASE_URL')!; const anon = Deno.env.get('SUPABASE_ANON_KEY')!; const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const jwt = req.headers.get('Authorization') ?? ''
  const caller = createClient(url, anon, { global: { headers: { Authorization: jwt } } })
  const { data: role } = await caller.rpc('portal_current_role')
  if (!['administrativo', 'documentacao'].includes(String(role))) return json(403, { error: 'permission denied' }, origin)
  const admin = createClient(url, service)
  const { data: callerUser } = await caller.auth.getUser()
  const email = body.recovery_email.toLowerCase()
  const { data: suppressed } = await admin.from('portal_suppressed_emails').select('id').eq('email', email).maybeSingle()
  if (suppressed) return json(422, { error: 'Endereço suprimido por bounce/complaint. Informe outro.' }, origin)
  const { data: account } = await admin.from('customer_portal_accounts').select('id, customer_id, account_situation, provisioning_decision, customers(name, cnpj_cpf)').eq('customer_id', body.customer_id).single()
  if (!account) return json(404, { error: 'Cliente não encontrado.' }, origin)
  const resend = account.account_situation === 'convite_pendente' || account.account_situation === 'convite_expirado' || account.account_situation === 'falha_no_envio'
  if (!resend && account.account_situation !== 'sem_conta') return json(409, { error: 'Conta ativa usa recuperação de senha.' }, origin)
  await admin.from('portal_invites').update({ status: 'invalidado_por_reenvio' }).eq('account_id', account.id).eq('status', 'pendente')
  const token = generateToken(); const tokenHash = await hashToken(token)
  const { data: invite, error } = await admin.from('portal_invites').insert({ account_id: account.id, purpose: 'convite', token_hash: tokenHash, sent_to_email: email, expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), status: 'pendente', created_by: callerUser.user?.id ?? null }).select('id').single()
  if (error || !invite) return json(500, { error: 'Não foi possível criar o convite.' }, origin)
  const customer = account.customers as { name?: string; cnpj_cpf?: string } | null
  const activationUrl = canonicalPortalUrl(`ativar?token=${encodeURIComponent(token)}`)
  const portalUrl = canonicalPortalOrigin()
  const supportEmail = portalSupportEmail()
  const templateInput = { companyName: customer?.name ?? 'sua empresa', cnpjMasked: maskCnpj(customer?.cnpj_cpf ?? ''), activationUrl, portalUrl, supportEmail }
  const template = resend ? resendTemplate(templateInput) : inviteTemplate(templateInput)
  const sent = await sendPortalEmail({ admin, kind: resend ? 'reenvio' : 'convite', to: email, subject: template.subject, html: template.html, text: template.text, idempotencyKey: `convite:${invite.id}`, accountId: account.id, inviteId: invite.id })
  // `recovery_email_status` (299) descreve o endereço, não a conta: gravar um
  // endereço novo aqui sem zerar o sinal deixaria o console acusando de quebrado
  // um endereço que nunca foi testado -- e o operador não teria como limpá-lo,
  // porque `portal_release_suppressed_email` recusa endereço que não está na
  // lista de bloqueio. É o mesmo zeramento que a troca assistida (300) e a
  // confirmação pelo cliente já fazem; este era o terceiro escritor de
  // `recovery_email` e o único que não o fazia. O endereço chega aqui checado
  // contra a lista de bloqueio logo acima, então 'ok' é o que se sabe dele.
  await admin.from('customer_portal_accounts').update({ recovery_email: email, recovery_email_source: body.recovery_email_source === 'informado_manualmente' ? 'informado_manualmente' : 'candidato', recovery_email_status: 'ok', provisioning_decision: 'aprovado_para_provisionar', account_situation: sent.ok ? 'convite_pendente' : 'falha_no_envio' }).eq('id', account.id)
  const { error: auditError } = await admin.rpc('_portal_log_event', { p_customer_id: account.customer_id, p_account_id: account.id, p_invite_id: invite.id, p_prev_decision: account.provisioning_decision, p_new_decision: 'aprovado_para_provisionar', p_prev_situation: account.account_situation, p_new_situation: sent.ok ? 'convite_pendente' : 'falha_no_envio', p_actor_type: String(role), p_reason: body.reason ?? (resend ? 'Reenvio de convite autorizado.' : 'Convite autorizado.'), p_request_id: null })
  if (auditError) {
    console.error('portal invite audit failed', auditError)
    return json(500, { error: 'Não foi possível registrar a auditoria do convite.' }, origin)
  }
  if (!sent.ok) await admin.from('alerts').insert({ type: 'portal_falha_envio', entity_type: 'customer', entity_id: String(body.customer_id), message: 'Falha no envio do convite do Portal.', status: 'open' })
  return json(200, { situation: sent.ok ? 'convite_pendente' : 'falha_no_envio', invite_id: invite.id }, origin)
}))
