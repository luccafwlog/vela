// S05 — runner da fila de efeitos de import.
//
// O claim e a execução de cada efeito são server-only. A Edge Function só
// coordena blocos pequenos dentro de um orçamento de tempo (`drain.ts`); a
// transação, a classificação de erro e a conclusão idempotente vivem em
// `process_import_effect`.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2'
import { instrumentEdgeHandler } from '../_shared/telemetry.ts'
import { drainImportEffects } from './drain.ts'

function timingSafeEqual(leftValue: string, rightValue: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(leftValue)
  const right = encoder.encode(rightValue)
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(instrumentEdgeHandler('import-effects-runner', async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const expectedSecret = Deno.env.get('IMPORT_EFFECTS_CRON_SECRET') ?? ''
  const providedSecret = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!expectedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
    return json(401, { error: 'unauthorized' })
  }

  // Keep this fail-closed until handlers for physical flags, provisional
  // charges and billing are enabled together. In particular, Demurrage is not
  // emitted automatically before its server-side snapshot contract (S08-B).
  if (Deno.env.get('IMPORT_EFFECTS_RUNNER_ENABLED') !== 'true') {
    return json(503, { status: 'paused', reason: 'consumers_not_activated' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: 'internal_configuration_error' })

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const workerId = `import-effects-runner:${crypto.randomUUID()}`
  const startedAt = Date.now()
  const result = await drainImportEffects((name, args) => supabase.rpc(name, args), workerId)
  if (!result.ok) return json(502, { error: result.error })

  return json(200, {
    ok: true,
    worker_id: workerId,
    claimed: result.claimed,
    completed: result.outcomes.length,
    elapsed_ms: Date.now() - startedAt,
    outcomes: result.outcomes,
  })
}))
