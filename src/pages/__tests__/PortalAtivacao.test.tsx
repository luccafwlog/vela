// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../services/supabase', () => ({ supabasePortal: { functions: { invoke: mocks.invoke } } }))

import { PortalAtivacao } from '../PortalAtivacao'

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.invoke.mockResolvedValue({ data: { company_name: 'Cliente PoC', cnpj_masked: '12.***.***/0001-95' }, error: null })
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
  expect(mocks.invoke).toHaveBeenCalledWith('portal-invite-activate', { body: { action: 'inspect', token: 'TOKEN' } })

  // A regra de senha (auditoria 2026-08-14, achado A-04) fica fora do <label>
  // e chega ao campo por aria-describedby, então o nome é exato.
  await user.type(screen.getByLabelText('Nova senha'), 'senhaSegura1')
  await user.type(screen.getByLabelText('Confirmar senha'), 'senhaSegura1')
  await user.click(screen.getByRole('button', { name: 'Ativar acesso' }))

  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith('portal-invite-activate', { body: { action: 'activate', token: 'TOKEN', password: 'senhaSegura1' } }),
  )
})

it('mostra "As senhas não conferem." no campo de confirmação e leva o foco até ele', async () => {
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/portal/ativar?token=TOKEN']}>
      <PortalAtivacao />
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByText('Cliente PoC')).toBeTruthy())
  await user.type(screen.getByLabelText('Nova senha'), 'senhaSegura1')
  await user.type(screen.getByLabelText('Confirmar senha'), 'senhaSegura2')
  await user.click(screen.getByRole('button', { name: 'Ativar acesso' }))

  const confirmField = screen.getByLabelText('Confirmar senha')
  const alert = screen.getByRole('alert')
  expect(alert.textContent).toBe('As senhas não conferem.')
  expect(confirmField.getAttribute('aria-describedby')).toContain(alert.id)
  expect(confirmField.getAttribute('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(confirmField)
  expect(mocks.invoke).not.toHaveBeenCalledWith('portal-invite-activate', expect.objectContaining({ body: expect.objectContaining({ action: 'activate' }) }))
})
