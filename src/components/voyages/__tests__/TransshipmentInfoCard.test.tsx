// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mutateAsync, revertMutateAsync, useAuthMock, useVoyageTransshipments, useUpdateVoyageOmission, useRevertVoyageOmission } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  revertMutateAsync: vi.fn(),
  useAuthMock: vi.fn(),
  useVoyageTransshipments: vi.fn(),
  useUpdateVoyageOmission: vi.fn(),
  useRevertVoyageOmission: vi.fn(),
}))

vi.mock('../../../hooks/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('../../../hooks/useTransshipments', () => ({ useVoyageTransshipments, useUpdateVoyageOmission, useRevertVoyageOmission }))

import { TransshipmentInfoCard } from '../TransshipmentInfoCard'
import { ConfirmDialogProvider } from '../../ui/ConfirmDialog'

function renderCard() {
  return render(<ConfirmDialogProvider><TransshipmentInfoCard voyageId={2} /></ConfirmDialogProvider>)
}

describe('TransshipmentInfoCard', () => {
  afterEach(cleanup)
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue(undefined)
    revertMutateAsync.mockReset().mockResolvedValue(undefined)
    useAuthMock.mockReturnValue({ user: { id: 'user-1' }, isAdmin: false })
    useUpdateVoyageOmission.mockReturnValue({ mutateAsync, isPending: false, isError: false })
    useRevertVoyageOmission.mockReturnValue({ mutateAsync: revertMutateAsync, isPending: false, isError: false })
    useVoyageTransshipments.mockReturnValue({
      data: {
        omissions: [{
          id: 9,
          voyageId: 2,
          omittedPod: 'VITÓRIA',
          dischargePod: 'SANTOS',
          reason: null,
          onwardVesselName: 'COSCO STAR',
          onwardCarrier: null,
          onwardVoyageNumber: 'T-1',
          onwardEtd: null,
          onwardEta: '2026-07-25T00:00:00Z',
        }],
        transshipments: [],
      },
    })
  })

  it('exibe os dados globais e mantém campos desconhecidos visíveis como travessão', () => {
    renderCard()

    expect(screen.getByText('Informações de Transbordo')).toBeTruthy()
    expect(screen.getByText('COSCO STAR')).toBeTruthy()
    expect(screen.getByText('T-1')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('abre edição e complementa o registro global', async () => {
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Complementar' }))
    fireEvent.change(screen.getByLabelText('Armador de Transbordo'), { target: { value: 'COSCO' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar informações' }))
    const dialog = await screen.findByRole('dialog', { name: 'Confirmar informações de transbordo' })
    expect(screen.getByRole('table', { name: 'Campos alterados' })).toBeTruthy()
    expect(mutateAsync).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar informações' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      omissionId: 9,
      onwardCarrier: 'COSCO',
      changedBy: 'user-1',
    })))
  })

  it('exibe reversão somente para Admin e exige justificativa com impacto dos B/Ls', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'admin-1' }, isAdmin: true })
    useVoyageTransshipments.mockReturnValue({
      data: {
        omissions: [{
          id: 9,
          voyageId: 2,
          omittedPod: 'VITÓRIA',
          dischargePod: 'SANTOS',
          reason: null,
          onwardVesselName: null,
          onwardCarrier: null,
          onwardVoyageNumber: null,
          onwardEtd: null,
          onwardEta: null,
        }],
        transshipments: [
          { id: 1, blId: 'BL-1', omissionId: 9, disposition: 'transshipment', onwardVesselName: null, onwardCarrier: null, onwardVoyageNumber: null, onwardEtd: null, onwardEta: null },
          { id: 2, blId: 'BL-2', omissionId: 9, disposition: 'transshipment', onwardVesselName: null, onwardCarrier: null, onwardVoyageNumber: null, onwardEtd: null, onwardEta: null },
        ],
      },
    })
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Reverter omissão' }))
    expect(screen.getByText(/2 B\/L\(s\)/)).toBeTruthy()
    expect(screen.getByText(/Clientes com link/)).toBeTruthy()
    const submitButton = screen.getAllByRole('button', { name: 'Reverter omissão' }).find((button) => button.getAttribute('type') === 'submit') as HTMLButtonElement | undefined
    expect(submitButton?.disabled).toBe(true)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'POD informado incorretamente' } })
    fireEvent.click(submitButton as HTMLButtonElement)

    await waitFor(() => expect(revertMutateAsync).toHaveBeenCalledWith({
      omissionId: 9,
      justification: 'POD informado incorretamente',
      changedBy: 'admin-1',
    }))
  })
})
