// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const auth = vi.hoisted(() => ({
  signIn: vi.fn(),
}))

vi.mock('../../hooks/usePortalAuth', () => ({
  usePortalAuth: () => ({
    isAuthenticated: false,
    loading: false,
    signIn: auth.signIn,
  }),
}))

vi.mock('../../services/supabase', () => ({
  isSupabaseConfigured: true,
}))

import { INCOMPLETE_CNPJ_MESSAGE } from '../../lib/portalCnpjLogin'
import { PortalLogin } from '../PortalLogin'

afterEach(() => {
  cleanup()
  auth.signIn.mockReset()
})


it('aceita colagem de CNPJ formatado sem truncar os 3 ultimos digitos', async () => {
  render(
    <MemoryRouter>
      <PortalLogin />
    </MemoryRouter>,
  )

  const input = await screen.findByPlaceholderText('00.000.000/0000-00') as HTMLInputElement
  expect(input.maxLength).toBe(18)

  fireEvent.paste(input, {
    clipboardData: {
      getData: () => '55.115.118/0001-57',
    },
  })
  expect(input.value).toBe('55115118000157')
})

it('normaliza um CNPJ alfanumérico colado antes de autenticar', async () => {
  auth.signIn.mockResolvedValue(undefined)

  render(
    <MemoryRouter>
      <PortalLogin />
    </MemoryRouter>,
  )

  const input = await screen.findByPlaceholderText('00.000.000/0000-00') as HTMLInputElement
  fireEvent.change(input, { target: { value: '12.ABC.345/01DE-35' } })
  expect(input.value).toBe('12ABC34501DE35')
})

it('mostra erro de conexao quando o login falha por rede', async () => {
  const user = userEvent.setup()
  auth.signIn.mockRejectedValue(new TypeError('Failed to fetch'))

  render(
    <MemoryRouter>
      <PortalLogin />
    </MemoryRouter>,
  )

  await user.type(await screen.findByPlaceholderText('00.000.000/0000-00'), '12.345.678/0001-95')
  await user.type(screen.getByLabelText('Senha'), 'senha-secreta')
  await user.click(screen.getByRole('button', { name: 'Entrar no portal' }))

  await waitFor(() => {
    expect(screen.getByText('Não foi possível conectar. Verifique sua internet e tente novamente.')).toBeTruthy()
  })
  expect(screen.queryByText('Credenciais invalidas para o portal do cliente.')).toBeNull()
})

it('CNPJ incompleto para no cliente, com mensagem propria, sem tentar autenticar', async () => {
  const user = userEvent.setup()

  render(
    <MemoryRouter>
      <PortalLogin />
    </MemoryRouter>,
  )

  await user.type(await screen.findByPlaceholderText('00.000.000/0000-00'), '12.345.678')
  await user.type(screen.getByLabelText('Senha'), 'senha-secreta')
  await user.click(screen.getByRole('button', { name: 'Entrar no portal' }))

  await waitFor(() => expect(screen.getByText(INCOMPLETE_CNPJ_MESSAGE)).toBeTruthy())
  expect(auth.signIn).not.toHaveBeenCalled()
})

it('senha errada em CNPJ completo mantem a mensagem generica de credenciais', async () => {
  const user = userEvent.setup()
  auth.signIn.mockRejectedValue(new Error('CNPJ ou senha inválidos.'))

  render(
    <MemoryRouter>
      <PortalLogin />
    </MemoryRouter>,
  )

  await user.type(await screen.findByPlaceholderText('00.000.000/0000-00'), '12.345.678/0001-95')
  await user.type(screen.getByLabelText('Senha'), 'senha-errada')
  await user.click(screen.getByRole('button', { name: 'Entrar no portal' }))

  await waitFor(() => expect(screen.getByText('Credenciais inválidas para o portal do cliente.')).toBeTruthy())
})
