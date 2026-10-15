// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlContainerCorrectModal } from '../BlContainerCorrectModal'

const mocks = vi.hoisted(() => ({
  setContainerProfile: vi.fn(),
  correctContainerData: vi.fn(),
  updateContainerDates: vi.fn(),
  updateContainerReturnDate: vi.fn(),
}))

vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => () => Promise.resolve(true) }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../../services/vaziosNatureza', async (original) => ({
  ...(await original() as object),
  setContainerProfile: mocks.setContainerProfile,
  setContainerOwnership: vi.fn(),
}))
vi.mock('../../../services/containerCorrection', async (original) => ({
  ...(await original() as object),
  correctContainerData: mocks.correctContainerData,
}))
vi.mock('../../../services/demurrage/demurrageContainers', () => ({
  updateContainerDates: mocks.updateContainerDates,
  updateContainerReturnDate: mocks.updateContainerReturnDate,
}))

const container = { id: 9, container_number: 'CSNU6012309', type: '20GP', ownership: 'COC', seal_number: 'SL88109', gross_weight_kg: 47900, cbm: 24, discharge_date: '2026-10-13', return_date: null, is_imo: false, is_oog: false }

function renderModal() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BlContainerCorrectModal bl={{ id: 'BL-1', voyage_id: 10 }} container={container as never} chargesLocked={false} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
  fireEvent.change(screen.getByLabelText(/Justificativa/), { target: { value: 'Conferido com o armador' } })
}

describe('janela Corrigir do container', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.setContainerProfile.mockResolvedValue({ invoicedBls: [] })
    mocks.correctContainerData.mockResolvedValue(undefined)
  })

  it('depois de uma falha no meio, Salvar de novo reenvia só o que faltou', async () => {
    mocks.correctContainerData.mockRejectedValueOnce(new Error('fetch failed'))
    renderModal()
    fireEvent.change(screen.getByLabelText('Perfil'), { target: { value: 'oog' } })
    fireEvent.change(screen.getByLabelText('Lacre'), { target: { value: 'SL99999' } })

    fireEvent.click(screen.getByRole('button', { name: 'Salvar correção' }))
    expect(await screen.findByText(/Já foram gravados: perfil/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Salvar correção' }))
    await waitFor(() => expect(mocks.correctContainerData).toHaveBeenCalledTimes(2))
    expect(mocks.setContainerProfile).toHaveBeenCalledTimes(1)
  })

  it('só a devolução mudou: grava a devolução sem reenviar a descarga', async () => {
    renderModal()
    fireEvent.change(screen.getByLabelText('Devolução'), { target: { value: '2026-10-20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar correção' }))
    await waitFor(() => expect(mocks.updateContainerReturnDate).toHaveBeenCalledWith(9, '2026-10-20', 'Conferido com o armador'))
    expect(mocks.updateContainerDates).not.toHaveBeenCalled()
  })

  it('a descarga mudou: grava as duas datas', async () => {
    renderModal()
    fireEvent.change(screen.getByLabelText('Descarga'), { target: { value: '2026-10-12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar correção' }))
    await waitFor(() => expect(mocks.updateContainerDates).toHaveBeenCalledWith(9, '2026-10-12', null, 'Conferido com o armador'))
    expect(mocks.updateContainerReturnDate).not.toHaveBeenCalled()
  })
})
