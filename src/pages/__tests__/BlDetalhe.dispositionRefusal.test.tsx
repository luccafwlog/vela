// @vitest-environment jsdom
// Decisão do dono de 2026-10-28 (P4 da situação S4.21, regra VIA-070): quando
// o banco recusa Marcar COD ou Reverter para transbordo, a ficha mostra o
// motivo no aviso, pelo mesmo tradutor das outras telas.
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { BlDetalhe } from '../BlDetalhe'

const { useBlDetailMock, cockpit, setBlCod, setBlTransshipment } = vi.hoisted(() => ({
  useBlDetailMock: vi.fn(),
  cockpit: { disposition: 'transshipment' as 'transshipment' | 'cod' },
  setBlCod: vi.fn(),
  setBlTransshipment: vi.fn(),
}))

vi.mock('../../hooks/useBls', () => ({
  useBlDetail: useBlDetailMock,
}))

vi.mock('../../hooks/useBlCockpit', () => ({
  useBlCockpit: () => ({ data: {
    omission: { id: 77, voyageId: 10, omittedPod: 'BRSSZ', dischargePod: 'BRRIG' },
    transshipment: { disposition: cockpit.disposition },
  } }),
}))

vi.mock('../../hooks/useChargeAdjustmentGuard', () => ({
  useChargeAdjustmentGuard: () => async () => true,
  useImportChargeImpact: () => ({ data: undefined }),
}))

vi.mock('../../hooks/useBilling', () => ({
  useInvoiceLinks: () => ({ data: {} }),
}))

vi.mock('../../hooks/useVoyageReconciliation', () => ({
  useVoyageReconciliation: () => ({ data: null, isLoading: false, isError: false }),
}))

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, profile: { id: 'u1' }, isAdmin: false }),
}))

vi.mock('../../components/ui/ConfirmDialog', () => ({
  useConfirm: () => vi.fn(),
  useConfirmWithReason: () => vi.fn(),
}))

vi.mock('../../components/shared/ImportResultPanel', () => ({
  ImportResultPanel: () => null,
}))

vi.mock('../../services/transshipments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/transshipments')>()),
  setBlCod: (input: unknown) => setBlCod(input),
  setBlTransshipment: (input: unknown) => setBlTransshipment(input),
}))

function renderFicha() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/bls/BL-COD-1']}>
          <Routes>
            <Route path="/bls/:blId" element={<BlDetalhe />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function confirm(action: 'Marcar COD' | 'Reverter para transbordo', confirmLabel: string) {
  fireEvent.click(screen.getByRole('button', { name: action }))
  fireEvent.change(screen.getByLabelText(/Justificativa/), { target: { value: 'Pedido do armador' } })
  fireEvent.click(screen.getByRole('button', { name: confirmLabel }))
}

describe('BlDetalhe - recusa do banco em Marcar COD e Reverter para transbordo', () => {
  beforeEach(() => {
    setBlCod.mockReset()
    setBlTransshipment.mockReset()
    useBlDetailMock.mockReturnValue({
      data: { id: 'BL-COD-1', cargo_mode: 'container', pol: 'CNSHA', pod: 'BRSSZ', voyage_id: 10, bl_containers: [], bl_breakbulk_items: [] },
      isLoading: false,
      error: null,
    })
  })

  it('Marcar COD recusado mostra o motivo do banco', async () => {
    cockpit.disposition = 'transshipment'
    setBlCod.mockRejectedValue({ code: '22023', message: 'Cambio (ROE) nao configurado; nao e possivel reprecificar linhas em USD.', details: null, hint: null })
    renderFicha()

    confirm('Marcar COD', 'Confirmar COD')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Cambio (ROE) nao configurado; nao e possivel reprecificar linhas em USD.')
    expect(setBlCod).toHaveBeenCalledWith({ blId: 'BL-COD-1', omissionId: 77, justification: 'Pedido do armador', changedBy: 'u1' })
  })

  it('Reverter para transbordo recusado mostra o motivo do banco', async () => {
    cockpit.disposition = 'cod'
    setBlTransshipment.mockRejectedValue({ code: 'P0002', message: 'Transbordo do B/L BL-COD-1 nao encontrado', details: null, hint: null })
    renderFicha()

    confirm('Reverter para transbordo', 'Confirmar reversão')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Transbordo do B/L BL-COD-1 nao encontrado')
  })

  it('sem usuário interno ativo, o aviso diz a recusa de permissão', async () => {
    cockpit.disposition = 'transshipment'
    setBlCod.mockRejectedValue({ code: '42501', message: 'Usuario sem permissao ativa.', details: null, hint: null })
    renderFicha()

    confirm('Marcar COD', 'Confirmar COD')

    expect((await screen.findByRole('alert')).textContent).toContain('Usuario sem permissao ativa.')
  })

  it('falha técnica não expõe o diagnóstico: o aviso diz que o COD não foi marcado', async () => {
    cockpit.disposition = 'transshipment'
    setBlCod.mockRejectedValue({ code: 'PGRST202', message: 'Could not find the function public.set_bl_cod(p_bl_id) in the schema cache', details: null, hint: null })
    renderFicha()

    confirm('Marcar COD', 'Confirmar COD')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Falha ao marcar COD. Tente novamente.')
    expect(alert.textContent).not.toContain('set_bl_cod')
  })
})
