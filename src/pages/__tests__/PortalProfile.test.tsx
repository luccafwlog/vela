// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

const getProfile = vi.hoisted(() => vi.fn())
const updateProfile = vi.hoisted(() => vi.fn())
// Stable identities: PortalProfile's load effect depends on `overview`, so a fresh
// object per render would re-trigger the effect in a loop past test teardown.
const auth = vi.hoisted(() => ({ overview: { contact_email: 'fallback@example.com' }, refreshOverview: vi.fn() }))

// `usePortalScope` le `PortalAuthContext` direto (sem Provider, o default do
// contexto e o valor entregue), entao o mock parcial precisa exportar os dois.
vi.mock('../../hooks/usePortalAuth', async () => ({
  usePortalAuth: () => auth,
  PortalAuthContext: (await vi.importActual<typeof import('react')>('react')).createContext(auth),
}))
vi.mock('../../services/portalBilling', () => ({
  portalGetProfile: getProfile,
  portalUpdateProfile: updateProfile,
}))
vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

import { PortalProfile } from '../PortalProfile'
import { ConfirmDialogProvider } from '../../components/ui/ConfirmDialog'

function renderProfile() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ConfirmDialogProvider><MemoryRouter><PortalProfile /></MemoryRouter></ConfirmDialogProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  getProfile.mockReset()
  updateProfile.mockReset()
  auth.refreshOverview.mockReset()
  auth.overview = { contact_email: 'fallback@example.com' }
})

it('shows a load error and disables editing when the profile cannot be loaded', async () => {
  getProfile.mockRejectedValueOnce(new Error('Perfil indisponivel'))
  renderProfile()

  await waitFor(() => expect(screen.getByText('Falha ao carregar perfil. Tente novamente em instantes.')).toBeTruthy())
  expect(screen.queryByText('Perfil indisponivel')).toBeNull()
  expect((screen.getByRole('button', { name: /Salvar altera/i }) as HTMLButtonElement).disabled).toBe(true)
})

it('preserva edicao local quando o overview muda depois da hidratacao', async () => {
  const user = userEvent.setup()
  getProfile.mockResolvedValue({ contact_email: 'perfil@example.com', phone: '', address: 'Rua Antiga', city: '', state: '', zip: '' })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { rerender } = render(
    <QueryClientProvider client={queryClient}>
      <ConfirmDialogProvider><MemoryRouter><PortalProfile /></MemoryRouter></ConfirmDialogProvider>
    </QueryClientProvider>,
  )

  const address = await screen.findByDisplayValue('Rua Antiga')
  await user.clear(address)
  await user.type(address, 'Rua Nova')

  auth.overview = { contact_email: 'novo-overview@example.com' }
  rerender(
    <QueryClientProvider client={queryClient}>
      <ConfirmDialogProvider><MemoryRouter><PortalProfile /></MemoryRouter></ConfirmDialogProvider>
    </QueryClientProvider>,
  )

  expect(screen.getByDisplayValue('Rua Nova')).toBeTruthy()
})

it('confirma a diferenca do perfil antes de salvar os dados cadastrais', async () => {
  const user = userEvent.setup()
  getProfile.mockResolvedValue({ contact_email: 'perfil@example.com', phone: '', address: 'Rua Antiga', city: '', state: '', zip: '' })
  renderProfile()

  const address = await screen.findByDisplayValue('Rua Antiga')
  await user.clear(address)
  await user.type(address, 'Rua Nova')
  await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

  const dialog = await screen.findByRole('dialog', { name: 'Confirmar alterações do perfil' })
  const table = within(dialog).getByRole('table', { name: 'Campos alterados' })
  expect(within(table).getByText('Rua Antiga')).toBeTruthy()
  expect(within(table).getByText('Rua Nova')).toBeTruthy()
  expect(updateProfile).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: 'Voltar' }))
  expect(updateProfile).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))
  const repeatedDialog = await screen.findByRole('dialog', { name: 'Confirmar alterações do perfil' })
  await user.click(within(repeatedDialog).getByRole('button', { name: 'Salvar alterações' }))
  await waitFor(() => expect(updateProfile).toHaveBeenCalledWith(expect.objectContaining({ address: 'Rua Nova' }), expect.anything()))
})
