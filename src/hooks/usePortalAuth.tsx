/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as Sentry from '@sentry/react'
import { supabasePortal } from '../services/supabase'
import { signOutSupabaseClient } from '../services/supabaseAuth'
import { canonicalizeDocument } from '../lib/cnpj'
import { isPortalTurnstileRejection } from '../lib/portalTurnstileError'
import type { PortalSessionOverview } from '../services/portalBilling'

type PortalAuthContextValue = {
  overview: PortalSessionOverview | null
  loading: boolean
  isAuthenticated: boolean
  isSigningOut: boolean
  signOutError: string | null
  signIn: (cnpj: string, password: string, turnstileToken: string) => Promise<void>
  signOut: () => Promise<void>
  refreshOverview: () => Promise<void>
}

// Exportado para `usePortalScope`, que precisa ler a sessao do Cliente sem
// lancar quando ela nao existe (modo Inspecao e testes isolados).
export const PortalAuthContext = createContext<PortalAuthContextValue | null>(null)

function isPortalSessionError(error: unknown) {
  const code = typeof error === 'object' && error ? String((error as { code?: string }).code ?? '') : ''
  const message = typeof error === 'object' && error ? String((error as { message?: string }).message ?? '') : ''
  return code === '28000' || message.toLowerCase().includes('sessao do portal')
}

function normalizePortalOverview(payload: Record<string, unknown>) {
  return {
    customer_id: Number(payload.customer_id ?? 0),
    customer_name: String(payload.customer_name ?? ''),
    customer_cnpj_cpf: String(payload.customer_cnpj_cpf ?? payload.cnpj_cpf ?? ''),
    pending_balance: payload.pending_balance == null ? null : Number(payload.pending_balance),
    contact_email: payload.contact_email == null ? null : String(payload.contact_email),
    login_cnpj: payload.login_cnpj == null ? null : String(payload.login_cnpj),
    account_active: payload.account_active == null ? undefined : Boolean(payload.account_active),
  } as PortalSessionOverview
}

async function fetchOverview(): Promise<PortalSessionOverview> {
  const { data, error } = await supabasePortal.rpc('portal_get_session_overview_v2')
  if (error) throw error
  return normalizePortalOverview((data ?? {}) as Record<string, unknown>)
}

function setPortalTelemetryUser() {
  // O Portal não envia ID estável de cliente ao Sentry.
  Sentry.setUser(null)
  Sentry.setTag('area', 'portal')
}

export function PortalAuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient()
  const [overview, setOverview] = useState<PortalSessionOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  const clearPortalQueries = useCallback(() => {
    queryClient.removeQueries({
      predicate: (query) => String(query.queryKey[0]).startsWith('portal-'),
    })
  }, [queryClient])

  const clearSession = useCallback(() => {
    setOverview(null)
    Sentry.setUser(null)
    clearPortalQueries()
  }, [clearPortalQueries])

  useEffect(() => {
    let mounted = true
    let hydrating = true

    async function hydrate() {
      try {
        const { data: { session } } = await supabasePortal.auth.getSession()
        if (!session) return

        const ov = await fetchOverview()
        if (mounted) {
          setOverview(ov)
          setPortalTelemetryUser()
        }
      } catch (error) {
        // Sessão Supabase pode existir sem perfil de portal (ex.: usuário interno);
        // nesse caso apenas não autentica no portal, sem derrubar a sessão global.
        if (isPortalSessionError(error) && mounted) clearSession()
      } finally {
        if (mounted) setLoading(false)
        hydrating = false
      }
    }

    void hydrate()
    const { data: { subscription } } = supabasePortal.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        clearSession()
        return
      }

      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && !hydrating) {
        void fetchOverview()
          .then((ov) => {
            if (mounted) setOverview((current) => current ?? ov)
            if (mounted) setPortalTelemetryUser()
          })
          .catch((error) => {
            if (isPortalSessionError(error) && mounted) clearSession()
          })
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [clearSession])

  const signIn = useCallback(async (cnpj: string, password: string, turnstileToken: string) => {
    setLoading(true)
    setSignOutError(null)
    try {
      const normalized = canonicalizeDocument(cnpj)
      if (!normalized) throw new Error('CNPJ ou senha inválidos.')
      const { data, error } = await supabasePortal.functions.invoke('portal-login', { body: { cnpj: normalized, password, turnstile_token: turnstileToken } })
      if (isPortalTurnstileRejection(error)) throw Object.assign(new Error('Verificação de segurança inválida.'), { code: 'TURNSTILE_REJECTED' })
      if (error || !data?.access_token) throw new Error('CNPJ ou senha inválidos.')
      const { error: sessionError } = await supabasePortal.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token })
      if (sessionError) throw new Error('CNPJ ou senha inválidos.')
      const ov = await fetchOverview()
      setOverview(ov)
      setPortalTelemetryUser()
    } finally {
      setLoading(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    setIsSigningOut(true)
    setSignOutError(null)
    clearSession()
    try {
      await signOutSupabaseClient(supabasePortal)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Sessão encerrada localmente, mas a revogação remota falhou.'
      setSignOutError(message)
      console.warn('[PortalAuth] Falha na revogação remota de sessão; saída local forçada:', error)
    } finally {
      setIsSigningOut(false)
    }
  }, [clearSession])

  const refreshOverview = useCallback(async () => {
    try {
      const ov = await fetchOverview()
      setOverview(ov)
      setPortalTelemetryUser()
    } catch (error) {
      if (isPortalSessionError(error)) clearSession()
      throw error
    }
  }, [clearSession])

  const value = useMemo(
    () => ({
      overview,
      loading,
      isAuthenticated: Boolean(overview),
      isSigningOut,
      signOutError,
      signIn,
      signOut,
      refreshOverview,
    }),
    [isSigningOut, loading, overview, refreshOverview, signIn, signOut, signOutError],
  )

  return <PortalAuthContext.Provider value={value}>{children}</PortalAuthContext.Provider>
}

export function PortalInspectionAuthProvider({
  overview,
  children,
}: PropsWithChildren<{ overview: PortalSessionOverview }>) {
  const signIn = useCallback(async () => {
    throw new Error('Login do Portal indisponível no Modo Inspeção.')
  }, [])
  const signOut = useCallback(async () => {}, [])
  const refreshOverview = useCallback(async () => {}, [])
  const value = useMemo<PortalAuthContextValue>(
    () => ({
      overview,
      loading: false,
      isAuthenticated: true,
      isSigningOut: false,
      signOutError: null,
      signIn,
      signOut,
      refreshOverview,
    }),
    [overview, refreshOverview, signIn, signOut],
  )

  return <PortalAuthContext.Provider value={value}>{children}</PortalAuthContext.Provider>
}

export function usePortalAuth() {
  const context = useContext(PortalAuthContext)
  if (!context) {
    throw new Error('usePortalAuth deve ser usado dentro de PortalAuthProvider.')
  }
  return context
}
