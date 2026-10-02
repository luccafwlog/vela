// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ corrections: [] as Array<Record<string, unknown>>, pending: [] as string[], isAdmin: true, retry: vi.fn() }))
vi.mock('../../../hooks/useBillingLedger', () => ({
  useRetryInvoiceBasisChanges: () => ({ mutate: mocks.retry, isPending: false }),
  useInvoiceCorrectionSummary: () => ({ data: { receivables: [], corrections: mocks.corrections, pending_bl_ids: mocks.pending } }),
}))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: mocks.isAdmin }) }))
import { InvoiceCorrectionPanel } from '../InvoiceCorrectionPanel'
afterEach(() => { cleanup(); mocks.pending = []; mocks.isAdmin = true; mocks.retry.mockReset() })

it('sem ajuste registrado, não mostra nada nem oferece correção digitada', () => {
  mocks.corrections = []
  const { container } = render(<InvoiceCorrectionPanel invoiceId={9} />)
  expect(container.textContent).toBe('')
  expect(screen.queryByRole('button')).toBeNull()
})

it('mostra o histórico do abatimento e da restituição feitos pelo sistema', () => {
  mocks.corrections = [{ id: 1, bl_id: 'BL-1', amount_brl: 600, offset_brl: 400, refund_brl: 200, corrected_total_brl: 600, reason: 'Correcao do B/L BL-1', created_at: '2026-10-02' }]
  render(<InvoiceCorrectionPanel invoiceId={9} />)
  // formatBRL separa "R$" do valor com espaço não separável.
  const text = (document.body.textContent ?? '').replace(/\s/g, ' ')
  expect(text).toContain('B/L BL-1 · redução de R$ 600,00')
  expect(text).toContain('Abatido do saldo: R$ 400,00')
  expect(text).toContain('Restituição: R$ 200,00')
  expect(screen.queryByRole('button')).toBeNull()
})

it('recupera pendência do B/L sem pedir valor manual', () => {
  mocks.corrections = []
  mocks.pending = ['BL-RECOVERY']
  render(<InvoiceCorrectionPanel invoiceId={9} />)
  fireEvent.click(screen.getByRole('button', { name: 'Tentar aplicar correção' }))
  expect(mocks.retry).toHaveBeenCalledWith('BL-RECOVERY')
  expect(screen.queryByRole('textbox')).toBeNull()
})

it('mostra a pendência sem mutation para leitura sem Administrativo', () => {
  mocks.corrections = []
  mocks.pending = ['BL-RECOVERY']
  mocks.isAdmin = false
  render(<InvoiceCorrectionPanel invoiceId={9} />)
  expect(screen.getByText(/BL-RECOVERY/)).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})
