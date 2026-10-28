// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlDetalhe } from '../BlDetalhe'

const { useBlDetailMock, cancelBlMock, authState, guard, setTransshipment, setCod } = vi.hoisted(() => ({
  useBlDetailMock: vi.fn(),
  cancelBlMock: vi.fn(),
  authState: { isAdmin: false },
  guard: vi.fn(),
  setTransshipment: vi.fn(),
  setCod: vi.fn(),
}))

vi.mock('../../hooks/useBls', () => ({
  useBlDetail: useBlDetailMock,
}))

vi.mock('../../hooks/useBlCockpit', () => ({
  useBlCockpit: () => ({ data: {
    omission: { id: 77, voyageId: 10, omittedPod: 'BRSSZ', dischargePod: 'BRRIG' },
    transshipment: { disposition: 'cod' },
  } }),
}))

vi.mock('../../hooks/useChargeAdjustmentGuard', () => ({ useChargeAdjustmentGuard: () => guard, useImportChargeImpact: () => ({ data: undefined }) }))

vi.mock('../../hooks/useBilling', () => ({
  useInvoiceLinks: () => ({ data: {} }),
}))

vi.mock('../../hooks/useVoyageReconciliation', () => ({
  useVoyageReconciliation: () => ({ data: null, isLoading: false, isError: false }),
}))

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, profile: { id: 'u1' }, isAdmin: authState.isAdmin }),
}))

vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

vi.mock('../../components/ui/ConfirmDialog', () => ({
  useConfirm: () => vi.fn(),
  useConfirmWithReason: () => vi.fn(),
}))

vi.mock('../../components/shared/ImportResultPanel', () => ({
  ImportResultPanel: ({ entityId, title = 'Processamento pós-importação' }: { entityId?: string | null; title?: string }) => (
    <section aria-label={title} data-entity-id={entityId ?? ''}>{title}</section>
  ),
}))

vi.mock('../../services/blState', () => ({
  cancelBl: cancelBlMock,
  reactivateBl: vi.fn(),
}))

vi.mock('../../hooks/useTransshipments', () => ({
  useSetBlDisposition: () => ({
    setTransshipment: { mutate: setTransshipment, isPending: false },
    setCod: { mutate: setCod, isPending: false },
  }),
}))

// ADR 0111, D6 (revisão da PR luccafwlog/vela#1080): reverter o COD devolve o
// POD original, que pode descartar taxa alterada à mão; como o Marcar COD,
// passa pelo Gravar mesmo assim antes de gravar.
describe('BlDetalhe - reverter COD com taxa alterada à mão', () => {
  beforeEach(() => {
    guard.mockReset()
    setTransshipment.mockReset()
    useBlDetailMock.mockReturnValue({
      data: { id: 'BL-COD-1', cargo_mode: 'container', pol: 'CNSHA', pod: 'BRRIG', voyage_id: 10, bl_containers: [], bl_breakbulk_items: [] },
      isLoading: false,
      error: null,
    })
  })

  function revert() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/bls/BL-COD-1']}>
          <Routes>
            <Route path="/bls/:blId" element={<BlDetalhe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reverter para transbordo' }))
    fireEvent.change(screen.getByLabelText(/Justificativa/), { target: { value: 'Carga seguiu no transbordo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reversão' }))
  }

  it('pergunta pelo POD original e não grava se a pessoa recusa', async () => {
    guard.mockResolvedValue(undefined)
    revert()
    await waitFor(() => expect(guard).toHaveBeenCalledTimes(1))
    expect(guard.mock.calls[0][0]).toEqual([{ bl_id: 'BL-COD-1', bls: { pod: 'BRSSZ' } }])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(setTransshipment).not.toHaveBeenCalled()
  })

  it('confirmado o Gravar mesmo assim, reverte', async () => {
    guard.mockResolvedValue(true)
    revert()
    await waitFor(() => expect(setTransshipment).toHaveBeenCalledWith({ blId: 'BL-COD-1', omissionId: 77, justification: 'Carga seguiu no transbordo', changedBy: 'u1' }, expect.anything()))
  })
})
