// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// ACE-D03b de 2026-10-27: quem tem o acesso desativado não volta à tela de
// entrada calado.
const auth = vi.hoisted(() => ({ accessDenied: false }))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: null, loading: false, signIn: vi.fn(), accessDenied: auth.accessDenied }),
}))
vi.mock('../../services/supabase', () => ({ isSupabaseConfigured: true }))
vi.mock('../../components/security/TurnstileChallenge', () => ({ TurnstileChallenge: () => null }))

import { Login } from '../Login'

afterEach(() => {
  cleanup()
  auth.accessDenied = false
})

it('explica o acesso desativado depois que o Vela encerra a sessão', () => {
  auth.accessDenied = true
  render(<MemoryRouter><Login /></MemoryRouter>)
  expect(screen.getByRole('alert').textContent).toBe('Seu acesso ao Vela está desativado ou ainda não foi liberado. Procure o Administrativo.')
})

it('sem saída por perfil inativo, a tela não mostra o aviso', () => {
  render(<MemoryRouter><Login /></MemoryRouter>)
  expect(screen.queryByRole('alert')).toBeNull()
})
