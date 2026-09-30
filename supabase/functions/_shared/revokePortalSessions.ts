import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2'

// Revoga todas as sessões do usuário do Portal. O endpoint admin do GoTrue
// (POST /admin/users/{id}/logout) retorna 404 nesta versão, então usamos a RPC
// portal_revoke_sessions (migration 194), que apaga sessões e refresh tokens.
export async function revokePortalSessions(userId: string): Promise<void> {
  const baseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!baseUrl || !serviceRoleKey) throw new Error('Supabase admin credentials are unavailable')
  const admin = createClient(baseUrl, serviceRoleKey)
  const { error } = await admin.rpc('portal_revoke_sessions', { p_user_id: userId })
  if (error) throw new Error(`Could not revoke portal sessions: ${error.message}`)
}
