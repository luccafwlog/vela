// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('../../../services/supabase', () => ({
  supabase: { auth: { signInWithPassword: mocks.signInWithPassword, updateUser: mocks.updateUser } },
}))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))

import { AlterarMinhaSenhaModal } from '../AlterarMinhaSenhaModal'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.signInWithPassword.mockResolvedValue({ error: null })
  mocks.updateUser.mockResolvedValue({ error: null })
})
afterEach(cleanup)

function preencher(atual: string, nova: string, confirmacao: string) {
  fireEvent.change(screen.getByLabelText(/Senha atual/), { target: { value: atual } })
  fireEvent.change(screen.getByLabelText(/Nova senha/), { target: { value: nova } })
  fireEvent.change(screen.getByLabelText(/Confirmar nova senha/), { target: { value: confirmacao } })
  fireEvent.click(screen.getByRole('button', { name: 'Alterar senha' }))
}

it('revalida a senha atual antes de trocar', async () => {
  render(<AlterarMinhaSenhaModal open email="ana@fwlog.com.br" onClose={vi.fn()} />)
  preencher('Antiga123', 'Nova12345', 'Nova12345')
  await waitFor(() => expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: 'ana@fwlog.com.br', password: 'Antiga123' }))
  expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'Nova12345', current_password: 'Antiga123' })
})

it('nao troca a senha quando a senha atual esta errada', async () => {
  mocks.signInWithPassword.mockResolvedValue({ error: new Error('invalid') })
  render(<AlterarMinhaSenhaModal open email="ana@fwlog.com.br" onClose={vi.fn()} />)
  preencher('Errada123', 'Nova12345', 'Nova12345')
  await waitFor(() => expect(screen.getByText('Senha atual incorreta.')).toBeTruthy())
  expect(mocks.updateUser).not.toHaveBeenCalled()
})

it('recusa nova senha fora da regra', async () => {
  render(<AlterarMinhaSenhaModal open email="ana@fwlog.com.br" onClose={vi.fn()} />)
  preencher('Antiga123', 'fraca', 'fraca')
  await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/no mínimo 8 caracteres/))
  expect(mocks.updateUser).not.toHaveBeenCalled()
})

it('quando o Auth recusa a senha atual na troca, mostra senha atual incorreta', async () => {
  mocks.updateUser.mockResolvedValue({ error: { code: 'current_password_mismatch', message: 'mismatch' } })
  const onClose = vi.fn()
  render(<AlterarMinhaSenhaModal open email="ana@fwlog.com.br" onClose={onClose} />)
  preencher('Antiga123', 'Nova12345', 'Nova12345')
  await waitFor(() => expect(screen.getByText('Senha atual incorreta.')).toBeTruthy())
  expect(onClose).not.toHaveBeenCalled()
})
