// S05 — runner da fila de efeitos de import.
//
// O claim e a execução de cada efeito são server-only. A Edge Function só
// coordena lotes pequenos; a transação, a classificação de erro e a conclusão
// idempotente vivem em `process_import_effect`.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
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
  const { data: claimed, error: claimError } = await supabase.rpc('claim_import_effects', {
    p_worker_id: workerId,
    p_limit: 20,
    p_lease_seconds: 300,
  })
  if (claimError) {
    console.error('import-effects-runner: claim falhou', claimError)
    return json(502, { error: 'claim_failed' })
  }

  const effects = Array.isArray(claimed) ? claimed : []
  const outcomes: Array<{ effect_id: number; status: string }> = []
  for (const effect of effects) {
    const effectId = Number((effect as { id?: unknown }).id)
    if (!Number.isSafeInteger(effectId) || effectId <= 0) {
      console.error('import-effects-runner: claim retornou id inválido')
      continue
    }

    const { data: processResult, error: processError } = await supabase.rpc('process_import_effect', {
      p_effect_id: effectId,
      p_worker_id: workerId,
    })
    if (processError) {
      // Em erro de rede o lease expira e outro ciclo recupera o efeito. O
      // payload não é repetido no log para não vazar snapshot de importação.
      console.error('import-effects-runner: processamento falhou', { effectId, error: processError })
      outcomes.push({ effect_id: effectId, status: 'completed_with_error' })
      continue
    }
    const processedStatus = (processResult as { effect?: { status?: unknown } } | null)?.effect?.status
    outcomes.push({ effect_id: effectId, status: typeof processedStatus === 'string' ? processedStatus : 'completed' })
  }

  return json(200, {
    ok: true,
    worker_id: workerId,
    claimed: effects.length,
    completed: outcomes.length,
    outcomes,
  })
}))
