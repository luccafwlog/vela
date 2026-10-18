// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  receivables: [] as Array<Record<string, unknown>>,
  confirm: vi.fn(),
  create: vi.fn(),
  onClose: vi.fn(),
  onCreated: vi.fn(),
}))

vi.mock('../../../hooks/usePortalBilling', () => ({
  usePortalConsolidatableReceivables: () => ({ data: mocks.receivables, isLoading: false }),
  usePortalCreateConsolidation: () => ({ mutateAsync: mocks.create, isPending: false }),
}))
const scope = vi.hoisted(() => ({ mode: 'client' as 'client' | 'inspect', customerId: 9, overview: null, basePath: '/portal' }))
vi.mock('../../../hooks/usePortalScope', () => ({ usePortalScope: () => scope }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import { PortalConsolidatedModal } from '../PortalConsolidatedModal'

function renderModal() {
  render(<PortalConsolidatedModal open onClose={mocks.onClose} onCreated={mocks.onCreated} />)
}

beforeEach(() => {
  mocks.receivables = [{
    receivable_id: 41,
    bl_id: 'BL-PORTAL-41',
    balance_brl: 670,
    eligibility_status: 'eligible',
    receivable_status: 'open',
    voyage_id: 8,
    vessel_name: 'Navio Sul',
    voyage_number: 'V8',
    individual_invoice_id: null,
    individual_invoice_number: null,
    eligibility_reason: null,
  }]
  mocks.confirm.mockReset().mockResolvedValue(false)
  mocks.create.mockReset().mockResolvedValue({ invoice_id: 14 })
  mocks.onClose.mockReset()
  mocks.onCreated.mockReset()
})

afterEach(() => {
  cleanup()
  scope.mode = 'client'
})

describe('PortalConsolidatedModal — confirmação da consolidação', () => {
  it('mostra o saldo e o B/L e não grava quando a pessoa volta', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('checkbox', { name: 'Selecionar B/L BL-PORTAL-41' }))
    await user.click(screen.getByRole('button', { name: 'Consolidar e emitir' }))

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    const options = mocks.confirm.mock.calls[0][0]
    expect(options.affected.items[0]).toContain('BL-PORTAL-41')
    expect(options.affected.items[0]).toMatch(/R\$\s*670,00/)
    expect(options.consequence).toContain('disponível no Portal')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('emite somente após confirmação', async () => {
    mocks.confirm.mockResolvedValue(true)
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByRole('checkbox', { name: 'Selecionar B/L BL-PORTAL-41' }))
    await user.click(screen.getByRole('button', { name: 'Consolidar e emitir' }))

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ receivableIds: [41] }))
    expect(mocks.onCreated).toHaveBeenCalledWith(14)
  })
})

const row = (id: number, bl: string, extra: Record<string, unknown> = {}) => ({
  receivable_id: id, bl_id: bl, balance_brl: 100, eligibility_status: 'eligible', receivable_status: 'open',
  voyage_id: 8, vessel_name: 'NORDIC STAR', voyage_number: '021W', individual_invoice_id: null,
  individual_invoice_number: null, eligibility_reason: 'Pode entrar na consolidada.', ...extra,
})

describe('PortalConsolidatedModal — blocos, filtros e seleção', () => {
  beforeEach(() => {
    mocks.receivables = [
      row(1, 'NSTR01', { balance_brl: 4804, individual_invoice_number: 'INV-2026-0005' }),
      row(2, 'NSTR02', { balance_brl: 1202 }),
      row(3, 'COSU03', { balance_brl: 3005, vessel_name: 'COSCO SHIPPING ARIES', voyage_number: '088E' }),
      row(4, 'NSTR04', { balance_brl: 2702, eligibility_status: 'open_consolidated', eligibility_reason: 'Já está numa consolidada em aberto.' }),
      row(5, 'XPDU05', { balance_brl: 0, eligibility_status: 'paid', receivable_status: 'settled', eligibility_reason: 'Já foi pago.' }),
    ]
  })

  it('separa quem pode entrar, esconde o pago e mostra o motivo só ao abrir o bloco', async () => {
    const user = userEvent.setup()
    renderModal()

    expect(screen.getByRole('heading', { name: 'B/Ls que podem entrar' })).toBeTruthy()
    expect(screen.getAllByRole('checkbox', { name: /^Selecionar B\/L/ })).toHaveLength(3)
    expect(screen.queryByText('Elegível')).toBeNull()
    expect(screen.getByText('INV-2026-0005')).toBeTruthy()
    // B/L pago não aparece em lugar nenhum.
    expect(screen.queryByText('XPDU05')).toBeNull()
    expect(screen.queryByText('Já foi pago.')).toBeNull()

    // O bloco dos que não podem entrar começa fechado.
    expect(screen.queryByText('Já está numa consolidada em aberto.')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Mostrar' }))
    expect(screen.getByText('Já está numa consolidada em aberto.').closest('tr')!.className).toContain('app-table__row--muted')
    expect(screen.queryByRole('checkbox', { name: 'Selecionar B/L NSTR04' })).toBeNull()
  })

  it('a seleção vale mesmo com o filtro escondendo a linha e o pé soma o marcado', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('checkbox', { name: 'Selecionar B/L NSTR01' }))
    await user.click(screen.getByRole('checkbox', { name: 'Selecionar B/L COSU03' }))
    expect(screen.getByText(/2 B\/Ls · R\$\s*7\.809,00/)).toBeTruthy()

    await user.type(screen.getByLabelText('B/L'), 'nstr')
    expect(screen.queryByRole('checkbox', { name: 'Selecionar B/L COSU03' })).toBeNull()
    expect(screen.getByText(/2 B\/Ls · R\$\s*7\.809,00/)).toBeTruthy()
    expect(screen.getByText(/1 marcado fora do filtro/)).toBeTruthy()

    // Marcar todos vale para as linhas mostradas.
    await user.click(screen.getByRole('checkbox', { name: 'Marcar todos os B/Ls mostrados' }))
    expect(screen.getByText(/3 B\/Ls · R\$\s*9\.011,00/)).toBeTruthy()

    mocks.confirm.mockResolvedValue(true)
    await user.click(screen.getByRole('button', { name: 'Consolidar e emitir' }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ receivableIds: [1, 2, 3] }))
  })

  it('filtra por Navio / Viagem com as viagens das linhas', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.type(screen.getByRole('combobox', { name: 'Navio / Viagem' }), 'cosco')
    expect(screen.queryByRole('checkbox', { name: 'Selecionar B/L NSTR01' })).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'Selecionar B/L COSU03' })).toBeTruthy()
    expect(await screen.findByRole('option', { name: /COSCO SHIPPING ARIES \/ 088E/ })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(screen.getByRole('checkbox', { name: 'Selecionar B/L NSTR01' })).toBeTruthy()
  })

  it('no Modo Inspeção a ação continua desligada', () => {
    scope.mode = 'inspect'
    renderModal()
    expect((screen.getByRole('checkbox', { name: 'Selecionar B/L NSTR01' }) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Consolidar e emitir' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
