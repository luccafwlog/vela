// Consulta de CNPJ na BrasilAPI para o Novo cliente (ADR 0126). Só sessão
// interna; regras e resposta por lista positiva em ../_shared/cnpjLookup.ts.
import { createClient } from '@supabase/supabase-js'
import { handleCnpjLookup } from '../_shared/cnpjLookup.ts'
import { instrumentEdgeHandler } from '../_shared/telemetry.ts'

if (typeof Deno !== 'undefined') {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  Deno.serve(instrumentEdgeHandler('cnpj-lookup', (req) => handleCnpjLookup(req, {
    resolveRole: async (authorization) => {
      const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
      // Papel interno ativo (`_portal_actor_role`); conta do Portal e sessão sem perfil voltam null.
      const { data, error } = await caller.rpc('portal_current_role')
      return error || typeof data !== 'string' || !data ? null : data
    },
    fetcher: (input, init) => fetch(input, init),
  })))
}
