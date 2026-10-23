// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  showToast: vi.fn(),
  recordAuditEntries: vi.fn(),
}))

vi.mock('../../../services/supabase', () => ({
  supabase: { auth: { signInWithPassword: mocks.signInWithPassword, updateUser: mocks.updateUser } },
}))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../../services/auditEntries', () => ({ recordAuditEntries: mocks.recordAuditEntries }))
vi.mock('../../security/TurnstileChallenge', () => ({
  TurnstileChallenge: ({ action, onToken }: { action: string; onToken: (token: string) => void }) => (
    <button type="button" onClick={() => onToken(`token-${action}`)}>Resolver desafio</button>
  ),
}))

import { AlterarMinhaSenhaModal } from '../AlterarMinhaSenhaModal'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.signInWithPassword.mockResolvedValue({ error: null })
  mocks.updateUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  mocks.recordAuditEntries.mockResolvedValue(undefined)
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

it('registra a troca no Histórico, sem a senha', async () => {
  render(<AlterarMinhaSenhaModal open email="ana@fwlog.com.br" onClose={vi.fn()} />)
  preencher('Antiga123', 'Nova12345', 'Nova12345')
  await waitFor(() => expect(mocks.recordAuditEntries).toHaveBeenCalledWith([
    { entity_type: 'user_profile', entity_id: 'user-1', field_name: 'password', old_value: null, new_value: 'alterada pelo próprio usuário' },
  ]))
  expect(JSON.stringify(mocks.recordAuditEntries.mock.calls)).not.toContain('Nova12345')
})

it('falha no Histórico não desfaz nem esconde a troca', async () => {
  mocks.recordAuditEntries.mockRejectedValue(new Error('rede'))
  const onClose = vi.fn()
  render(<AlterarMinhaSenhaModal open email="ana@fwlog.com.br" onClose={onClose} />)
  preencher('Antiga123', 'Nova12345', 'Nova12345')
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(mocks.showToast).toHaveBeenCalledWith('Senha alterada.', 'success')
})

it('com o captcha do Auth, a conferência da senha atual leva o token do Turnstile (auditoria run-3)', async () => {
  render(<AlterarMinhaSenhaModal open email="ana@fwlog.com.br" onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Resolver desafio' }))
  preencher('Antiga123', 'Nova12345', 'Nova12345')
  await waitFor(() => expect(mocks.signInWithPassword).toHaveBeenCalledWith({
    email: 'ana@fwlog.com.br', password: 'Antiga123', options: { captchaToken: 'token-vela_senha_atual' },
  }))
})

it('recusa do captcha pelo Auth não vira senha atual incorreta', async () => {
  mocks.signInWithPassword.mockResolvedValue({ error: { code: 'captcha_failed', message: 'captcha protection' } })
  render(<AlterarMinhaSenhaModal open email="ana@fwlog.com.br" onClose={vi.fn()} />)
  preencher('Antiga123', 'Nova12345', 'Nova12345')
  await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/validar a segurança/))
  expect(mocks.updateUser).not.toHaveBeenCalled()
})
