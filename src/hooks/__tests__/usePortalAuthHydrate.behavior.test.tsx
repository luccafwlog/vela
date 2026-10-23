// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const supa = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn(), rpc: vi.fn() }))

vi.mock('../../services/supabase', () => ({
  supabasePortal: {
    auth: { getSession: supa.getSession, onAuthStateChange: supa.onAuthStateChange, signInWithPassword: vi.fn() },
    rpc: supa.rpc,
  },
}))
vi.mock('../../services/supabaseAuth', () => ({ signOutSupabaseClient: vi.fn() }))
vi.mock('../../services/portalBilling', () => ({ portalResolveLogin: vi.fn() }))

import { PortalAuthProvider, usePortalAuth } from '../usePortalAuth'

function Probe() {
  const { overview, loading, isAuthenticated } = usePortalAuth()
  return <div data-testid="state">{loading ? 'loading' : isAuthenticated ? `auth:${overview?.customer_name}` : 'anon'}</div>
}

function renderProvider(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={queryClient}>
      <PortalAuthProvider>
        <Probe />
      </PortalAuthProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  supa.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
})
afterEach(cleanup)

it('US-153: hidrata a sessao e carrega o overview do cliente', async () => {
  supa.getSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } } })
  supa.rpc.mockResolvedValue({ data: { customer_id: 5, customer_name: 'ACME LTDA' }, error: null })

  renderProvider()

  await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('auth:ACME LTDA'))
  expect(supa.rpc).toHaveBeenCalledWith('portal_get_session_overview_v2')
})

it('US-153: sem sessao Supabase permanece nao autenticado', async () => {
  supa.getSession.mockResolvedValue({ data: { session: null } })

  renderProvider()

  await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('anon'))
  expect(supa.rpc).not.toHaveBeenCalled()
})

it('login de outro Cliente em outra aba troca o overview e limpa o cache do Portal', async () => {
  let authListener: ((event: string, session: unknown) => void) | undefined
  supa.onAuthStateChange.mockImplementation((listener) => {
    authListener = listener
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
  supa.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-a' } } } })
  supa.rpc.mockResolvedValueOnce({ data: { customer_id: 5, customer_name: 'ACME LTDA' }, error: null })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['portal-invoices', 5], ['fatura da ACME'])

  renderProvider(queryClient)
  await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('auth:ACME LTDA'))

  // Mesmo usuário: renovação do token não troca o overview nem o cache.
  supa.rpc.mockResolvedValueOnce({ data: { customer_id: 5, customer_name: 'ACME (renovado)' }, error: null })
  await act(async () => { authListener?.('TOKEN_REFRESHED', { user: { id: 'user-a' } }) })
  expect(screen.getByTestId('state').textContent).toBe('auth:ACME LTDA')
  expect(queryClient.getQueryData(['portal-invoices', 5])).toEqual(['fatura da ACME'])

  supa.rpc.mockResolvedValueOnce({ data: { customer_id: 9, customer_name: 'BETA SA' }, error: null })
  await act(async () => { authListener?.('SIGNED_IN', { user: { id: 'user-b' } }) })

  await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('auth:BETA SA'))
  expect(queryClient.getQueryData(['portal-invoices', 5])).toBeUndefined()
})
