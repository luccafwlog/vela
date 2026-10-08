// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  functions: { invoke: vi.fn(() => Promise.resolve<{ data: unknown; error: unknown }>({ data: { confirmed: true }, error: null })) },
  confirm: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('../../services/supabase', () => ({ supabasePortal: { auth, functions: auth.functions } }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => auth.confirm }))

import { PortalConfirmarEmail } from '../PortalConfirmarEmail'

beforeEach(() => {
  vi.clearAllMocks()
  auth.confirm.mockResolvedValue(true)
})
afterEach(cleanup)

it('reset em andamento mantém a troca pendente e orienta tentar novamente', async () => {
  auth.functions.invoke.mockResolvedValueOnce({
    data: null,
    error: { name: 'FunctionsHttpError', context: { status: 423 } },
  })
  render(
    <MemoryRouter initialEntries={['/portal/confirmar-email?token=PENDENTE']}>
      <PortalConfirmarEmail />
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByText(/Recuperação de senha em andamento/)).toBeTruthy())
  expect(screen.getByText(/Abra o link do email novamente após sua conclusão/)).toBeTruthy()
  expect(screen.queryByText(/pedido de troca de email já foi resolvido/)).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Email confirmado' })).toBeNull()
})

it('confirma o novo email sem exigir sessao do Portal', async () => {
  render(
    <MemoryRouter initialEntries={['/portal/confirmar-email?token=TOKEN']}>
      <PortalConfirmarEmail />
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByRole('heading', { name: 'Email confirmado' })).toBeTruthy())
  expect(auth.functions.invoke).toHaveBeenCalledWith('portal-recovery-email-change', {
    body: { action: 'confirm', token: 'TOKEN' },
  })
})

it('não conclui a troca quando a pessoa volta do diálogo de confirmação', async () => {
  auth.confirm.mockResolvedValue(false)
  render(
    <MemoryRouter initialEntries={['/portal/confirmar-email?token=TOKEN']}>
      <PortalConfirmarEmail />
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByText(/Você voltou/)).toBeTruthy())
  expect(auth.confirm).toHaveBeenCalledOnce()
  expect(auth.functions.invoke).not.toHaveBeenCalled()
})

it('aceita o parametro antigo confirm_email dos links ja enviados', async () => {
  render(
    <MemoryRouter initialEntries={['/portal/confirmar-email?confirm_email=ANTIGO']}>
      <PortalConfirmarEmail />
    </MemoryRouter>,
  )

  await waitFor(() =>
    expect(auth.functions.invoke).toHaveBeenCalledWith('portal-recovery-email-change', {
      body: { action: 'confirm', token: 'ANTIGO' },
    }),
  )
})

it('remove o token da URL apos a leitura, sem perder a confirmacao', async () => {
  function LocationProbe() {
    const location = useLocation()
    return <span data-testid="search">{location.search}</span>
  }

  render(
    <MemoryRouter initialEntries={['/portal/confirmar-email?token=TOKEN']}>
      <Routes>
        <Route
          path="/portal/confirmar-email"
          element={
            <>
              <PortalConfirmarEmail />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''))
  expect(auth.functions.invoke).toHaveBeenCalledTimes(1)
})

it('link sem token mostra erro em vez de chamar a Edge Function', () => {
  render(
    <MemoryRouter initialEntries={['/portal/confirmar-email']}>
      <PortalConfirmarEmail />
    </MemoryRouter>,
  )

  expect(screen.getByText(/Link de confirmação inválido ou expirado/)).toBeTruthy()
  expect(auth.functions.invoke).not.toHaveBeenCalled()
})

it('token recusado pela Edge Function vira mensagem de link invalido', async () => {
  // Forma real de um FunctionsHttpError: `invoke` resolve com `{ error }` e o
  // Response da funcao vem em `context`. O 410 e o unico veredito de link morto.
  auth.functions.invoke.mockResolvedValueOnce({
    data: null,
    error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status: 410 } },
  })

  render(
    <MemoryRouter initialEntries={['/portal/confirmar-email?token=EXPIRADO']}>
      <PortalConfirmarEmail />
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByText(/Link de confirmação inválido ou expirado/)).toBeTruthy())
})

it('falha de transporte nao declara o link morto, porque o token continua valido', async () => {
  // `functions.invoke` NAO rejeita quando o fetch falha: resolve com um
  // FunctionsFetchError, sem `context`. Mandar "peca a troca novamente" aqui
  // queimaria um token valido e exigiria do leitor do email uma senha do
  // Portal que ele nao tem.
  auth.functions.invoke.mockResolvedValueOnce({
    data: null,
    error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' },
  })

  render(
    <MemoryRouter initialEntries={['/portal/confirmar-email?token=VALIDO']}>
      <PortalConfirmarEmail />
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByText(/Abra o link do email novamente em instantes/)).toBeTruthy())
  expect(screen.queryByText(/Link de confirmação inválido ou expirado/)).toBeNull()
})

it('pedido ja resolvido tem mensagem propria, distinta de link invalido', async () => {
  // 409: a Edge Function leu a conta ANTES de queimar o convite e viu que nao
  // havia troca pendente para aplicar -- tipicamente porque o atendimento ja
  // trocou o email. O link estava valido; dizer "invalido" mandaria o cliente
  // refazer uma troca que ja aconteceu.
  auth.functions.invoke.mockResolvedValueOnce({
    data: null,
    error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status: 409 } },
  })

  render(
    <MemoryRouter initialEntries={['/portal/confirmar-email?token=JA_RESOLVIDO']}>
      <PortalConfirmarEmail />
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByText(/pedido de troca de email já foi resolvido/)).toBeTruthy())
  expect(screen.queryByText(/Link de confirmação inválido ou expirado/)).toBeNull()
  expect(screen.queryByText(/Abra o link do email novamente em instantes/)).toBeNull()
})
