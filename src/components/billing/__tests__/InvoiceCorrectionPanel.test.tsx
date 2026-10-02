// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ corrections: [] as Array<Record<string, unknown>> }))
vi.mock('../../../hooks/useBillingLedger', () => ({
  useInvoiceCorrectionSummary: () => ({ data: { receivables: [], corrections: mocks.corrections } }),
}))
import { InvoiceCorrectionPanel } from '../InvoiceCorrectionPanel'
afterEach(cleanup)

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
