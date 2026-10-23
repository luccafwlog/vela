import { createClient, type SupabaseClient } from '@supabase/supabase-js'
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

type AppSupabaseClient = SupabaseClient<AppDatabase>

// Cada entrada (Vela em `index.html`, Portal em `portal.html`) importa este
// módulo, e serviços compartilhados importam os dois clientes. Criar o
// cliente na importação fazia o bundle do Portal instanciar o cliente interno,
// que lê a URL (`detectSessionInUrl: true`, PKCE) e trocaria um `?code=` do
// Portal por sessão interna. O cliente só nasce no primeiro uso; o Proxy
// mantém a API (`supabase.from`, `supabase.auth`, …) para todos os chamadores.
// ponytail: métodos lidos pelo Proxy saem com `bind`, então
// `supabase.from !== supabase.from`; nenhum chamador compara essas funções.
function lazyClient(create: () => AppSupabaseClient): AppSupabaseClient {
  let instance: AppSupabaseClient | null = null
  const resolve = () => (instance ??= create())
  return new Proxy({} as AppSupabaseClient, {
    get(_target, property) {
      const client = resolve()
      const value: unknown = Reflect.get(client, property, client)
      return typeof value === 'function' ? value.bind(client) : value
    },
    set(_target, property, value) {
      return Reflect.set(resolve(), property, value)
    },
    has(_target, property) {
      return Reflect.has(resolve(), property)
    },
  })
}

export const supabase = lazyClient(() => createClient<AppDatabase>(supabaseUrl ?? fallbackSupabaseUrl, supabaseAnonKey ?? fallbackSupabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // PKCE (auditoria run-2, #12, D3 = a): o link de confirmação da troca de
    // e-mail traz um código, não tokens no fragmento, e só vale no navegador
    // que pediu a troca.
    flowType: 'pkce',
  },
}))

// Cliente dedicado ao Portal do Cliente. Em produção cada app tem seu domínio
// (`vela.app.br` e `portalfwlog.com.br`), mas no desenvolvimento local e em
// qualquer origem que sirva as duas entradas elas dividem o localStorage; sem
// um storageKey próprio as duas sessões se sobreporiam e um login derrubaria o
// outro. storageKey distinto isola as sessões (interno x portal) por completo.
export const supabasePortal = lazyClient(() => createClient<AppDatabase>(supabaseUrl ?? fallbackSupabaseUrl, supabaseAnonKey ?? fallbackSupabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'td-portal-auth',
  },
}))
