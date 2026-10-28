// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalChargeLine } from '../../../services/charges/chargeOperationsService'

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), mutateAsync: vi.fn(), readInvoiceEffect: vi.fn() }))

vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../../hooks/useLocalCharges', () => ({ useChangeBlCharge: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }) }))
vi.mock('../blChargeInvoiceEffect', () => ({ readInvoiceEffect: mocks.readInvoiceEffect }))

import { BlChargeValueModal } from '../BlChargeValueModal'

const line = {
  id: 1, bl_id: 'BL-1', charge_name: 'THD', calculation_key: 'auto:item:7', application_basis: 'container_distinct_voyage',
  source: 'auto', status: 'calculated', quantity: 2, currency: 'BRL', unit_value_brl: 1420, total_value_brl: 2840,
  unit_value_usd: null, total_value_usd: null, adjustment_kind: null,
} as unknown as LocalChargeLine

// ADR 0111, D8 (revisão da PR luccafwlog/vela#1080): no B/L faturado, Revisar
// alteração consulta o efeito na fatura antes de confirmar.
describe('Alterar valor — consulta do efeito na fatura', () => {
  let release: ((value: unknown) => void) | undefined
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readInvoiceEffect.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    mocks.confirm.mockResolvedValue(true)
  })
  afterEach(cleanup)

  function fill(onClose = vi.fn()) {
    render(<BlChargeValueModal blId="BL-1" line={line} onClose={onClose} billed />)
    fireEvent.change(screen.getByLabelText(/Novo valor por unidade/), { target: { value: '1200' } })
    fireEvent.change(screen.getByLabelText(/Justificativa/), { target: { value: 'Acordo comercial com o Cliente' } })
    return onClose
  }

  it('Voltar durante a consulta fecha de vez: a confirmação não aparece depois', async () => {
    const onClose = fill()
    fireEvent.click(screen.getByRole('button', { name: /Revisar alteração|Conferindo/ }))
    await waitFor(() => expect(mocks.readInvoiceEffect).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    release?.({ ok: true, message: 'A fatura INV-1 será reemitida.' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.mutateAsync).not.toHaveBeenCalled()
  })

  it('clique duplo consulta uma vez só', async () => {
    fill()
    const submit = screen.getByRole('button', { name: /Revisar alteração/ })
    fireEvent.click(submit)
    fireEvent.click(screen.getByRole('button', { name: /Revisar alteração|Conferindo/ }))
    await waitFor(() => expect(mocks.readInvoiceEffect).toHaveBeenCalledTimes(1))
    release?.({ ok: true, message: null })
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1))
    expect(mocks.readInvoiceEffect).toHaveBeenCalledTimes(1)
  })
})
