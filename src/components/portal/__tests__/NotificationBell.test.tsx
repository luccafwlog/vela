// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn((options: { title?: string; message: string }) => {
    void options
    return Promise.resolve(true)
  }),
  markRead: vi.fn(() => Promise.resolve()),
  markAllRead: vi.fn(() => Promise.resolve()),
}))

// `usePortalScope` le `PortalAuthContext` direto (sem Provider, o default do
// contexto e o valor entregue), entao o mock parcial precisa exportar os dois.
const portalAuth = vi.hoisted(() => ({ overview: { customer_name: 'Cliente' } }))
vi.mock('../../../hooks/usePortalAuth', async () => ({
  usePortalAuth: () => portalAuth,
  PortalAuthContext: (await vi.importActual<typeof import('react')>('react')).createContext(portalAuth),
}))
vi.mock('../../../hooks/usePortalNotifications', () => ({
  usePortalNotifications: () => ({
    data: [{
      id: 1,
      type: 'invoice_issued',
      title: 'Nova fatura',
      message: 'Abra a fatura.',
      link: '/portal/billing?invoice=10',
      read: false,
    }],
    isLoading: false,
  }),
  usePortalUnreadCount: () => ({ data: 1 }),
  usePortalMarkRead: () => ({ mutateAsync: mocks.markRead }),
  usePortalMarkAllRead: () => ({ mutateAsync: mocks.markAllRead }),
}))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import { NotificationBell } from '../NotificationBell'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.confirm.mockResolvedValue(true)
})

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}{useLocation().search}</div>
}

it('navigates to a notification link after selection', async () => {
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/portal']}>
      <NotificationBell />
      <LocationProbe />
    </MemoryRouter>,
  )

  await user.click(screen.getByRole('button', { name: 'Notificações (1 não lidas)' }))
  await user.click(screen.getByRole('button', { name: /Nova fatura/ }))

  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
  expect(mocks.confirm.mock.calls[0]?.[0]).toMatchObject({
    affected: { summary: '1 notificação: Nova fatura', items: ['Abra a fatura.'] },
  })
  // O handler aguarda markRead antes de navegar, entao a navegacao ocorre num
  // microtask posterior ao clique — espere por ela em vez de assumir sincronia.
  await waitFor(() => {
    expect(screen.getByTestId('location').textContent).toBe('/portal/billing?invoice=10')
  })
})

it('voltar cancela a baixa e a navegação', async () => {
  mocks.confirm.mockResolvedValue(false)
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/portal']}>
      <NotificationBell />
      <LocationProbe />
    </MemoryRouter>,
  )

  await user.click(screen.getByRole('button', { name: 'Notificações (1 não lidas)' }))
  await user.click(screen.getByRole('button', { name: /Nova fatura/ }))

  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
  expect(mocks.markRead).not.toHaveBeenCalled()
  expect(screen.getByTestId('location').textContent).toBe('/portal')
})
