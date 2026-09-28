// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), confirm: vi.fn() }))
vi.mock('../../services/supabase', () => ({ supabasePortal: { functions: { invoke: mocks.invoke } } }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))

import { PortalAtivacao } from '../PortalAtivacao'

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.invoke.mockResolvedValue({ data: { company_name: 'Cliente PoC', cnpj_masked: '12.***.***/0001-95' }, error: null })
  mocks.confirm.mockReset().mockResolvedValue(true)
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

  // O campo ganhou o `hint` com a regra de senha (auditoria 2026-08-14, achado
  // A-04). O hint mora dentro do <label>, então o nome acessível do input passou
  // a incluí-lo — daí a consulta por prefixo em vez de texto exato.
  await user.type(screen.getByLabelText('Nova senha', { exact: false }), 'senhaSegura1')
  await user.type(screen.getByLabelText('Confirmar senha'), 'senhaSegura1')
  await user.click(screen.getByRole('button', { name: 'Ativar acesso' }))

  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith('portal-invite-activate', { body: { action: 'activate', token: 'TOKEN', password: 'senhaSegura1' } }),
  )
})

it('não ativa o acesso sem aceitar o resumo do convite', async () => {
  mocks.confirm.mockResolvedValue(false)
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={['/portal/ativar?token=TOKEN']}>
      <PortalAtivacao />
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByText('Cliente PoC')).toBeTruthy())
  await user.type(screen.getByLabelText('Nova senha', { exact: false }), 'senhaSegura1')
  await user.type(screen.getByLabelText('Confirmar senha'), 'senhaSegura1')
  await user.click(screen.getByRole('button', { name: 'Ativar acesso' }))

  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
  expect(mocks.confirm.mock.calls[0][0].affected.summary).toContain('Cliente PoC')
  expect(JSON.stringify(mocks.confirm.mock.calls[0][0])).not.toContain('senhaSegura1')
  expect(mocks.invoke).toHaveBeenCalledTimes(1)
})
