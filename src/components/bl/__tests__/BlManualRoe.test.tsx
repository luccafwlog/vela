// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({ setRoe: vi.fn(), confirm: vi.fn(), showToast: vi.fn(), role: 'equipamentos' as string }))
vi.mock('../../../services/blDemurrageConfig', () => ({ setBlManualRoe: mocks.setRoe }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ effectiveRole: mocks.role }) }))

import { BlManualRoe } from '../BlManualRoe'

function renderRoe(props: { roe: number | null; manual: boolean }) {
  return render(<QueryClientProvider client={new QueryClient()}><BlManualRoe blId="BL-1" {...props} /></QueryClientProvider>)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.role = 'equipamentos'
})

describe('BlManualRoe (migration 435)', () => {
  it('Equipamentos define o ROE manual do B/L com motivo', async () => {
    mocks.setRoe.mockResolvedValue(undefined)
    mocks.confirm.mockResolvedValue(true)
    const user = userEvent.setup()
    renderRoe({ roe: null, manual: false })

    expect(screen.getByText('Sem ROE manual: a Invoice segue a PTAX do dia')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Definir ROE manual…' }))
    const submit = screen.getByRole('button', { name: 'Definir ROE manual' }) as HTMLButtonElement
    await user.type(screen.getByLabelText(/ROE manual \(R\$ por US\$\)/), '5,8123')
    expect(submit.disabled).toBe(true)
    await user.type(screen.getByLabelText(/Motivo do ROE manual/), 'Câmbio combinado com o armador')
    await user.click(submit)

    expect(mocks.setRoe).toHaveBeenCalledWith({ blId: 'BL-1', roe: 5.8123, reason: 'Câmbio combinado com o armador' })
    expect(mocks.showToast).toHaveBeenCalledWith('ROE manual do B/L definido.', 'success')
  })

  it('tira o ROE manual com motivo', async () => {
    mocks.setRoe.mockResolvedValue(undefined)
    mocks.confirm.mockResolvedValue(true)
    const user = userEvent.setup()
    renderRoe({ roe: 5.9, manual: true })

    expect(screen.getByText('5,9000')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Tirar ROE manual…' }))
    await user.type(screen.getByLabelText(/Motivo para tirar o ROE manual/), 'Cliente pediu a PTAX do dia')
    await user.click(screen.getByRole('button', { name: 'Tirar ROE manual' }))

    expect(mocks.setRoe).toHaveBeenCalledWith({ blId: 'BL-1', roe: null, reason: 'Cliente pediu a PTAX do dia' })
  })

  it('ROE em formato inválido não chega ao banco', async () => {
    const user = userEvent.setup()
    renderRoe({ roe: null, manual: false })

    await user.click(screen.getByRole('button', { name: 'Definir ROE manual…' }))
    await user.type(screen.getByLabelText(/ROE manual \(R\$ por US\$\)/), '1e1')
    await user.type(screen.getByLabelText(/Motivo do ROE manual/), 'Câmbio combinado com o armador')
    await user.click(screen.getByRole('button', { name: 'Definir ROE manual' }))

    expect(screen.getByRole('alert').textContent).toContain('Informe o ROE')
    expect(mocks.setRoe).not.toHaveBeenCalled()
  })

  it('Operações vê o ROE manual, sem a ação', () => {
    mocks.role = 'operacoes'
    renderRoe({ roe: 5.9, manual: true })

    expect(screen.getByText('5,9000')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /ROE manual/ })).toBeNull()
  })
})
