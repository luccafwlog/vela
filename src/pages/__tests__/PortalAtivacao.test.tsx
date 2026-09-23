// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('../../components/security/TurnstileChallenge', async () => {
  const { useEffect } = await import('react')
  return {
    TurnstileChallenge: ({ onToken, resetKey }: { onToken: (token: string) => void; resetKey: number }) => {
      useEffect(() => onToken(`test-turnstile-token-${resetKey}`), [onToken, resetKey])
      return null
    },
  }
})

const invoke = vi.hoisted(() => vi.fn())
vi.mock('../../services/supabase', () => ({ supabasePortal: { functions: { invoke } } }))

import { PortalAtivacao } from '../PortalAtivacao'

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ data: { company_name: 'Cliente PoC', cnpj_masked: '12.***.***/0001-95' }, error: null })
})

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="search">{location.search}</span>
}

// Achado 3.3 (auditoria 2026-08-12): o token de ativacao vazava para a
// telemetria via event.request.url. Removido da URL apos a leitura, mantido
// em estado para o submit (espelha PortalProfile/PortalResetPassword).
it('achado 3.3: remove o token da URL apos a montagem, sem perder o submit', async () => {
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/portal/ativar?token=TOKEN']}>
      <PortalAtivacao />
      <LocationProbe />
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByText('Cliente PoC')).toBeTruthy())
  expect(screen.getByTestId('search').textContent).toBe('')
  expect(invoke).toHaveBeenCalledWith('portal-invite-activate', {
    body: { action: 'inspect', token: 'TOKEN', turnstile_token: 'test-turnstile-token-0' },
  })

  // O campo ganhou o `hint` com a regra de senha (auditoria 2026-08-14, achado
  // A-04). O hint mora dentro do <label>, então o nome acessível do input passou
  // a incluí-lo — daí a consulta por prefixo em vez de texto exato.
  await user.type(screen.getByLabelText('Nova senha', { exact: false }), 'senhaSegura1')
  await user.type(screen.getByLabelText('Confirmar senha'), 'senhaSegura1')
  await user.click(screen.getByRole('button', { name: 'Ativar acesso' }))

  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('portal-invite-activate', {
      body: { action: 'activate', token: 'TOKEN', password: 'senhaSegura1', turnstile_token: 'test-turnstile-token-1' },
    }),
  )
})
