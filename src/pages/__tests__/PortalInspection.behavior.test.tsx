// @vitest-environment jsdom
import { Component, type PropsWithChildren, type ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const openInspection = vi.hoisted(() => vi.fn())

vi.mock('../../services/portalScope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/portalScope')>()),
  openPortalInspection: openInspection,
}))

vi.mock('../../hooks/usePortalNotifications', () => ({
  usePortalUnreadCount: () => ({ data: 0 }),
  usePortalNotifications: () => ({ data: [], isLoading: false }),
  usePortalMarkRead: () => ({ mutateAsync: vi.fn() }),
  usePortalMarkAllRead: () => ({ mutateAsync: vi.fn() }),
}))

import { PortalInspection } from '../PortalInspection'

class RenderErrorBoundary extends Component<PropsWithChildren, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render(): ReactNode {
    return this.state.error ? <div data-testid="render-error">{this.state.error.message}</div> : this.props.children
  }
}

describe('PortalInspection', () => {
  // O menu móvel do PortalLayout acompanha a largura da tela; o jsdom não tem matchMedia.
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('renderiza o layout compartilhado sem exigir uma sessão de cliente', async () => {
    openInspection.mockResolvedValue({
      customer_id: 42,
      customer_name: 'Cliente Inspecionado',
      customer_cnpj_cpf: '12345678000195',
      pending_balance: null,
      contact_email: null,
      login_cnpj: null,
    })

    render(
      <MemoryRouter initialEntries={['/clientes/portal/inspecao/42']}>
        <Routes>
          <Route
            path="/clientes/portal/inspecao/:customerId"
            element={
              <RenderErrorBoundary>
                <PortalInspection />
              </RenderErrorBoundary>
            }
          />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Cliente Inspecionado')).toBeTruthy())
    expect(screen.queryByTestId('render-error')).toBeNull()
    expect(screen.getByRole('link', { name: 'Faturas' }).getAttribute('href')).toBe('/clientes/portal/inspecao/42/billing')
  })
})
