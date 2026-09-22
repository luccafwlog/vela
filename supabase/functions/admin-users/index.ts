import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { logEdgeFailure } from '../_shared/logger.ts'

import { PASSWORD_RULE_MESSAGE, isValidPassword } from '../_shared/passwordPolicy.ts'

const MANAGED_PROFILES = ['administrativo', 'financeiro', 'operacoes', 'documentacao', 'equipamentos']
const isValidEmail = (value: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)

const json = (status: number, body: unknown, origin: string | null) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })

type Payload = {
  action?: 'create' | 'update_credentials' | 'deactivate'
  user_id?: string
  full_name?: string
  email?: string
  password?: string
  role?: string
}

if (typeof Deno !== 'undefined') Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return json(204, null, origin)
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, origin)

  const body = await req.json().catch(() => ({})) as Payload
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const jwt = req.headers.get('Authorization') ?? ''

  const caller = createClient(url, anon, { global: { headers: { Authorization: jwt } } })
  const { data: isAdmin } = await caller.rpc('is_admin')
  if (isAdmin !== true) return json(403, { error: 'permission denied' }, origin)

  const { data: callerUser } = await caller.auth.getUser()
  const actorId = callerUser.user?.id ?? null
  if (!actorId) return json(403, { error: 'permission denied' }, origin)

  // service_role restrito ao que exige privilégio de autenticação.
  const admin = createClient(url, service)

  const audit = (entityId: string, field: string, oldValue: string | null, newValue: string | null) =>
    caller.from('audit_logs').insert({
      entity_type: 'user_profile',
      entity_id: entityId,
      field_name: field,
      old_value: oldValue,
      new_value: newValue,
      changed_by: actorId,
    })

  if (body.action === 'create') {
    const fullName = (body.full_name ?? '').trim()
    const email = (body.email ?? '').trim().toLowerCase()
    const password = body.password ?? ''
    const role = body.role ?? ''

    if (fullName.length < 3) return json(422, { error: 'Informe o nome completo do usuário.' }, origin)
    if (!isValidEmail(email)) return json(422, { error: 'E-mail inválido.' }, origin)
    if (!isValidPassword(password)) return json(422, { error: PASSWORD_RULE_MESSAGE }, origin)
    if (!MANAGED_PROFILES.includes(role)) return json(422, { error: 'Selecione um setor válido.' }, origin)

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (createError || !created.user) {
      const duplicate = String(createError?.message ?? '').toLowerCase().includes('already')
      return json(duplicate ? 409 : 500, {
        error: duplicate ? 'Já existe um usuário com este e-mail.' : 'Não foi possível criar o usuário.',
      }, origin)
    }

    const { error: profileError } = await caller.from('user_profiles').insert({
      id: created.user.id,
      full_name: fullName,
      role,
      active: true,
    })
    if (profileError) {
      // Sem a compensação sobra o órfão que o ProtectedRoute descreve:
      // autenticação existente sem perfil, e o e-mail fica inutilizável.
      await admin.auth.admin.deleteUser(created.user.id)
      return json(500, { error: 'Não foi possível criar o perfil do usuário.' }, origin)
    }

    await audit(created.user.id, 'created', null, `${fullName} (${role})`)
    return json(201, { id: created.user.id }, origin)
  }

  if (body.action === 'update_credentials') {
    const userId = body.user_id ?? ''
    if (!userId) return json(422, { error: 'Usuário não informado.' }, origin)

    const email = body.email?.trim().toLowerCase()
    const password = body.password
    if (!email && !password) return json(422, { error: 'Informe um novo e-mail ou uma nova senha.' }, origin)
    if (email && !isValidEmail(email)) return json(422, { error: 'E-mail inválido.' }, origin)
    if (password && !isValidPassword(password)) return json(422, { error: PASSWORD_RULE_MESSAGE }, origin)

    const { data: current } = await admin.auth.admin.getUserById(userId)
    const previousEmail = current.user?.email ?? null

    const updates: { email?: string; password?: string; email_confirm?: boolean } = {}
    if (email) { updates.email = email; updates.email_confirm = true }
    if (password) updates.password = password

    const { error: updateError } = await admin.auth.admin.updateUserById(userId, updates)
    if (updateError) {
      const duplicate = String(updateError.message ?? '').toLowerCase().includes('already')
      return json(duplicate ? 409 : 500, {
        error: duplicate ? 'Já existe um usuário com este e-mail.' : 'Não foi possível atualizar o acesso.',
      }, origin)
    }

    if (email && email !== previousEmail) await audit(userId, 'email', previousEmail, email)
    // A senha nunca é registrada, só o fato de ter sido trocada.
    if (password) await audit(userId, 'password', null, 'redefinida pelo administrador')
    return json(200, { ok: true }, origin)
  }

  if (body.action === 'deactivate') {
    const userId = body.user_id ?? ''
    if (!userId) return json(422, { error: 'Usuário não informado.' }, origin)
    if (userId === actorId) return json(422, { error: 'Você não pode desativar o próprio acesso.' }, origin)

    // Escrita pelo cliente do chamador: a policy de admin continua valendo e o
    // trigger de auditoria enxerga auth.uid(). Sob service_role o autor sairia nulo.
    const { error: profileError } = await caller
      .from('user_profiles')
      .update({ active: false })
      .eq('id', userId)
    if (profileError) return json(500, { error: 'Não foi possível desativar o usuário.' }, origin)

    // O flag sozinho não derruba a sessão: o token segue válido até expirar.
    const { error: signOutError } = await admin.auth.admin.signOut(userId)
    if (signOutError) logEdgeFailure({ functionName: 'admin-users', job: 'session_revocation', errorCode: 'session_revoke_failed' })

    return json(200, { ok: true, sessions_revoked: !signOutError }, origin)
  }

  return json(400, { error: 'Ação desconhecida.' }, origin)
})
