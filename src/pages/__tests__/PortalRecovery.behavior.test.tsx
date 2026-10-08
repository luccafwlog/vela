// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ConfirmDialogProvider } from '../../components/ui/ConfirmDialog'
import { PASSWORD_RULE_MESSAGE } from '../../lib/passwordPolicy'
import { INCOMPLETE_CNPJ_MESSAGE } from '../../lib/portalCnpjLogin'

type RecoveryResponse = { accepted: boolean; rate_limited?: boolean }
const auth = vi.hoisted(() => ({
  functions: { invoke: vi.fn(() => Promise.resolve<{ data: RecoveryResponse | null; error: unknown }>({ data: { accepted: true }, error: null })) },
}))

vi.mock('../../services/supabase', () => ({ supabasePortal: { auth, functions: auth.functions } }))

import { PortalForgotPassword } from '../PortalForgotPassword'
import { PortalResetPassword } from '../PortalResetPassword'

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(cleanup)

it('US-155: solicita recuperacao e confirma o recebimento da solicitacao', async () => {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <PortalForgotPassword />
    </MemoryRouter>,
  )

  await user.type(screen.getByPlaceholderText('00.000.000/0000-00'), '12.345.678/0001-95')
  await user.click(screen.getByRole('button', { name: 'Enviar link de recuperação' }))

  await waitFor(() => expect(screen.getByText('Solicitação recebida')).toBeTruthy())
  expect(auth.functions.invoke).toHaveBeenCalledWith('portal-password-recovery', { body: { cnpj: '12345678000195' } })
})

it('achado 3.2 (auditoria 2026-08-12): mostra a MESMA tela para conta existente e inexistente', async () => {
  const user = userEvent.setup()
  auth.functions.invoke.mockResolvedValueOnce({ data: { accepted: true }, error: null })
  const { unmount } = render(
    <MemoryRouter>
      <PortalForgotPassword />
    </MemoryRouter>,
  )
  await user.type(screen.getByPlaceholderText('00.000.000/0000-00'), '12.345.678/0001-95')
  await user.click(screen.getByRole('button', { name: 'Enviar link de recuperação' }))
  await waitFor(() => expect(screen.getByText('Solicitação recebida')).toBeTruthy())
  unmount()

  // Mesmo desfecho de resposta (accepted: true) para CNPJ sem conta -- o
  // backend nao distingue mais os dois casos, entao a tela e identica.
  auth.functions.invoke.mockResolvedValueOnce({ data: { accepted: true }, error: null })
  render(
    <MemoryRouter>
      <PortalForgotPassword />
    </MemoryRouter>,
  )
  await user.type(screen.getByPlaceholderText('00.000.000/0000-00'), '98.765.432/0001-10')
  await user.click(screen.getByRole('button', { name: 'Enviar link de recuperação' }))
  await waitFor(() => expect(screen.getByText('Solicitação recebida')).toBeTruthy())
})

it('achado 3.2: rate limit continua mostrando mensagem de "tente mais tarde"', async () => {
  const user = userEvent.setup()
  auth.functions.invoke.mockResolvedValueOnce({ data: { accepted: false, rate_limited: true }, error: null })
  render(
    <MemoryRouter>
      <PortalForgotPassword />
    </MemoryRouter>,
  )
  await user.type(screen.getByPlaceholderText('00.000.000/0000-00'), '12.345.678/0001-95')
  await user.click(screen.getByRole('button', { name: 'Enviar link de recuperação' }))
  await waitFor(() => expect(screen.getByText('Muitas solicitações em pouco tempo. Aguarde alguns minutos e tente novamente.')).toBeTruthy())
})

it('a tela de confirmacao afirma o envio sem condicionar a existencia da conta', async () => {
  const user = userEvent.setup()
  auth.functions.invoke.mockResolvedValueOnce({ data: { accepted: true }, error: null })
  render(
    <MemoryRouter>
      <PortalForgotPassword />
    </MemoryRouter>,
  )
  await user.type(screen.getByPlaceholderText('00.000.000/0000-00'), '98.765.432/0001-10')
  await user.click(screen.getByRole('button', { name: 'Enviar link de recuperação' }))

  await waitFor(() => expect(screen.getByText('Solicitação recebida')).toBeTruthy())
  expect(screen.queryByText(/Se houver uma conta/i)).toBeNull()
  expect(screen.queryByText(/cadastrad[oa]\b.*CNPJ|CNPJ.*n[ãa]o (est[áa]|se encontra)/i)).toBeNull()
  expect(screen.getByText(/Enviamos um link de redefinição para o email cadastrado na conta/)).toBeTruthy()
})

it('CNPJ incompleto nao chega a chamar a Edge Function e recebe mensagem propria', async () => {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <PortalForgotPassword />
    </MemoryRouter>,
  )
  await user.type(screen.getByPlaceholderText('00.000.000/0000-00'), '12.345.678')
  await user.click(screen.getByRole('button', { name: 'Enviar link de recuperação' }))

  expect(screen.getByText(INCOMPLETE_CNPJ_MESSAGE)).toBeTruthy()
  expect(auth.functions.invoke).not.toHaveBeenCalled()
})

it('falha de rede nao promete email que nunca sera enviado', async () => {
  const user = userEvent.setup()
  auth.functions.invoke.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  render(
    <MemoryRouter>
      <PortalForgotPassword />
    </MemoryRouter>,
  )
  await user.type(screen.getByPlaceholderText('00.000.000/0000-00'), '12.345.678/0001-95')
  await user.click(screen.getByRole('button', { name: 'Enviar link de recuperação' }))

  await waitFor(() => expect(screen.getByText('Não foi possível concluir a solicitação agora. Tente novamente em instantes.')).toBeTruthy())
  expect(screen.queryByText('Solicitação recebida')).toBeNull()
})

it('US-156: link invalido sem tokens mostra erro', () => {
  render(
    <ConfirmDialogProvider>
      <MemoryRouter>
        <PortalResetPassword />
      </MemoryRouter>
    </ConfirmDialogProvider>,
  )
  expect(screen.getByText('Link de recuperação inválido ou expirado.')).toBeTruthy()
})

it('US-156: aceita token de recovery na query string', async () => {
  render(
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={['/portal/recuperar-senha?token=TOKEN']}>
        <PortalResetPassword />
      </MemoryRouter>
    </ConfirmDialogProvider>,
  )

  await waitFor(() => expect(screen.getByRole('heading', { name: 'Redefinir senha' })).toBeTruthy())
})

it('US-157: atualiza a senha e volta para o login', async () => {
  const user = userEvent.setup()
  render(
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={['/portal/recuperar-senha?token=TOKEN']}>
        <Routes>
          <Route path="/portal/recuperar-senha" element={<PortalResetPassword />} />
          <Route path="/portal/login" element={<div>LOGIN PLACEHOLDER</div>} />
        </Routes>
      </MemoryRouter>
    </ConfirmDialogProvider>,
  )

  await waitFor(() => expect(screen.getByRole('heading', { name: 'Redefinir senha' })).toBeTruthy())
  await user.type(screen.getByLabelText('Nova senha'), 'senhaSegura1')
  await user.type(screen.getByLabelText('Confirmar senha'), 'senhaSegura1')
  await user.click(screen.getByRole('button', { name: 'Redefinir senha' }))
  const dialog = await screen.findByRole('dialog', { name: 'Redefinir senha do Portal' })
  await user.click(within(dialog).getByRole('button', { name: 'Redefinir senha' }))

  await waitFor(() => expect(screen.getByRole('heading', { name: 'Senha redefinida' })).toBeTruthy())
  expect(auth.functions.invoke).toHaveBeenCalledWith('portal-password-reset', { body: { token: 'TOKEN', password: 'senhaSegura1' } })

  await user.click(screen.getByRole('button', { name: 'Ir para o login' }))
  await waitFor(() => expect(screen.getByText('LOGIN PLACEHOLDER')).toBeTruthy())
})

it('achado 3.3 (auditoria 2026-08-12): remove o token da URL apos a montagem, sem perder o submit', async () => {
  const user = userEvent.setup()
  function LocationProbe() {
    const location = useLocation()
    return <span data-testid="search">{location.search}</span>
  }
  render(
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={['/portal/recuperar-senha?token=TOKEN']}>
        <PortalResetPassword />
        <LocationProbe />
      </MemoryRouter>
    </ConfirmDialogProvider>,
  )

  await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))

  await user.type(screen.getByLabelText('Nova senha'), 'senhaSegura1')
  await user.type(screen.getByLabelText('Confirmar senha'), 'senhaSegura1')
  await user.click(screen.getByRole('button', { name: 'Redefinir senha' }))
  const dialog = await screen.findByRole('dialog', { name: 'Redefinir senha do Portal' })
  await user.click(within(dialog).getByRole('button', { name: 'Redefinir senha' }))

  await waitFor(() => expect(auth.functions.invoke).toHaveBeenCalledWith('portal-password-reset', { body: { token: 'TOKEN', password: 'senhaSegura1' } }))
})

it('US-157: rejeita senha sem composicao minima', async () => {
  const user = userEvent.setup()
  render(
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={['/portal/recuperar-senha?token=TOKEN']}>
        <PortalResetPassword />
      </MemoryRouter>
    </ConfirmDialogProvider>,
  )

  await waitFor(() => expect(screen.getByRole('heading', { name: 'Redefinir senha' })).toBeTruthy())
  await user.type(screen.getByLabelText('Nova senha'), 'senhafraca')
  await user.type(screen.getByLabelText('Confirmar senha'), 'senhafraca')
  await user.click(screen.getByRole('button', { name: 'Redefinir senha' }))

  // A mensagem passou a vir de src/lib/passwordPolicy.ts (auditoria 2026-08-14,
  // achado A-04): a regra do Portal e a interna são a mesma, e a ADR 0019 já
  // decidia isso. Antes havia uma cópia sem acentuação só nesta tela. A regra
  // também fica visível como ajuda do campo; o erro é o que chega como alerta.
  expect(screen.getByRole('alert').textContent).toContain(PASSWORD_RULE_MESSAGE)
  expect(auth.functions.invoke).not.toHaveBeenCalledWith('portal-password-reset', expect.anything())
})
