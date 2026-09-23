// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { type ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession, signInWithPassword, signOut, onAuthStateChange, rpc, portalResolveLogin, invoke, setSession } = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
  rpc: vi.fn(),
  portalResolveLogin: vi.fn(),
  invoke: vi.fn(),
  setSession: vi.fn(),
}))

const sentry = vi.hoisted(() => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
}))

vi.mock('../../services/supabase', () => ({
  supabasePortal: {
    auth: {
      getSession,
      signInWithPassword,
      signOut,
      onAuthStateChange,
      setSession,
    },
    functions: { invoke },
    rpc,
  },
}))

vi.mock('../../services/portalBilling', () => ({
  portalResolveLogin,
}))

vi.mock('@sentry/react', () => sentry)

import { PortalAuthProvider, usePortalAuth } from '../usePortalAuth'
import { PortalProtectedRoute } from '../../components/layout/PortalProtectedRoute'

let queryClient: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <PortalAuthProvider>{children}</PortalAuthProvider>
    </QueryClientProvider>
  )
}

describe('usePortalAuth', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    getSession.mockResolvedValue({ data: { session: null } })
    signInWithPassword.mockReset()
    signOut.mockReset()
    signOut.mockResolvedValue({ error: null })
    onAuthStateChange.mockReset()
    onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
    rpc.mockReset()
    rpc.mockResolvedValue({
      data: {
        customer_id: 123,
        customer_name: 'Cliente Teste',
        customer_cnpj_cpf: '123',
        pending_balance: 0,
        contact_email: 'cliente@example.com',
        login_cnpj: '123',
      },
      error: null,
    })
    portalResolveLogin.mockReset()
    invoke.mockReset()
    setSession.mockReset()
    sentry.setUser.mockReset()
    sentry.setTag.mockReset()
  })

  it('normaliza falha de login por CNPJ sem expor a causa', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('invalid credentials') })

    const { result } = renderHook(() => usePortalAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(result.current.signIn('12.345.678/0001-95', 'senha-secreta')).rejects.toThrow(
      'CNPJ ou senha inválidos.',
    )
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('mantém a mensagem genérica quando o rate limit bloqueia', async () => {
    invoke.mockResolvedValue({ data: null, error: Object.assign(new Error('blocked'), { code: 'P0429' }) })

    const { result } = renderHook(() => usePortalAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(result.current.signIn('12.345.678/0001-95', 'senha-secreta')).rejects.toThrow('CNPJ ou senha inválidos.')
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('limpa sessao e cache do portal quando o Supabase emite SIGNED_OUT', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } })
    let authCallback: ((event: string, session: unknown) => void) | undefined
    onAuthStateChange.mockImplementation((callback) => {
      authCallback = callback
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })
    queryClient.setQueryData(['portal-invoices'], [{ id: 1 }])

    const { result } = renderHook(() => usePortalAuth(), { wrapper })
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true))
    expect(sentry.setUser).toHaveBeenCalledWith({ id: '123' })
    expect(sentry.setTag).toHaveBeenCalledWith('area', 'portal')

    act(() => authCallback?.('SIGNED_OUT', null))

    await waitFor(() => expect(result.current.isAuthenticated).toBe(false))
    expect(sentry.setUser).toHaveBeenCalledWith(null)
    expect(queryClient.getQueryData(['portal-invoices'])).toBeUndefined()
  })

  it('remove queries do portal ao sair pela UI', async () => {
    queryClient.setQueryData(['portal-invoices'], [{ id: 1 }])

    const { result } = renderHook(() => usePortalAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.signOut()
    })

    expect(signOut).toHaveBeenCalled()
    expect(queryClient.getQueryData(['portal-invoices'])).toBeUndefined()
  })

  it('mantém saída local fail-closed quando a revogação no servidor falha', async () => {
    signOut.mockRejectedValueOnce(new Error('Network offline'))
    queryClient.setQueryData(['portal-invoices'], [{ id: 1 }])

    const { result } = renderHook(() => usePortalAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.signOut()
    })

    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.signOutError).toBe('Network offline')
    expect(queryClient.getQueryData(['portal-invoices'])).toBeUndefined()
  })

  it('limpa o aviso de revogação pendente ao iniciar novo login', async () => {
    signOut.mockRejectedValueOnce(new Error('Network offline'))

    const { result } = renderHook(() => usePortalAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.signOut()
    })
    expect(result.current.signOutError).toBe('Network offline')

    await act(async () => {
      await result.current.signIn('123', 'senha').catch(() => undefined)
    })
    expect(result.current.signOutError).toBeNull()
  })

  it('redireciona rota protegida quando logout acontece em outra aba', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } })
    let authCallback: ((event: string, session: unknown) => void) | undefined
    onAuthStateChange.mockImplementation((callback) => {
      authCallback = callback
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })

    render(
      <QueryClientProvider client={queryClient}>
        <PortalAuthProvider>
          <MemoryRouter initialEntries={['/portal']}>
            <Routes>
              <Route element={<PortalProtectedRoute />}>
                <Route path="/portal" element={<div>PORTAL HOME</div>} />
              </Route>
              <Route path="/portal/login" element={<div>PORTAL LOGIN</div>} />
            </Routes>
          </MemoryRouter>
        </PortalAuthProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('PORTAL HOME')).toBeTruthy())

    act(() => authCallback?.('SIGNED_OUT', null))

    await waitFor(() => expect(screen.getByText('PORTAL LOGIN')).toBeTruthy())
  })
})
