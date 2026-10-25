import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2'
import { runCronWithBetterStackHeartbeat } from '../_shared/betterStackHeartbeat.ts'
import { runAutomaticCommunications } from '../_shared/customerCommunicationAutoRunner.ts'
import { instrumentEdgeHandler } from '../_shared/telemetry.ts'
import { canonicalPortalUrl } from '../_shared/portalUrls.ts'

function timingSafeEqual(leftValue: string, rightValue: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(leftValue)
  const right = encoder.encode(rightValue)
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

function json(status: number, value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const secret = Deno.env.get('CUSTOMER_COMMUNICATION_AUTOMATION_SECRET') ?? ''
  const providedSecret = req.headers.get('X-Communication-Automation-Secret') ?? ''
  if (!secret || !timingSafeEqual(providedSecret, secret)) return json(401, { error: 'Não autorizado.' })
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !serviceKey || !anonKey) return json(500, { error: 'Configuração do Supabase ausente.' })
  const admin = createClient(url, serviceKey)
  const result = await runAutomaticCommunications({
    rpc: (fn, args) => admin.rpc(fn, args),
    fetcher: fetch,
    supabaseUrl: url,
    anonKey,
    secret,
    // Configuração única do endereço do Portal (ponto 4 de 2026-10-23).
    portalUrl: canonicalPortalUrl('billing'),
  })
  return json(result.status, result.body, result.headers)
}

if (import.meta.main) {
  const edgeHandler = instrumentEdgeHandler('customer-communication-auto-runner', handler)
  // Os gatilhos do banco (migration 456) mandam {"source":"trigger"}: roda igual e reporta só a falha.
  Deno.serve((req) => {
    const expectedSecret = Deno.env.get('CUSTOMER_COMMUNICATION_AUTOMATION_SECRET') ?? ''
    const providedSecret = req.headers.get('X-Communication-Automation-Secret') ?? ''
    const authorized = req.method === 'POST' && Boolean(expectedSecret) && timingSafeEqual(providedSecret, expectedSecret)
    return runCronWithBetterStackHeartbeat('customerCommunicationAutoRunner', req, authorized, () => edgeHandler(req))
  })
}
