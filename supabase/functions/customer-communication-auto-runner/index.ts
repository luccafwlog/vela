import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2'
import { runWithBetterStackHeartbeat } from '../_shared/betterStackHeartbeat.ts'
import { runAutomaticCommunications } from '../_shared/customerCommunicationAutoRunner.ts'
import { instrumentEdgeHandler } from '../_shared/telemetry.ts'

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
  if (!url || !serviceKey) return json(500, { error: 'Configuração do Supabase ausente.' })
  const admin = createClient(url, serviceKey)
  const result = await runAutomaticCommunications({
    rpc: (fn, args) => admin.rpc(fn, args),
    fetcher: fetch,
    supabaseUrl: url,
    serviceKey,
    secret,
    portalUrl: Deno.env.get('PORTAL_URL'),
  })
  return json(result.status, result.body, result.headers)
}

if (import.meta.main) {
  const edgeHandler = instrumentEdgeHandler('customer-communication-auto-runner', handler)
  Deno.serve((req) => {
    const expectedSecret = Deno.env.get('CUSTOMER_COMMUNICATION_AUTOMATION_SECRET') ?? ''
    const providedSecret = req.headers.get('X-Communication-Automation-Secret') ?? ''
    const authorized = req.method === 'POST' && Boolean(expectedSecret) && timingSafeEqual(providedSecret, expectedSecret)
    return runWithBetterStackHeartbeat('customerCommunicationAutoRunner', () => edgeHandler(req), { enabled: authorized })
  })
}
