// @vitest-environment jsdom
import { Component, type PropsWithChildren, type ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialogProvider } from '../../components/ui/ConfirmDialog'
import { ToastProvider } from '../../components/ui/Toast'

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
      <ToastProvider>
        <ConfirmDialogProvider>
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
          </MemoryRouter>
        </ConfirmDialogProvider>
      </ToastProvider>,
    )

    await waitFor(() => expect(screen.getByText('Modo Inspeção')).toBeTruthy())
    expect(screen.getAllByText('Cliente Inspecionado').length).toBeGreaterThan(0)
    // Sem origem no endereço, a saída volta ao Provisionamento (A5).
    expect(screen.getByRole('button', { name: 'Voltar ao Provisionamento' })).toBeTruthy()
    expect(screen.queryByTestId('render-error')).toBeNull()
    expect(screen.getByRole('link', { name: 'Faturas' }).getAttribute('href')).toBe('/clientes/portal/inspecao/42/billing')
  })
})

describe('saída do Modo Inspeção (lote 5a, achado A5)', () => {
  it('volta para onde a inspeção foi aberta, e fecha a aba quando ela abriu em outra', async () => {
    const { inspectionExit } = await import('../../lib/portalInspectionExit')
    expect(inspectionExit('ficha', false, 42, '12345678000195')).toEqual({ label: 'Voltar à ficha do Cliente', to: '/clientes/12345678000195', closeTab: false })
    expect(inspectionExit('provisionamento', false, 42, '12345678000195')).toEqual({ label: 'Voltar ao Provisionamento', to: '/clientes/portal?cliente=42', closeTab: false })
    expect(inspectionExit(null, false, 42, null).label).toBe('Voltar ao Provisionamento')
    // A sessão da inspeção traz o CNPJ com máscara; a ficha usa o canônico.
    expect(inspectionExit('ficha', false, 42, '12.345.678/0001-95').to).toBe('/clientes/12345678000195')
    expect(inspectionExit('provisionamento', true, 42, '12345678000195')).toMatchObject({ label: 'Fechar inspeção', closeTab: true })
  })
})
