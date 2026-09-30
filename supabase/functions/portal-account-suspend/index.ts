import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2'
import { revokePortalSessions } from '../_shared/revokePortalSessions.ts'
import { withCors } from '../_shared/cors.ts'

if (typeof Deno !== 'undefined') Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  const body = await req.json().catch(() => ({})) as { customer_id?: number; action?: string; reason?: string }
  if (!body.customer_id || !['suspend', 'reactivate'].includes(body.action ?? '') || !body.reason?.trim()) return new Response(JSON.stringify({ error: 'Dados inválidos.' }), { status: 422 })
  const url = Deno.env.get('SUPABASE_URL')!; const jwt = req.headers.get('Authorization') ?? ''
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: jwt } } })
  const { data: role } = await caller.rpc('portal_current_role')
  if (!['administrativo', 'documentacao'].includes(String(role))) return new Response(JSON.stringify({ error: 'permission denied' }), { status: 403 })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: account } = await admin.from('customer_portal_accounts').select('id, customer_id, auth_user_id, provisioning_decision, account_situation').eq('customer_id', body.customer_id).single()
  if (!account) return new Response(JSON.stringify({ error: 'Cliente não encontrado.' }), { status: 404 })
  // Transições válidas (auditoria run-2, reforço): suspender o que não está
  // suspenso nem sem conta; reativar só o que está suspenso.
  const allowed = body.action === 'suspend'
    ? !['suspenso', 'sem_conta'].includes(account.account_situation)
    : account.account_situation === 'suspenso'
  if (!allowed) return new Response(JSON.stringify({ error: 'A conta não está numa situação que permita esta ação.' }), { status: 409 })
  if (body.action === 'suspend') {
    if (account.auth_user_id) await revokePortalSessions(account.auth_user_id)
    // O update só vale se a situação lida ainda for a atual.
    const { data: updated, error: updateError } = await admin.from('customer_portal_accounts').update({ account_situation: 'suspenso', active: false }).eq('id', account.id).eq('account_situation', account.account_situation).select('id').maybeSingle()
    if (!updateError && !updated) return new Response(JSON.stringify({ error: 'A conta mudou de situação. Atualize e tente novamente.' }), { status: 409 })
    if (updateError) return new Response(JSON.stringify({ error: 'Não foi possível atualizar a conta.' }), { status: 500 })
    const { error: auditError } = await admin.rpc('_portal_log_event', { p_customer_id: account.customer_id, p_account_id: account.id, p_invite_id: null, p_prev_decision: account.provisioning_decision, p_new_decision: account.provisioning_decision, p_prev_situation: account.account_situation, p_new_situation: 'suspenso', p_actor_type: role, p_reason: body.reason, p_request_id: null })
    if (auditError) {
      await admin.from('customer_portal_accounts').update({ account_situation: account.account_situation, active: account.account_situation === 'ativo' }).eq('id', account.id)
      return new Response(JSON.stringify({ error: 'Não foi possível registrar a auditoria.' }), { status: 500 })
    }
    // Convite ou recuperação pendente ativaria a conta suspensa.
    const { error: invitesError } = await admin.from('portal_invites').update({ status: 'cancelado' }).eq('account_id', account.id).eq('status', 'pendente')
    if (invitesError) return new Response(JSON.stringify({ error: 'Conta suspensa, mas não foi possível cancelar os convites pendentes.' }), { status: 500 })
  } else {
    if (account.auth_user_id) await revokePortalSessions(account.auth_user_id)
    const { data: updated, error: updateError } = await admin.from('customer_portal_accounts').update({ account_situation: 'sem_conta', provisioning_decision: 'aguardando_analise', active: false, auth_user_id: null }).eq('id', account.id).eq('account_situation', 'suspenso').select('id').maybeSingle()
    if (!updateError && !updated) return new Response(JSON.stringify({ error: 'A conta mudou de situação. Atualize e tente novamente.' }), { status: 409 })
    if (updateError) return new Response(JSON.stringify({ error: 'Não foi possível atualizar a conta.' }), { status: 500 })
    const { error: auditError } = await admin.rpc('_portal_log_event', { p_customer_id: account.customer_id, p_account_id: account.id, p_invite_id: null, p_prev_decision: account.provisioning_decision, p_new_decision: 'aguardando_analise', p_prev_situation: account.account_situation, p_new_situation: 'sem_conta', p_actor_type: role, p_reason: body.reason, p_request_id: null })
    if (auditError) {
      await admin.from('customer_portal_accounts').update({ account_situation: account.account_situation, provisioning_decision: account.provisioning_decision, active: account.account_situation === 'ativo', auth_user_id: account.auth_user_id }).eq('id', account.id)
      return new Response(JSON.stringify({ error: 'Não foi possível registrar a auditoria.' }), { status: 500 })
    }
    // A nova ativação cria outro usuário técnico; o antigo não pode continuar
    // aceitando a senha antiga direto no GoTrue (auditoria run-2, reforço).
    if (account.auth_user_id) {
      // Banir em vez de apagar: registros antigos ainda referenciam o usuário.
      const { error: banError } = await admin.auth.admin.updateUserById(account.auth_user_id, { ban_duration: '876000h' })
      if (banError) return new Response(JSON.stringify({ error: 'Conta reaberta, mas o acesso antigo não foi bloqueado. Tente de novo.' }), { status: 500 })
    }
  }
  return new Response(JSON.stringify({ situation: body.action === 'suspend' ? 'suspenso' : 'sem_conta' }), { status: 200 })
}))
