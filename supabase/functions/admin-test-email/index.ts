import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../_shared/cors.ts'
import { adminTestEmailTemplate, decideAdminTestEmail } from '../_shared/adminTestEmail.ts'
import { sendPortalEmail } from '../_shared/portalEmail.ts'

// Administração › Sistema › Configurações › "Enviar teste para mim" (migration
// 605). Só a conta Dev (`is_dev_user()`, conferido com a sessão de quem chama);
// o e-mail vai ao próprio login, registrado em `portal_email_attempts` como
// `teste_envio`.

const json = (status: number, body: unknown, origin: string | null) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })

if (typeof Deno !== 'undefined') Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return json(204, null, origin)
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, origin)

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })

  const [{ data: isDev }, { data: callerUser }] = await Promise.all([caller.rpc('is_dev_user'), caller.auth.getUser()])
  const user = callerUser.user
  const decision = decideAdminTestEmail({ isDev: isDev === true && Boolean(user), email: user?.email })
  if (!decision.ok) return json(decision.status, { error: decision.error }, origin)

  const admin = createClient(url, service)
  const [{ data: profile }, { data: settings }] = await Promise.all([
    admin.from('user_profiles').select('full_name').eq('id', user!.id).maybeSingle(),
    admin.from('app_settings').select('communications_enabled').eq('id', 1).maybeSingle(),
  ])
  const sentAt = new Date()
  const template = adminTestEmailTemplate({
    name: (profile as { full_name?: string } | null)?.full_name ?? decision.to,
    sentAt,
    communicationsEnabled: (settings as { communications_enabled?: boolean } | null)?.communications_enabled === true,
  })
  try {
    const result = await sendPortalEmail({
      admin,
      kind: 'teste_envio',
      to: decision.to,
      subject: template.subject,
      html: template.html,
      text: template.text,
      idempotencyKey: `teste_envio:${user!.id}:${sentAt.getTime()}`,
    })
    if (result.suppressed) return json(422, { error: 'O seu e-mail está bloqueado por devolução ou spam: o teste não saiu.' }, origin)
    if (!result.ok) return json(502, { error: 'O provedor de e-mail não aceitou o teste. Tente de novo em alguns minutos.' }, origin)
    return json(200, { to: decision.to }, origin)
  } catch {
    return json(502, { error: 'O provedor de e-mail não aceitou o teste. Tente de novo em alguns minutos.' }, origin)
  }
})
