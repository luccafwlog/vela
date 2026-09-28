// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  markRead: vi.fn(() => Promise.resolve()),
  markAllRead: vi.fn(() => Promise.resolve()),
  confirm: vi.fn((options: { title?: string; message: string }) => {
    void options
    return Promise.resolve(true)
  }),
  listNotifications: vi.fn(),
  unreadCount: vi.fn(),
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
    data: [
      { id: 1, type: 'invoice_issued', title: 'Nova fatura', message: 'Abra a fatura.', link: '/portal/billing?invoice=10', read: false, created_at: '2026-08-19T15:30:00Z' },
      { id: 2, type: 'dispute_responded', title: 'Disputa respondida', message: 'Veja a resposta.', link: null, read: true, created_at: '2026-08-18T12:00:00Z' },
    ],
    isLoading: false,
  }),
  usePortalUnreadCount: () => ({ data: 3 }),
  usePortalMarkRead: () => ({ mutateAsync: mocks.markRead }),
  usePortalMarkAllRead: () => ({ mutateAsync: mocks.markAllRead }),
}))
vi.mock('../../../services/portalBilling', async () => ({
  ...(await vi.importActual<typeof import('../../../services/portalBilling')>('../../../services/portalBilling')),
  portalListNotifications: mocks.listNotifications,
  portalNotificationUnreadCount: mocks.unreadCount,
}))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import { NotificationBell } from '../NotificationBell'

function renderBell() {
  render(
    <MemoryRouter initialEntries={['/portal']}>
      <NotificationBell />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  mocks.confirm.mockResolvedValue(true)
  mocks.listNotifications.mockResolvedValue([
    { id: 1, title: 'Nova fatura', message: 'Abra a fatura.', read: false },
    { id: 3, title: 'Novo documento', message: 'Confira o documento.', read: false },
    { id: 4, title: 'Nova disputa', message: 'Confira a disputa.', read: false },
  ])
  mocks.unreadCount.mockResolvedValue(3)
})

it('US-173: mostra o contador de nao lidas e lista as notificacoes', async () => {
  const user = userEvent.setup()
  renderBell()

  // badge com a contagem
  expect(screen.getByRole('button', { name: 'Notificações (3 não lidas)' })).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Notificações (3 não lidas)' }))
  expect(screen.getByText('Nova fatura')).toBeTruthy()
  expect(screen.getByText('Disputa respondida')).toBeTruthy()
  expect(screen.getByRole('menu', { name: 'Notificações' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: /Nova fatura/ }).getAttribute('data-read')).toBe('false')
  expect(screen.getByText('19/08/2026, 12:30')).toBeTruthy()
})

it('US-174: marca uma notificacao como lida ao seleciona-la', async () => {
  const user = userEvent.setup()
  renderBell()

  await user.click(screen.getByRole('button', { name: 'Notificações (3 não lidas)' }))
  await user.click(screen.getByRole('menuitem', { name: /Nova fatura/ }))

  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
  expect(mocks.confirm.mock.calls[0]?.[0]).toMatchObject({
    affected: { summary: '1 notificação: Nova fatura', items: ['Abra a fatura.'] },
  })
  await waitFor(() => expect(mocks.markRead).toHaveBeenCalledWith(1))
})

it('US-174: marca todas como lidas pelo cabecalho', async () => {
  const user = userEvent.setup()
  renderBell()

  await user.click(screen.getByRole('button', { name: 'Notificações (3 não lidas)' }))
  await user.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }))

  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
  expect(mocks.listNotifications).toHaveBeenCalledWith(expect.anything(), 10_000)
  expect(mocks.confirm.mock.calls[0]?.[0]).toMatchObject({
    affected: {
      summary: '3 notificações não lidas da conta atual',
      items: expect.arrayContaining([expect.stringContaining('Nova fatura'), expect.stringContaining('Novo documento')]),
    },
  })
  await waitFor(() => expect(mocks.markAllRead).toHaveBeenCalledTimes(1))
})

it('não marca nem abre a notificação quando a pessoa volta da confirmação', async () => {
  mocks.confirm.mockResolvedValue(false)
  const user = userEvent.setup()
  renderBell()

  await user.click(screen.getByRole('button', { name: 'Notificações (3 não lidas)' }))
  await user.click(screen.getByRole('menuitem', { name: /Nova fatura/ }))

  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
  expect(mocks.markRead).not.toHaveBeenCalled()
})

it('fecha o dropdown com Escape e expõe estado expandido', async () => {
  const user = userEvent.setup()
  renderBell()

  const button = screen.getByRole('button', { name: 'Notificações (3 não lidas)' })
  expect(button.getAttribute('aria-haspopup')).toBe('menu')
  expect(button.getAttribute('aria-expanded')).toBe('false')

  await user.click(button)
  expect(button.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText('Nova fatura')).toBeTruthy()

  await user.keyboard('{Escape}')
  expect(button.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByText('Nova fatura')).toBeNull()
})
