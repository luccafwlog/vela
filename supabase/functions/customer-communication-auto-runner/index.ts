import { createClient } from '@supabase/supabase-js'
import { runCronWithBetterStackHeartbeat } from '../_shared/betterStackHeartbeat.ts'
import { runAutomaticCommunications, type AutoRunnerDispatchResult } from '../_shared/customerCommunicationAutoRunner.ts'
import { dispatchCustomerCommunication, type Admin } from '../_shared/customerCommunicationDispatch.ts'
import { captureEdgeException, instrumentEdgeHandler } from '../_shared/telemetry.ts'
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

// Envio de um destinatário no mesmo processo, sem POST à Edge
// send-customer-communication: a Supabase limita as chamadas entre Edge
// Functions e, em 07/11/2026, recusou da 31ª em diante. Os 5xx e as exceções
// do envio continuam indo ao Sentry com o nome da send-customer-communication,
// como quando passavam pelo handler dela.
async function dispatchInProcess(admin: Admin, payload: Record<string, unknown>): Promise<AutoRunnerDispatchResult> {
  const startedAt = Date.now()
  const context = { functionName: 'send-customer-communication', jobName: 'customer-communication-auto-runner' }
  try {
    const result = await dispatchCustomerCommunication(admin, payload, { isAutomation: true, userId: null })
    if (result.status >= 500) {
      await captureEdgeException(new Error('Edge Function returned a server error'), {
        ...context, status: `http_${result.status}`, category: 'server_error', durationMs: Date.now() - startedAt,
      })
    }
    return result
  } catch (error) {
    await captureEdgeException(error, { ...context, status: 'uncaught', category: 'uncaught_exception', durationMs: Date.now() - startedAt })
    throw error
  }
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
    dispatch: (payload) => dispatchInProcess(admin, payload),
    // Configuração única do endereço do Portal (ponto 4 de 2026-10-23).
    portalUrl: canonicalPortalUrl('billing'),
  })
  return json(result.status, result.body, result.headers)
}

if (import.meta.main) {
  const edgeHandler = instrumentEdgeHandler('customer-communication-auto-runner', handler)
  // Os gatilhos do banco (migration 458) mandam {"source":"trigger"}: roda igual e reporta só a falha.
  Deno.serve((req) => {
    const expectedSecret = Deno.env.get('CUSTOMER_COMMUNICATION_AUTOMATION_SECRET') ?? ''
    const providedSecret = req.headers.get('X-Communication-Automation-Secret') ?? ''
    const authorized = req.method === 'POST' && Boolean(expectedSecret) && timingSafeEqual(providedSecret, expectedSecret)
    return runCronWithBetterStackHeartbeat('customerCommunicationAutoRunner', req, authorized, () => edgeHandler(req))
  })
}
