// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  update: vi.fn(),
  updateUser: vi.fn(),
  refreshProfile: vi.fn(),
  showToast: vi.fn(),
  auth: {
    profile: { id: 'user-1', full_name: 'Nome antigo', role: 'operacoes' },
    session: { user: { email: 'antigo@example.com' } },
    refreshProfile: vi.fn(),
  },
}))

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => mocks.auth }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../services/supabase', () => ({
  supabase: { from: mocks.from, auth: { updateUser: mocks.updateUser } },
}))

import { ConfirmDialogProvider } from '../../components/ui/ConfirmDialog'
import { Profile } from '../Profile'

function renderProfile() {
  render(<ConfirmDialogProvider><Profile /></ConfirmDialogProvider>)
}

beforeEach(() => {
  mocks.from.mockReset()
  mocks.update.mockReset()
  mocks.updateUser.mockReset().mockResolvedValue({ error: null })
  mocks.refreshProfile.mockReset()
  mocks.showToast.mockReset()
  mocks.update.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
  mocks.from.mockReturnValue({ update: mocks.update })
  mocks.auth = {
    profile: { id: 'user-1', full_name: 'Nome antigo', role: 'operacoes' },
    session: { user: { email: 'antigo@example.com' } },
    refreshProfile: mocks.refreshProfile,
  }
})

it('confirms the profile diff before updating the name or sending an email change', async () => {
  const user = userEvent.setup()
  renderProfile()

  await user.clear(screen.getByRole('textbox', { name: 'Nome' }))
  await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'Nome novo')
  await user.clear(screen.getByRole('textbox', { name: 'E-mail' }))
  await user.type(screen.getByRole('textbox', { name: 'E-mail' }), 'novo@example.com')
  await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

  const dialog = await screen.findByRole('dialog')
  const table = within(dialog).getByRole('table', { name: 'Campos alterados' })
  expect(within(table).getByText('Nome antigo')).toBeTruthy()
  expect(within(table).getByText('Nome novo')).toBeTruthy()
  expect(within(table).getByText('antigo@example.com')).toBeTruthy()
  expect(within(table).getByText('novo@example.com')).toBeTruthy()
  expect(within(dialog).getByText(/e-mail novo ficará pendente/i)).toBeTruthy()
  expect(mocks.from).not.toHaveBeenCalled()
  expect(mocks.updateUser).not.toHaveBeenCalled()

  fireEvent.click(within(dialog).getByRole('button', { name: 'Voltar' }))
  expect(mocks.from).not.toHaveBeenCalled()
  expect(mocks.updateUser).not.toHaveBeenCalled()
})

it('persists the profile only after the diff is confirmed', async () => {
  const user = userEvent.setup()
  renderProfile()

  await user.clear(screen.getByRole('textbox', { name: 'Nome' }))
  await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'Nome novo')
  await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))

  const dialog = await screen.findByRole('dialog')
  expect(mocks.from).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar alterações' }))

  await waitFor(() => expect(mocks.from).toHaveBeenCalledWith('user_profiles'))
  expect(mocks.update).toHaveBeenCalledWith({ full_name: 'Nome novo' })
  expect(mocks.updateUser).not.toHaveBeenCalled()
})
