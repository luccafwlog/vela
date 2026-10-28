// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  markBlReadyAndCreateInvoice: vi.fn(),
  showToast: vi.fn(),
  confirm: vi.fn(),
  confirmWithReason: vi.fn(),
  changeCharge: vi.fn(),
  deleteManual: vi.fn(),
  setExemption: vi.fn(),
  previewEffect: vi.fn(),
  history: [] as unknown[],
  isAdmin: true,
  lines: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, isAdmin: mocks.isAdmin }),
}))
vi.mock('../../ui/ConfirmDialog', () => ({
  useConfirm: () => mocks.confirm,
  useConfirmWithReason: () => mocks.confirmWithReason,
}))
vi.mock('../../ui/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))
vi.mock('../../../hooks/useLocalCharges', () => ({
  useBlLocalChargeLines: mocks.lines,
  useManualChargeItemsForBl: () => ({ data: [], isLoading: false }),
  useAddManualBlCharge: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateManualBlCharge: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteManualBlCharge: () => ({ mutateAsync: mocks.deleteManual, isPending: false }),
  useCalculateBlLocalCharges: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChangeBlCharge: () => ({ mutateAsync: mocks.changeCharge, isPending: false }),
  useBlChargeHistory: () => ({ data: mocks.history, isLoading: false }),
  useSetBlLocalChargeExemption: () => ({ mutateAsync: mocks.setExemption, isPending: false }),
}))
vi.mock('../../../services/charges/chargeOperationsService', () => ({
  previewBlChargeChangeEffect: mocks.previewEffect,
}))
vi.mock('../../../services/billing', () => ({
  markBlReadyAndCreateInvoice: mocks.markBlReadyAndCreateInvoice,
}))

import { BlCobrancasSection } from '../BlCobrancasTab'

const bl = {
  id: 'BL-1',
  customer_id: 1,
  charge_status: 'calculated',
  financial_status: 'pending',
  ce_mercante: '123456789012345',
} as never

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isAdmin = true
  mocks.history = []
  mocks.lines.mockReturnValue({ data: [], isLoading: false })
  mocks.confirm.mockResolvedValue(true)
  mocks.markBlReadyAndCreateInvoice.mockRejectedValue({
    code: 'P0003',
    message: 'Faturamento bloqueado pelo Portal: Portal do Cliente não está ativo.',
  })
})

describe('cobranças do B/L', () => {
  it('não oferece Marcar revisado nem Pronto para faturar', () => {
    render(<BlCobrancasSection bl={bl} />)
    expect(screen.queryByRole('button', { name: 'Marcar revisado' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pronto para faturar' })).toBeNull()
  })

  it('Emitir fatura pede confirmação e exibe a razão operacional do backend ao falhar', async () => {
    render(<BlCobrancasSection bl={bl} />)

    fireEvent.click(screen.getByRole('button', { name: 'Emitir fatura' }))

    await waitFor(() => {
      expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Emitir fatura' }))
      expect(mocks.markBlReadyAndCreateInvoice).toHaveBeenCalledWith({ blId: 'BL-1', customerId: 1, actorId: 'user-1' })
      expect(mocks.showToast).toHaveBeenCalledWith(
        'Falha ao emitir a fatura: Faturamento bloqueado pelo Portal: Portal do Cliente não está ativo.',
        'error',
      )
    })
  })

  it('não emite sem confirmação', async () => {
    mocks.confirm.mockResolvedValue(false)
    render(<BlCobrancasSection bl={bl} />)
    fireEvent.click(screen.getByRole('button', { name: 'Emitir fatura' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    expect(mocks.markBlReadyAndCreateInvoice).not.toHaveBeenCalled()
  })

  it('qualquer Departamento vê Emitir fatura (ADR 0085, D3), e só com CE Mercante', () => {
    mocks.isAdmin = false
    render(<BlCobrancasSection bl={bl} />)
    expect(screen.getByRole('button', { name: 'Emitir fatura' })).toBeTruthy()
    cleanup()
    render(<BlCobrancasSection bl={{ ...(bl as object), ce_mercante: null } as never} />)
    expect(screen.queryByRole('button', { name: 'Emitir fatura' })).toBeNull()
  })

  it('linha que precisa de revisão bloqueia a emissão', () => {
    mocks.lines.mockReturnValue({ data: [{ status: 'review_required' }], isLoading: false })
    render(<BlCobrancasSection bl={bl} />)
    expect((screen.getByRole('button', { name: 'Emitir fatura' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

it('não anuncia divergência de fatura enquanto as taxas estão indisponíveis', () => {
  mocks.lines.mockReturnValue({ data: undefined, isLoading: true })
  const { rerender } = render(<MemoryRouter><BlCobrancasSection bl={bl} activeInvoice={{ id: 77, status: 'issued', total_brl: 100 } as never} /></MemoryRouter>)
  expect(screen.getByText('Carregando taxas…')).toBeTruthy()
  expect(screen.queryByText(/As taxas mudaram depois da emissão/)).toBeNull()
  mocks.lines.mockReturnValue({ data: [{ total_value_brl: 100 }], isLoading: false })
  rerender(<MemoryRouter><BlCobrancasSection bl={bl} activeInvoice={{ id: 77, status: 'issued', total_brl: 100 } as never} /></MemoryRouter>)
  expect(screen.queryByText(/As taxas mudaram depois da emissão/)).toBeNull()
})

const renderSection = (overrides: Record<string, unknown> = {}) =>
  render(<MemoryRouter><BlCobrancasSection bl={{ ...(bl as object), ...overrides } as never} /></MemoryRouter>)

describe('alterar e excluir taxa do B/L (ADR 0111)', () => {
  const thd = {
    id: 7, bl_id: 'BL-1', charge_name: 'THD', source: 'auto', status: 'calculated', quantity: 2, currency: 'BRL',
    unit_value_brl: 1200, total_value_brl: 2400, calculation_key: 'auto:item:1', application_basis: 'container_distinct_voyage',
    table_unit_value_brl: 1420, table_total_value_brl: 2840, adjustment_id: 3, adjustment_kind: 'unit',
    adjustment_justification: 'Acordo comercial', adjusted_by_name: 'Fulano', adjusted_at: '2026-10-28T10:00:00Z',
  }

  it('marca a taxa alterada e oferece as ações a qualquer setor', () => {
    mocks.isAdmin = false
    mocks.lines.mockReturnValue({ data: [thd, { ...thd, id: 8, charge_name: 'Taxa de B/L', calculation_key: 'auto:item:2', adjustment_id: null, adjustment_kind: null }], isLoading: false })
    renderSection()
    expect(screen.getByText('Alterada')).toBeTruthy()
    expect(screen.getByText('Histórico das taxas')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Alterar valor da taxa' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Excluir taxa' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Voltar ao valor da tabela' })).toHaveLength(1)
  })

  it('excluir pede justificativa de 10 caracteres e mostra o motivo do banco ao falhar', async () => {
    mocks.lines.mockReturnValue({ data: [thd], isLoading: false })
    mocks.confirmWithReason.mockResolvedValueOnce('curta')
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Excluir taxa' }))
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Escreva a justificativa (ao menos 10 caracteres).', 'error'))
    expect(mocks.changeCharge).not.toHaveBeenCalled()

    mocks.confirmWithReason.mockResolvedValueOnce('Cliente isento por contrato')
    mocks.changeCharge.mockRejectedValueOnce({ code: 'P0001', message: 'Esta é a última taxa cobrada do B/L. Para não cobrar nada, use Isentar Taxas Locais.' })
    fireEvent.click(screen.getByRole('button', { name: 'Excluir taxa' }))
    await waitFor(() => expect(mocks.changeCharge).toHaveBeenCalledWith(expect.objectContaining({ action: 'exclude', lineKey: 'auto:item:1', justification: 'Cliente isento por contrato' })))
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith(expect.stringMatching(/^Não foi possível excluir a taxa: .*última taxa cobrada/), 'error'))
  })

  it('linha excluída fica riscada e só oferece Incluir taxa de novo', () => {
    mocks.lines.mockReturnValue({ data: [{ ...thd, status: 'excluded', total_value_brl: 0, adjustment_kind: 'excluded' }], isLoading: false })
    renderSection()
    expect(screen.getAllByText('Excluída').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Incluir taxa de novo' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Alterar valor da taxa' })).toBeNull()
  })
})

describe('Isentar Taxas Locais (ADR 0111, D12)', () => {
  const line = {
    id: 7, bl_id: 'BL-1', charge_name: 'THD', source: 'auto', status: 'calculated', quantity: 1, currency: 'BRL',
    unit_value_brl: 1420, total_value_brl: 1420, calculation_key: 'auto:item:1', table_unit_value_brl: 1420, table_total_value_brl: 1420,
  }

  it('isentar pede justificativa e diz o efeito; o sucesso usa a frase da spec', async () => {
    mocks.lines.mockReturnValue({ data: [line], isLoading: false })
    mocks.confirmWithReason.mockResolvedValueOnce('Carga de doação, acordado')
    mocks.setExemption.mockResolvedValueOnce({})
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Isentar Taxas Locais' }))
    await waitFor(() => expect(mocks.setExemption).toHaveBeenCalledWith({ exempt: true, justification: 'Carga de doação, acordado', actorId: 'user-1' }))
    expect(mocks.confirmWithReason).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Isentar Taxas Locais do B/L', confirmLabel: 'Isentar',
      message: expect.stringContaining('Nenhuma taxa deste B/L será cobrada, nem as manuais'),
    }))
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('B/L isento das Taxas Locais.', 'success'))
  })

  it('B/L isento à mão: linhas sem ação, fato com autor e data, e só Retirar isenção', async () => {
    mocks.history = [{ id: 1, event: 'exempted', actor_name: 'Fulano', created_at: '2026-10-28T13:00:00Z' }]
    mocks.lines.mockReturnValue({ data: [{ ...line, status: 'exempt', total_value_brl: 0 }, { ...line, id: 8, status: 'excluded', adjustment_id: 2, adjustment_kind: 'excluded' }], isLoading: false })
    renderSection({ charge_status: 'exempt', charge_exemption_reason: 'Isenção manual: Carga de doação, acordado' })
    expect(screen.getByText('Isenção manual: Carga de doação, acordado · por Fulano em 28/10/2026')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Isentar Taxas Locais' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Incluir taxa de novo' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Adicionar cobrança manual' })).toBeNull()
    mocks.confirmWithReason.mockResolvedValueOnce('Diretoria reviu a decisão')
    mocks.setExemption.mockRejectedValueOnce({ code: 'P0001', message: 'B/L isento das Taxas Locais: retire a isenção para alterar as taxas.' })
    fireEvent.click(screen.getByRole('button', { name: 'Retirar isenção' }))
    await waitFor(() => expect(mocks.setExemption).toHaveBeenCalledWith(expect.objectContaining({ exempt: false })))
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith(expect.stringMatching(/^Não foi possível retirar a isenção: /), 'error'))
  })

  it('B/L isento pelo veículo LCL não mostra Isentar nem Retirar isenção', () => {
    renderSection({ charge_status: 'exempt', charge_exemption_reason: 'Carga de veiculos / LCL no destino (movement_to=LCL) com taxas pagas na origem' })
    expect(screen.queryByRole('button', { name: 'Isentar Taxas Locais' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retirar isenção' })).toBeNull()
  })
})

describe('B/L faturado (ADR 0111, D8)', () => {
  const manual = {
    id: 8, bl_id: 'BL-1', charge_name: 'Armazenagem', source: 'manual', status: 'ready_for_billing', quantity: 1, currency: 'BRL',
    unit_value_brl: 500, total_value_brl: 500, calculation_key: 'manual:1', table_unit_value_brl: 500, table_total_value_brl: 500,
  }

  it('as ações passam pela correção: a confirmação traz o efeito na fatura lido do banco', async () => {
    mocks.lines.mockReturnValue({ data: [manual], isLoading: false })
    mocks.previewEffect.mockResolvedValueOnce({ situation: 'reissue', message: 'A fatura INV-1 (R$ 500,00) será cancelada e reemitida com número novo, no valor de R$ 0,00.' })
    mocks.confirmWithReason.mockResolvedValueOnce(null)
    renderSection({ financial_status: 'invoiced' })
    expect(screen.getByText(/Alterar, excluir ou isentar passa pela correção da fatura/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Adicionar cobrança manual/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Editar cobrança manual' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Isentar Taxas Locais' }))
    await waitFor(() => expect(mocks.confirmWithReason).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Isentar Taxas Locais do B/L', consequence: expect.stringContaining('será cancelada e reemitida'),
    })))
    expect(mocks.previewEffect).toHaveBeenCalledWith({ blId: 'BL-1', action: 'exempt' })
  })

  it('a recusa da prévia aparece antes de pedir a justificativa', async () => {
    mocks.lines.mockReturnValue({ data: [manual], isLoading: false })
    mocks.previewEffect.mockRejectedValueOnce({ code: '22023', message: 'B/L já está isento das Taxas Locais.' })
    renderSection({ financial_status: 'paid' })
    fireEvent.click(screen.getByRole('button', { name: 'Isentar Taxas Locais' }))
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('isento'), 'error'))
    expect(mocks.confirmWithReason).not.toHaveBeenCalled()
  })

  it('B/L sem fatura não consulta a prévia', async () => {
    mocks.lines.mockReturnValue({ data: [manual], isLoading: false })
    mocks.confirmWithReason.mockResolvedValueOnce(null)
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Isentar Taxas Locais' }))
    await waitFor(() => expect(mocks.confirmWithReason).toHaveBeenCalled())
    expect(mocks.previewEffect).not.toHaveBeenCalled()
  })
})
