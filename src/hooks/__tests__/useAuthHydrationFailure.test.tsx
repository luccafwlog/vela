// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'

const signOutMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../../services/supabaseAuth', () => ({
  signOutSupabaseClient: (...args: unknown[]) => signOutMock(...args),
}))

type ProfileResult = { data: unknown; error: unknown }
let profileResult: ProfileResult = { data: null, error: null }
let currentSession: Session | null = null
let authListener: ((event: string, session: Session | null) => void) | null = null

function sessionFor(userId: string): Session {
  return { user: { id: userId, email: `${userId}@exemplo.com` } } as Session
}

vi.mock('../../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: currentSession } }),
      onAuthStateChange: (listener: (event: string, session: Session | null) => void) => {
        authListener = listener
        return { data: { subscription: { unsubscribe: () => undefined } } }
      },
      signInWithPassword: () => Promise.resolve({ error: null }),
      signOut: () => Promise.resolve({ error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: () => Promise.resolve(profileResult),
          }),
        }),
      }),
    }),
  },
}))

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, classifyProfileHydrationError, useAuth } from '../useAuth'

function Probe() {
  const { user, profile, loading, profileStatus, profileError, refreshProfile } = useAuth()
  return (
    <div>
      <span data-testid="user">{user?.id ?? 'sem-usuario'}</span>
      <span data-testid="profile">{profile ? `${profile.id}:${profile.role}` : 'sem-perfil'}</span>
      <span data-testid="loading">{loading ? 'carregando' : 'pronto'}</span>
      <span data-testid="status">{profileStatus}</span>
      <span data-testid="error">{profileError ?? 'sem-erro'}</span>
      <button type="button" onClick={() => void refreshProfile()}>
        recarregar
      </button>
    </div>
  )
}

function profileRow(userId: string) {
  return { id: userId, role: 'operacoes', active: true }
}

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  authListener = null
  currentSession = null
  profileResult = { data: null, error: null }
})

describe('classifyProfileHydrationError', () => {
  it('perfil ausente/inativo (PGRST116) é unauthorized; falha de rede é transitória', () => {
    expect(classifyProfileHydrationError({ code: 'PGRST116', message: '0 rows' })).toBe('unauthorized')
    expect(classifyProfileHydrationError(new Error('Perfil de usuário inválido.'))).toBe('unauthorized')
    expect(classifyProfileHydrationError(new TypeError('Failed to fetch'))).toBe('transient-error')
    expect(classifyProfileHydrationError({ message: 'timeout' })).toBe('transient-error')
  })
})

describe('useAuth hidratação do perfil', () => {
  it('erro transitório mantém a sessão, distingue error de loading e permite retry', async () => {
    currentSession = sessionFor('user-1')
    profileResult = { data: null, error: new TypeError('Failed to fetch') }

    render(
      <QueryClientProvider client={new QueryClient()}><AuthProvider>
        <Probe />
      </AuthProvider></QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('pronto'))
    expect(screen.getByTestId('user').textContent).toBe('user-1')
    expect(screen.getByTestId('profile').textContent).toBe('sem-perfil')
    expect(screen.getByTestId('status').textContent).toBe('transient-error')
    expect(screen.getByTestId('error').textContent).not.toBe('sem-erro')
    // Sem logout desnecessário: sessão Auth continua válida.
    expect(signOutMock).not.toHaveBeenCalled()

    // Retry recupera sem remontar a sessão.
    profileResult = { data: profileRow('user-1'), error: null }
    screen.getByText('recarregar').click()
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
    expect(screen.getByTestId('profile').textContent).toBe('user-1:operacoes')
    expect(signOutMock).not.toHaveBeenCalled()
  })

  it('perfil inativo/removido elimina o acesso sem reutilizar autorização antiga', async () => {
    currentSession = sessionFor('user-1')
    profileResult = { data: profileRow('user-1'), error: null }

    render(
      <QueryClientProvider client={new QueryClient()}><AuthProvider>
        <Probe />
      </AuthProvider></QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
    expect(screen.getByTestId('profile').textContent).toBe('user-1:operacoes')

    // Troca de usuário com perfil revogado: perfil antigo sai de cena e a
    // sessão é encerrada — nunca opera com autorização de outro usuário.
    profileResult = { data: null, error: { code: 'PGRST116', message: '0 rows' } }
    authListener?.('SIGNED_IN', sessionFor('user-2'))

    await waitFor(() => expect(signOutMock).toHaveBeenCalled())
    expect(screen.getByTestId('profile').textContent).toBe('sem-perfil')
    expect(screen.queryByText('user-1:operacoes')).toBeNull()
  })

  it('saída da sessão limpa o cache do TanStack Query (auditoria run-2, reforço)', async () => {
    currentSession = sessionFor('user-1')
    profileResult = { data: profileRow('user-1'), error: null }
    const client = new QueryClient()
    client.setQueryData(['faturas', 'user-1'], [{ id: 1 }])

    render(
      <QueryClientProvider client={client}><AuthProvider>
        <Probe />
      </AuthProvider></QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
    expect(client.getQueryData(['faturas', 'user-1'])).toBeDefined()

    authListener?.('SIGNED_OUT', null)

    await waitFor(() => expect(client.getQueryData(['faturas', 'user-1'])).toBeUndefined())
  })
})
