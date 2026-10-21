// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({ release: vi.fn(), confirm: vi.fn(), showToast: vi.fn() }))
vi.mock('../../../services/demurrage/demurrageInvoices', () => ({ releaseDemurrageManualRoe: mocks.release }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))

import { ManualRoeRelease } from '../ManualRoeRelease'

describe('ManualRoeRelease (ADR 0094, B10)', () => {
  it('pede o motivo, confirma e tira o ROE manual da Invoice', async () => {
    mocks.release.mockResolvedValue(undefined)
    mocks.confirm.mockResolvedValue(true)
    const user = userEvent.setup()
    render(<QueryClientProvider client={new QueryClient()}><ManualRoeRelease invoiceId={7} docNumber="DEM-7" /></QueryClientProvider>)

    await user.click(screen.getByRole('button', { name: 'Tirar ROE manual…' }))
    const submit = screen.getByRole('button', { name: 'Tirar ROE manual' })
    expect((submit as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByRole('textbox'), 'Cliente pediu a PTAX do dia')
    await user.click(submit)

    expect(mocks.release).toHaveBeenCalledWith(7, 'Cliente pediu a PTAX do dia')
    expect(mocks.showToast).toHaveBeenCalledWith('ROE manual retirado: a Invoice segue a PTAX.', 'success')
  })
})
