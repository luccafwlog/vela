import { createClient } from '@supabase/supabase-js'
import type { AppDatabase } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const fallbackSupabaseUrl = 'http://127.0.0.1:54321'
const fallbackSupabaseAnonKey = 'missing-supabase-anon-key'

export const isSupabaseConfigured = Boolean(supabaseUrl) && Boolean(supabaseAnonKey)

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '[supabase] VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórias. ' +
      'Configure o arquivo .env antes de iniciar a aplicação.',
  )
}

export const supabase = createClient<AppDatabase>(supabaseUrl ?? fallbackSupabaseUrl, supabaseAnonKey ?? fallbackSupabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // PKCE (auditoria run-2, #12, D3 = a): o link de confirmação da troca de
    // e-mail traz um código, não tokens no fragmento, e só vale no navegador
    // que pediu a troca.
    flowType: 'pkce',
  },
})

// Cliente dedicado ao Portal do Cliente. O portal e o app interno rodam no mesmo
// projeto Supabase e no mesmo domínio; sem um storageKey próprio eles
// compartilhariam a mesma sessão no navegador e um login derrubaria o outro.
// storageKey distinto isola as sessões (interno x portal) por completo.
export const supabasePortal = createClient<AppDatabase>(supabaseUrl ?? fallbackSupabaseUrl, supabaseAnonKey ?? fallbackSupabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'td-portal-auth',
  },
})
