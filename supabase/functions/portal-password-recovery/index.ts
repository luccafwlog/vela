import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { generateToken, hashToken } from '../_shared/portalToken.ts'
import { recoveryTemplate } from '../_shared/portalEmailTemplates.ts'
import { sendPortalEmail } from '../_shared/portalEmail.ts'
import { findReusableRecoveryInvite } from '../_shared/portalInvites.ts'
import { withCors } from '../_shared/cors.ts'
import { canonicalPortalOrigin, canonicalPortalUrl, portalSupportEmail } from '../_shared/portalUrls.ts'

// Achado 3.2 (auditoria 2026-08-12): a resposta antiga distinguia
// account_found/email_sent, entao um atacante varria CNPJs distintos e
// aprendia quais tem conta no Portal. O unico sinal que sobrevive e o rate
// limit -- que nao distingue conta e e informacao util de "tente mais tarde".
// Todo outro desfecho elegivel devolve o mesmo `{ accepted: true }`,
// independente de o CNPJ ter conta, estar ativo ou o email ter sido enviado.
//
// Achado da revisao do PR 527: igualar so o corpo da resposta nao bastava --
// so o caminho de conta ativa aguardava sendPortalEmail (fetch para o Resend
// + retries com backoff), entao o tempo de resposta sozinho reabria o oraculo
// de enumeracao. sendPortalEmail roda em segundo piano via EdgeRuntime.waitUntil
// e a resposta sai antes dele terminar, em todo caminho elegivel.
const accepted = () => new Response(JSON.stringify({ accepted: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
const rateLimited = () => new Response(JSON.stringify({ accepted: false, rate_limited: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })

if (typeof Deno !== 'undefined') Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  const body = await req.json().catch(() => ({})) as { cnpj?: string }
  const cnpj = (body.cnpj ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase()
  if (cnpj.length !== 14) return accepted()

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: blocked } = await admin.rpc('portal_recovery_check_rate_limit', { p_login: cnpj })
  if (blocked === true) return rateLimited()
  await admin.rpc('portal_recovery_register_failure', { p_login: cnpj })

  // PAF-04: o processamento da conta, validação de supressão, reutilização de convite e
  // despacho de email rodam em segundo plano via EdgeRuntime.waitUntil.
  // A resposta síncrona devolve `{ accepted: true }` imediatamente após registrar a tentativa no rate limit,
  // eliminando qualquer assimetria temporal observável (TTFB) entre CNPJs existentes,
  // inexistentes, inativos ou com convite já ativo.
  const recoveryWork = processRecoveryInBackground(admin, cnpj)
    .catch((error) => console.error('[portal-password-recovery] falha no processamento em segundo plano', error))

  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(recoveryWork)
  return accepted()
}))

async function processRecoveryInBackground(admin: ReturnType<typeof createClient>, cnpj: string) {
  const { data: account } = await admin
    .from('customer_portal_accounts')
    .select('id, customer_id, account_situation, recovery_email, customers(name, cnpj_cpf)')
    .eq('login_cnpj', cnpj)
    .maybeSingle()
  if (!account) return
  if (account.account_situation !== 'ativo' || !account.recovery_email) return
  const { data: suppressed } = await admin
    .from('portal_suppressed_emails')
    .select('id')
    .eq('email', account.recovery_email.toLowerCase())
    .maybeSingle()
  if (suppressed) return

  // Havendo link vivo, o pedido reusa em vez de reenviar: sem isso, um terceiro
  // com o CNPJ (público) fazia o sistema enviar até 480 emails por dia à caixa
  // de um cliente real, e o cliente que estava lendo o próprio link podia
  // encontrá-lo cancelado por um pedido que não era dele. O teto resultante é
  // um email por hora por conta -- a validade do convite. O balde de tentativas
  // NÃO muda: ele continua registrando todo pedido, inclusive os que resultam
  // em envio; contar só os pedidos sem conta faria do bloqueio um oráculo de
  // enumeração.
  //
  // "Vivo" é mais que "pendente": o convite tem de estar endereçado ao email de
  // recuperação VIGENTE e o envio não pode ter falhado. Um convite pendente que
  // o Resend recusou, ou que foi para a caixa anterior a uma troca de endereço,
  // seguraria por uma hora o link que o cliente está pedindo agora -- justamente
  // no caminho em que ele não tem outro jeito de entrar.
  const liveInvite = await findReusableRecoveryInvite(admin, account.id, account.recovery_email, Date.now())
  if (liveInvite) return

  await admin
    .from('portal_invites')
    .update({ status: 'invalidado_por_reenvio' })
    .eq('account_id', account.id)
    .eq('purpose', 'recuperacao')
    .eq('status', 'pendente')

  const token = generateToken()
  const tokenHash = await hashToken(token)
  const { data: invite } = await admin
    .from('portal_invites')
    .insert({
      account_id: account.id,
      purpose: 'recuperacao',
      token_hash: tokenHash,
      sent_to_email: account.recovery_email,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      status: 'pendente',
    })
    .select('id')
    .single()
  if (!invite) return

  const customer = account.customers as { name?: string; cnpj_cpf?: string } | null
  const d = (customer?.cnpj_cpf ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase()
  const recoveryUrl = canonicalPortalUrl(`recuperar-senha?token=${encodeURIComponent(token)}`)
  const portalUrl = canonicalPortalOrigin()
  const supportEmail = portalSupportEmail()
  const template = recoveryTemplate({
    companyName: customer?.name ?? 'sua empresa',
    cnpjMasked: d.length === 14 ? `${d.slice(0, 2)}.***.***/${d.slice(8, 12)}-${d.slice(12)}` : '***',
    recoveryUrl,
    portalUrl,
    supportEmail,
  })

  await sendPortalEmail({
    admin,
    kind: 'recuperacao',
    to: account.recovery_email,
    subject: template.subject,
    html: template.html,
    text: template.text,
    idempotencyKey: `recuperacao:${invite.id}`,
    accountId: account.id,
    inviteId: invite.id,
  }).catch((error) => console.error('[portal-password-recovery] falha ao enviar email em segundo plano', error))
}
