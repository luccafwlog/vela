// Consulta de container pública do fwlog.com.br (ADR 0114). Sem sessão:
// Turnstile por consulta e limites por IP e globais no Upstash, fail-closed;
// regras em ../_shared/publicFwlog.ts.
import { createClient } from '@supabase/supabase-js'
import { handlePublicContainerLookup, runtimeDeps } from '../_shared/publicFwlog.ts'
import { captureEdgeWarning, instrumentEdgeHandler } from '../_shared/telemetry.ts'

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined

const FUNCTION_NAME = 'public-container-lookup'

if (typeof Deno !== 'undefined') {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const admin = url && serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false } }) : null
  const deps = runtimeDeps(
    async (fn, args) => {
      if (!admin) return { data: null, error: new Error('Supabase não configurado') }
      return await admin.rpc(fn, args)
    },
    // Aviso em segundo plano: a resposta não espera o Sentry.
    (status) => {
      const work = captureEdgeWarning('Consulta pública de container: disjuntor global aberto até a hora virar', {
        functionName: FUNCTION_NAME,
        category: 'disjuntor_global',
        status,
      })
      if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(work)
    },
  )
  Deno.serve(instrumentEdgeHandler(FUNCTION_NAME, (req) => handlePublicContainerLookup(req, deps)))
}
