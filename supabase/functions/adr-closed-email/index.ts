import { createClient } from '@supabase/supabase-js'
import { recipientKey } from '../_shared/email.ts'
import { adrClosedTemplate, runAdrClosedEmail, type AdrClosedRow } from '../_shared/adrClosedEmail.ts'
import { sendPortalEmail } from '../_shared/portalEmail.ts'
import { instrumentEdgeHandler } from '../_shared/telemetry.ts'

// E-mail "ADR fechado" a todos os usuários internos ativos (migration 611, ADR 0131 D6).
// Bearer dedicado e server-only: ADR_CLOSED_EMAIL_SECRET. Chamada pelo gatilho da fila
// (`ops.kick_edge_job`) e pela rotina manual de 5 minutos. E-mail da equipe: não passa pela
// chave de envio (ADR 0104), como o resumo diário.
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index]
  return diff === 0
}

function authorized(req: Request): boolean {
  const expected = Deno.env.get('ADR_CLOSED_EMAIL_SECRET') ?? ''
  const provided = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  return req.method === 'POST' && Boolean(expected) && timingSafeEqual(provided, expected)
}

if (typeof Deno !== 'undefined') {
  const edgeHandler = instrumentEdgeHandler('adr-closed-email', async (req) => {
    if (!authorized(req)) return new Response('Acesso negado', { status: 403 })
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!serviceRoleKey) return new Response(JSON.stringify({ error: 'internal_configuration_error' }), { status: 500 })
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceRoleKey)
    const appOrigin = Deno.env.get('VELA_APP_URL')?.trim() || 'https://vela.app.br'
    const result = await runAdrClosedEmail({
      pending: async () => {
        const { data, error } = await admin.rpc('adr_closed_email_pending', { p_limit: 10 })
        if (error) throw error
        const payload = (data ?? {}) as { rows?: AdrClosedRow[]; recipients?: string[] }
        return { rows: payload.rows ?? [], recipients: payload.recipients ?? [] }
      },
      recipientKey,
      send: async ({ row, to, idempotencyKey }) => {
        const mail = adrClosedTemplate(row, appOrigin)
        const sent = await sendPortalEmail({ admin, kind: 'adr_fechado', to, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey, simulate: false })
        return sent.ok ? 'sent' : sent.suppressed ? 'suppressed' : 'failed'
      },
      finish: async (id, status, error) => {
        const { error: finishError } = await admin.rpc('adr_closed_email_finish', { p_id: id, p_status: status, p_error: error ?? null })
        if (finishError) throw finishError
      },
    })
    return new Response(JSON.stringify(result.body), { status: result.status })
  })

  // ponytail: sem heartbeat no Better Stack; a falha chega ao Sentry (status 500) e a linha
  // volta à fila. Upgrade: um job em `BetterStackHeartbeatJob` com o monitor cadastrado.
  Deno.serve(edgeHandler)
}
