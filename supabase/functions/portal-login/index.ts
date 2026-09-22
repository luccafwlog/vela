import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { openAlertOnce } from '../_shared/portalAlerts.ts'
import { isLoginRateLimited, registerLoginFailure, registerLoginSuccess, requestIp } from '../_shared/portalLoginRateLimit.ts'
import { authenticatePortalLoginIdentity } from '../_shared/portalLoginIdentity.ts'
import { logEdgeFailure } from '../_shared/logger.ts'

const GENERIC_ERROR = 'CNPJ ou senha inválidos.'

export function normalizeCnpj(input: string): string | null {
  const cnpj = (input ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase()
  return /^[0-9A-Z]{14}$/.test(cnpj) ? cnpj : null
}

function json(status: number, body: unknown, origin: string | null) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  })
}

if (typeof Deno !== 'undefined') {
  Deno.serve(async (req) => {
    const origin = req.headers.get('Origin')
    if (req.method === 'OPTIONS') return json(204, null, origin)
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, origin)

    try {
      const body = await req.json().catch(() => ({})) as { cnpj?: unknown; password?: unknown }
      const normalized = typeof body.cnpj === 'string' ? normalizeCnpj(body.cnpj) : null
      if (!normalized || typeof body.password !== 'string' || body.password.length === 0) return json(401, { error: GENERIC_ERROR }, origin)

      const url = Deno.env.get('SUPABASE_URL')
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
      const dummyUserId = Deno.env.get('PORTAL_LOGIN_DUMMY_AUTH_USER_ID')
      if (!url || !serviceKey || !anonKey || !dummyUserId) return json(500, { error: 'Portal indisponível.' }, origin)

      const admin = createClient(url, serviceKey)
      const rateLimitContext = { ip: requestIp(req) }
      if (await isLoginRateLimited(admin, normalized, rateLimitContext)) {
        // O caminho bloqueado consultava a conta e, SÓ se ela existisse,
        // consultava e inseria o alerta: os dois desfechos devolvem o mesmo 401,
        // mas um fazia consistentemente uma consulta a mais que o outro. É o
        // mesmo oráculo por tempo do achado 3.2 da auditoria
        // security-audit-portal-2026-08-12, que a PR 527 fechou na recuperação e
        // que reapareceu no login. A resposta sai antes do trabalho terminar, na
        // mesma forma de portal-password-recovery.
        const alertWork = (async () => {
          const { data: blockedAccount } = await admin.from('customer_portal_accounts').select('customer_id').eq('login_cnpj', normalized).maybeSingle()
          if (!blockedAccount) return
          await openAlertOnce(admin, {
            type: 'portal_abuso_login',
            entityType: 'customer',
            entityId: String(blockedAccount.customer_id),
            message: 'Muitas tentativas de login no Portal. Verifique a origem e contate o Cliente se necessário.',
          })
        })().catch(() => logEdgeFailure({ functionName: 'portal-login', job: 'abuse_alert', errorCode: 'abuse_alert_failed' }))
        if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(alertWork)
        return json(401, { error: GENERIC_ERROR }, origin)
      }

      const { data: account } = await admin.from('customer_portal_accounts').select('auth_user_id, account_situation').eq('login_cnpj', normalized).maybeSingle()
      const authClient = createClient(url, anonKey)
      const authentication = await authenticatePortalLoginIdentity(account, dummyUserId, body.password, {
        lookupEmail: async (userId) => {
          const { data: user } = await admin.auth.admin.getUserById(userId)
          return user.user?.email ?? null
        },
        signIn: async (email, password) => {
          const { data, error } = await authClient.auth.signInWithPassword({ email, password })
          return error ? null : data.session
        },
      })
      if (!authentication.accepted || !authentication.session) {
        await registerLoginFailure(admin, normalized, rateLimitContext)
        return json(401, { error: GENERIC_ERROR }, origin)
      }

      await registerLoginSuccess(admin, normalized, rateLimitContext)
      await admin.from('customer_portal_accounts').update({ last_login_at: new Date().toISOString() }).eq('login_cnpj', normalized)
      return json(200, {
        access_token: authentication.session.access_token,
        refresh_token: authentication.session.refresh_token,
        expires_at: authentication.session.expires_at,
      }, origin)
    } catch {
      logEdgeFailure({ functionName: 'portal-login', job: 'login', errorCode: 'unexpected_failure' })
      return json(500, { error: 'Portal indisponível.' }, origin)
    }
  })
}
