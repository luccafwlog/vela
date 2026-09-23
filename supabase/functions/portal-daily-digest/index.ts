import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { runWithBetterStackHeartbeat } from '../_shared/betterStackHeartbeat.ts'
import { dailyDigestTemplate } from '../_shared/portalEmailTemplates.ts'
import { sendPortalEmail } from '../_shared/portalEmail.ts'
import { canonicalPortalOrigin, portalSupportEmail } from '../_shared/portalUrls.ts'
import { instrumentEdgeHandler, instrumentEdgeJob, summarizeEdgeJobResponse } from '../_shared/telemetry.ts'

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index]
  return diff === 0
}

if (typeof Deno !== 'undefined') {
  const edgeHandler = instrumentEdgeHandler('portal-daily-digest', async (req) => {
    if (req.method !== 'POST') return new Response(null, { status: 405 })
    const expectedSecret = Deno.env.get('PORTAL_DIGEST_SECRET')
    const providedSecret = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    if (!expectedSecret || !timingSafeEqual(providedSecret, expectedSecret)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!serviceRoleKey) return new Response(JSON.stringify({ error: 'internal_configuration_error' }), { status: 500 })
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceRoleKey)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const [failuresResult, eventsResult, pendingResult, usersResult] = await Promise.all([
      admin.from('portal_email_attempts').select('id').in('status', ['bounce', 'complaint', 'falha_transitoria', 'falha_permanente']).gte('created_at', since),
      admin.from('portal_provisioning_events').select('id').gte('created_at', since),
      admin.from('customer_portal_accounts').select('id').eq('account_situation', 'convite_pendente'),
      admin.from('user_profiles').select('id').eq('active', true).in('role', ['admin', 'administrativo', 'documentacao']),
    ])
    if (failuresResult.error || eventsResult.error || pendingResult.error || usersResult.error) {
      return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500 })
    }
    const failures = failuresResult.data
    const events = eventsResult.data
    const pending = pendingResult.data
    const users = usersResult.data
    const counts = { failures: failures?.length ?? 0, activity: events?.length ?? 0, pending: pending?.length ?? 0 }
    if (counts.failures + counts.activity + counts.pending === 0) return new Response(JSON.stringify({ sent: 0 }), { status: 200 })
    const date = new Date().toISOString().slice(0, 10)
    const portalUrl = canonicalPortalOrigin()
    const supportEmail = portalSupportEmail()
    const template = dailyDigestTemplate({ date, failures: counts.failures, activity: counts.activity, pending: counts.pending, portalUrl, supportEmail })
    let sent = 0
    let failed = 0
    for (const user of users ?? []) {
      const { data: authUser, error: authError } = await admin.auth.admin.getUserById(user.id)
      if (authError) {
        failed += 1
        continue
      }
      const email = authUser.user?.email
      if (!email) {
        failed += 1
        continue
      }
      const result = await sendPortalEmail({ admin, kind: 'resumo_diario', to: email, subject: template.subject, html: template.html, text: template.text, idempotencyKey: `resumo:${date}:${email.toLowerCase()}` })
      if (result.ok) sent += 1
      else failed += 1
    }
    return new Response(JSON.stringify({ sent, failed }), { status: 200 })
  })
  Deno.serve((req) => {
    const expectedSecret = Deno.env.get('PORTAL_DIGEST_SECRET') ?? ''
    const providedSecret = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    const authorized = req.method === 'POST' && Boolean(expectedSecret) && timingSafeEqual(providedSecret, expectedSecret)
    return runWithBetterStackHeartbeat('portalDailyDigest', () => instrumentEdgeJob(
      'portal-daily-digest',
      'digest_recipients_attempted',
      () => edgeHandler(req),
      (response) => summarizeEdgeJobResponse(
        response,
        (body) => (typeof body.sent === 'number' ? body.sent : 0)
          + (typeof body.failed === 'number' ? body.failed : 0),
        (body) => typeof body.failed === 'number' && body.failed > 0,
      ),
      authorized,
    ), { enabled: authorized })
  })
}
