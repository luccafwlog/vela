// Consulta de container pública do fwlog.com.br (ADR 0112). Sem sessão:
// Turnstile por consulta e limites por IP e globais no Upstash, fail-closed;
// regras em ../_shared/publicFwlog.ts.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2'
import { handlePublicContainerLookup, runtimeDeps } from '../_shared/publicFwlog.ts'
import { instrumentEdgeHandler } from '../_shared/telemetry.ts'

if (typeof Deno !== 'undefined') {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const admin = url && serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false } }) : null
  const deps = runtimeDeps(async (fn, args) => {
    if (!admin) return { data: null, error: new Error('Supabase não configurado') }
    return await admin.rpc(fn, args)
  })
  Deno.serve(instrumentEdgeHandler('public-container-lookup', (req) => handlePublicContainerLookup(req, deps)))
}
