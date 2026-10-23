// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// Captcha do login da equipe (auditoria run-3, decisão do dono de 2026-10-22).
const auth = vi.hoisted(() => ({ signIn: vi.fn() }))

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: null, loading: false, signIn: auth.signIn }),
}))
vi.mock('../../services/supabase', () => ({ isSupabaseConfigured: true }))
vi.mock('../../components/security/TurnstileChallenge', () => ({
  TurnstileChallenge: ({ action, onToken }: { action: string; onToken: (token: string) => void }) => (
    <button type="button" onClick={() => onToken(`token-${action}`)}>Resolver desafio</button>
  ),
}))

import { Login } from '../Login'
import { TURNSTILE_MESSAGES } from '../../lib/turnstileMessages'

afterEach(() => {
  cleanup()
  auth.signIn.mockReset()
  vi.unstubAllEnvs()
})

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('E-mail'), 'ana@fwlog.com.br')
  await user.type(screen.getByLabelText('Senha'), 'Senha123')
  await user.click(screen.getByRole('button', { name: 'Entrar' }))
}

it('com a chave do Turnstile, o login não sai sem o desafio e leva o token ao Auth', async () => {
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'chave-do-site')
  auth.signIn.mockResolvedValue(undefined)
  const user = userEvent.setup()
  render(<MemoryRouter><Login /></MemoryRouter>)

  await fillAndSubmit(user)
  expect(await screen.findByText('Complete a verificação de segurança antes de continuar.')).toBeTruthy()
  expect(auth.signIn).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'Resolver desafio' }))
  await user.click(screen.getByRole('button', { name: 'Entrar' }))
  await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith('ana@fwlog.com.br', 'Senha123', 'token-vela_login'))
})

it('recusa do captcha pelo Auth pede a verificação de novo, não fala em credencial', async () => {
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'chave-do-site')
  auth.signIn.mockRejectedValue({ status: 400, code: 'captcha_failed' })
  const user = userEvent.setup()
  render(<MemoryRouter><Login /></MemoryRouter>)

  await user.click(screen.getByRole('button', { name: 'Resolver desafio' }))
  await fillAndSubmit(user)
  expect(await screen.findByText(TURNSTILE_MESSAGES.verification)).toBeTruthy()
})

it('sem a chave do Turnstile (local e preview), o login segue sem token', async () => {
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
  auth.signIn.mockResolvedValue(undefined)
  const user = userEvent.setup()
  render(<MemoryRouter><Login /></MemoryRouter>)

  await fillAndSubmit(user)
  await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith('ana@fwlog.com.br', 'Senha123', undefined))
})
