// Envio de Comunicado pela tela. A Edge autentica quem chama (setor interno ou
// a régua automática pelo segredo) e o envio em si fica no módulo compartilhado,
// que a customer-communication-auto-runner chama direto, sem passar por aqui
// (_shared/customerCommunicationDispatch.ts).
import { createClient } from '@supabase/supabase-js'
import { corsHeaders, withCors } from '../_shared/cors.ts'
import { instrumentEdgeHandler } from '../_shared/telemetry.ts'
import {
  dispatchCustomerCommunication,
  permanentRejection,
  type CustomerCommunicationDispatchResult,
} from '../_shared/customerCommunicationDispatch.ts'

function json(status: number, body: unknown, origin: string | null): Response {
  // Recusas desta camada (método, sessão, setor) deixam o motivo no log; as do
  // envio são logadas pelo módulo compartilhado.
  if (status >= 400 && status < 500) {
    const error = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined
    console.warn('[send-customer-communication] recusa', { status, error })
  }
  return respond({ status, body: (body ?? {}) as Record<string, unknown> }, origin)
}

function respond(result: CustomerCommunicationDispatchResult, origin: string | null): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}

function timingSafeEqual(leftValue: string, rightValue: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(leftValue)
  const right = encoder.encode(rightValue)
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

const INTERNAL_ROLES = ['administrativo', 'financeiro', 'operacoes', 'documentacao', 'equipamentos']

async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('Origin')
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, origin)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) return json(500, { error: 'Configuração do Supabase ausente.' }, origin)

  const jwt = req.headers.get('Authorization') ?? ''
  if (!/^Bearer\s+\S+/i.test(jwt)) return json(401, { error: 'Autenticação obrigatória.' }, origin)

  const automationSecret = Deno.env.get('CUSTOMER_COMMUNICATION_AUTOMATION_SECRET') ?? ''
  const providedAutomationSecret = req.headers.get('X-Communication-Automation-Secret') ?? ''
  const isAutomation = Boolean(automationSecret && timingSafeEqual(providedAutomationSecret, automationSecret))

  const caller = createClient(url, anonKey, { global: { headers: { Authorization: jwt } } })
  const { data: role, error: roleError } = isAutomation ? { data: 'automatico', error: null } : await caller.rpc('portal_current_role')
  // Todo setor interno ativo dispara Comunicado (decisão do dono de 2026-10-27,
  // ficha ACE-D01, opção A); `portal_current_role` é nulo fora dele.
  if (!isAutomation && (roleError || !INTERNAL_ROLES.includes(String(role)))) {
    return json(403, { error: 'Sem permissão para Comunicados.' }, origin)
  }
  const { data: callerUser } = isAutomation ? { data: { user: null } } : await caller.auth.getUser()
  if (!isAutomation && !callerUser.user) return json(401, { error: 'Sessão inválida.' }, origin)

  // Com o segredo da automação, o envio segue como o da régua. Desde que a régua
  // chama o módulo direto (07/11/2026), nenhuma rotina usa este caminho; ele fica
  // para a transição do deploy e para voltar a versão anterior da régua.
  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch (error) {
    return respond(permanentRejection(error instanceof Error ? error.message : 'Payload inválido.'), origin)
  }
  const admin = createClient(url, serviceKey)
  return respond(await dispatchCustomerCommunication(admin, rawBody, {
    isAutomation,
    userId: callerUser.user?.id ?? null,
  }), origin)
}

if (typeof Deno !== 'undefined') {
  Deno.serve(instrumentEdgeHandler('send-customer-communication', withCors(handler)))
}
