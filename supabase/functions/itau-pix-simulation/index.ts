import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2'
import { instrumentEdgeHandler } from '../_shared/telemetry.ts'

Deno.serve(instrumentEdgeHandler('itau-pix-simulation', async (request: Request) => {
  const secret = Deno.env.get('PIX_SIMULATION_RUNNER_SECRET') ?? ''
  const authorization = request.headers.get('authorization') ?? ''
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  // O segredo não é uma credencial bancária; nenhuma sessão do navegador é aceita.
  const a = new TextEncoder().encode(secret)
  const b = new TextEncoder().encode(supplied)
  let mismatch = a.length ^ b.length
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ (b[i] ?? 0)
  if (secret.length < 32 || mismatch !== 0) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (Deno.env.get('PIX_SIMULATION_ENABLED') !== 'true' || !url || !key ||
      new URL(url).hostname === 'fgmkhbzhaeebrsizwccx.supabase.co') {
    return Response.json({ error: 'simulation_disabled' }, { status: 403 })
  }
  // O relógio é controlado somente via SQL local nos testes; o endpoint usa agora.
  const client = createClient(url, key)
  const { data, error } = await client.rpc('run_pix_simulation', { p_at: new Date().toISOString() })
  if (error) return Response.json({ error: 'simulation_failed' }, { status: 500 })
  return Response.json(data)
}))
