/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../services/supabase'
import { signOutSupabaseClient } from '../services/supabaseAuth'
import { extractErrorText } from '../lib/errors'
import type { UserProfile, UserProfileRole } from '../types/database'
import { markStartupStage, setTelemetryUser } from '../lib/telemetry'

export function shouldHydrateProfile(nextUserId: string | null, hydratedUserId: string | null): boolean {
  return nextUserId !== null && nextUserId !== hydratedUserId
}

export type ProfileHydrationStatus = 'loading' | 'ready' | 'transient-error' | 'unauthorized' | 'signed-out'

/**
 * Erro transitório (rede/timeout/RLS) mantém a sessão e permite retry com as
 * ações bloqueadas; perfil ausente/inválido confirmado elimina o acesso.
 * `PGRST116` é o "0 rows" do `.single()` com `active = true`: perfil inativo
 * ou removido. Mensagem de papel inválido também é decisão, não transiência.
 */
export function classifyProfileHydrationError(error: unknown): 'transient-error' | 'unauthorized' {
  if (error && typeof error === 'object') {
    if ((error as { code?: unknown }).code === 'PGRST116') return 'unauthorized'
  }
  if (error instanceof Error && error.message === 'Perfil de usuário inválido.') return 'unauthorized'
  return 'transient-error'
}

export type Permission =
  | 'admin_panel'
  | 'manage_users'
  | 'portal_provisioning'
  | 'settle_financial_adjustments'
  | 'customer_communications'

export function roleHasPermission(role: UserProfileRole | undefined, permission: Permission): boolean {
  if (!role) return false
  // Papel legado: operator = documentacao. O papel `admin` foi migrado para
  // administrativo e saiu da lista de papeis aceitos (migration 093).
  const effectiveRole: UserProfileRole = role === 'operator' ? 'documentacao' : role

  switch (effectiveRole) {
    case 'administrativo': return permission === 'admin_panel' || permission === 'manage_users' || permission === 'portal_provisioning' || permission === 'settle_financial_adjustments' || permission === 'customer_communications'
    case 'documentacao': return permission === 'portal_provisioning' || permission === 'customer_communications'
    case 'financeiro': return permission === 'settle_financial_adjustments'
    case 'operacoes': return false
    case 'equipamentos': return permission === 'customer_communications'
    default:
      return false
  }
}

type AuthContextValue = {
  user: User | null
  session: Session | null
  profile: UserProfile | null
  loading: boolean
  /** Hidratação do perfil: `loading` inicial, `ready`, erro transitório (sessão válida, retry permitido) ou `unauthorized` (acesso eliminado). */
  profileStatus: ProfileHydrationStatus
  profileError: string | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  isAdmin: boolean
  can: (permission: Permission) => boolean
  effectiveRole: UserProfileRole | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

function isUserProfileRole(role: string): role is UserProfileRole {
  return ['operator', 'administrativo', 'financeiro', 'operacoes', 'documentacao', 'equipamentos'].includes(role)
}

async function loadProfile(userId: string): Promise<UserProfile> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .eq('active', true)
    .single()

  if (error) {
    throw error
  }

  if (!data || !isUserProfileRole(data.role)) throw new Error('Perfil de usuário inválido.')
  return { ...data, role: data.role }
}

const IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000 // 8 horas

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileStatus, setProfileStatus] = useState<ProfileHydrationStatus>('loading')
  const [profileError, setProfileError] = useState<string | null>(null)

  useEffect(() => {
    let lastActivity = Date.now()

    function onActivity() {
      lastActivity = Date.now()
    }

    const activityEvents = ['mousemove', 'keydown', 'click', 'touchstart'] as const
    for (const event of activityEvents) {
      window.addEventListener(event, onActivity, { passive: true })
    }

    const idleInterval = window.setInterval(() => {
      if (Date.now() - lastActivity >= IDLE_TIMEOUT_MS) {
        void signOutSupabaseClient(supabase)
      }
    }, 60_000)

    return () => {
      for (const event of activityEvents) {
        window.removeEventListener(event, onActivity)
      }
      window.clearInterval(idleInterval)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    let hydratedUserId: string | null = null
    const fallbackTimer = window.setTimeout(() => {
      if (mounted) {
        setLoading(false)
      }
    }, 8000)

    async function hydrateSession(nextSession: Session | null) {
      if (!mounted) return

      // Não reativar o estado de carregamento aqui. `loading` só deve cobrir a
      // resolução inicial da sessão (já inicia como `true`). Eventos posteriores
      // de `onAuthStateChange` — disparados pelo Supabase ao reganhar foco da
      // janela ou ao renovar o token — devem atualizar sessão/perfil de forma
      // silenciosa. Reativar `loading` faz o ProtectedRoute desmontar a árvore
      // de páginas, perdendo aba ativa, modais abertos e formulários em edição.
      setSession(nextSession)

      try {
        const nextUserId = nextSession?.user?.id ?? null
        if (shouldHydrateProfile(nextUserId, hydratedUserId)) {
          hydratedUserId = nextUserId
          // Troca de usuário: descartar o perfil antigo antes de carregar o
          // novo — nunca autorizar com credencial de outra sessão.
          if (mounted) {
            setProfile(null)
            setProfileError(null)
            setProfileStatus('loading')
          }
          const nextProfile = await loadProfile(nextSession!.user.id)
          if (!mounted) return
          markStartupStage('profile')
          setProfile(nextProfile)
          setProfileError(null)
          setProfileStatus('ready')
          setTelemetryUser({ id: nextSession!.user.id, role: nextProfile.role })
        } else if (!nextUserId) {
          hydratedUserId = null
          setProfile(null)
          setProfileError(null)
          setProfileStatus('signed-out')
          setTelemetryUser(null)
        }
      } catch (error) {
        if (!mounted) return
        // Erro transitório mantém a sessão Auth válida (sem logout) e expõe
        // retry; perfil confirmado inativo/removido elimina o acesso.
        const kind = classifyProfileHydrationError(error)
        setProfile(null)
        setProfileError(extractErrorText(error) || 'Falha ao carregar o perfil.')
        if (kind === 'unauthorized') {
          setProfileStatus('unauthorized')
          void signOutSupabaseClient(supabase)
        } else {
          setProfileStatus('transient-error')
        }
      } finally {
        if (mounted) {
          window.clearTimeout(fallbackTimer)
          setLoading(false)
        }
      }
    }

    void (async () => {
      try {
        const { data } = await supabase.auth.getSession()
        markStartupStage('session')
        await hydrateSession(data.session)
      } catch (error) {
        if (mounted) {
          setProfile(null)
          setProfileError(extractErrorText(error) || 'Falha ao carregar a sessão.')
          setProfileStatus('transient-error')
          setLoading(false)
        }
      }
    })()

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void hydrateSession(nextSession)
    })

    return () => {
      mounted = false
      window.clearTimeout(fallbackTimer)
      subscription.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => {
    const role = profile?.role
    const effectiveRole: UserProfileRole | null = !role ? null :
      role === 'operator' ? 'documentacao' :
      role
    return {
      user: session?.user ?? null,
      session,
      profile,
      loading,
      profileStatus,
      profileError,
      isAdmin: role === 'administrativo',
      effectiveRole,
      can: (permission: Permission) => roleHasPermission(role, permission),
      async signIn(email, password) {
        setLoading(true)
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) {
          setLoading(false)
          throw error
        }
      },
      async signOut() {
        setTelemetryUser(null)
        await signOutSupabaseClient(supabase)
      },
      async refreshProfile() {
        if (!session?.user.id) return
        setProfileStatus('loading')
        try {
          setProfile(await loadProfile(session.user.id))
          setProfileError(null)
          setProfileStatus('ready')
        } catch (error) {
          const kind = classifyProfileHydrationError(error)
          setProfile(null)
          setProfileError(extractErrorText(error) || 'Falha ao carregar o perfil.')
          if (kind === 'unauthorized') {
            setProfileStatus('unauthorized')
            await signOutSupabaseClient(supabase)
          } else {
            setProfileStatus('transient-error')
          }
        }
      },
    }
  }, [loading, profile, profileError, profileStatus, session])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)

  if (!value) {
    throw new Error('useAuth deve ser usado dentro de AuthProvider')
  }

  return value
}
