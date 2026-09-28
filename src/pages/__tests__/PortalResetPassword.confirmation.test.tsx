// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), confirm: vi.fn() }))
vi.mock('../../services/supabase', () => ({ supabasePortal: { functions: { invoke: mocks.invoke } } }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))

import { PortalResetPassword } from '../PortalResetPassword'

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue({ data: null, error: null })
  mocks.confirm.mockReset().mockResolvedValue(false)
})
afterEach(cleanup)

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/portal/recuperar-senha?token=RESET-TOKEN']}>
      <PortalResetPassword />
    </MemoryRouter>,
  )
}

describe('PortalResetPassword — confirmação', () => {
  it('não altera a senha se a pessoa voltar e não inclui a senha no resumo', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByLabelText('Nova senha'), 'senhaNova123')
    await user.type(screen.getByLabelText('Confirmar senha'), 'senhaNova123')
    await user.click(screen.getByRole('button', { name: 'Redefinir senha' }))

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    expect(JSON.stringify(mocks.confirm.mock.calls[0][0])).not.toContain('senhaNova123')
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('redefine a senha só depois da confirmação', async () => {
    mocks.confirm.mockResolvedValue(true)
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByLabelText('Nova senha'), 'senhaNova123')
    await user.type(screen.getByLabelText('Confirmar senha'), 'senhaNova123')
    await user.click(screen.getByRole('button', { name: 'Redefinir senha' }))

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('portal-password-reset', {
      body: { token: 'RESET-TOKEN', password: 'senhaNova123' },
    }))
  })
})
