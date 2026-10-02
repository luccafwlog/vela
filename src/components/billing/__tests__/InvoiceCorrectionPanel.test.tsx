// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ confirm: vi.fn().mockResolvedValue(true), mutate: vi.fn().mockResolvedValue({ offset_brl: 200, refund_brl: 0 }) }))
vi.mock('../../../hooks/useBillingLedger', () => ({
  useInvoiceCorrectionSummary: () => ({ data: { receivables: [{ id: 1, bl_id: 'BL-1', original_brl: 1000, corrected_brl: 1000, paid_brl: 400, balance_brl: 600 }], corrections: [] } }),
  useRegisterInvoiceCorrection: () => ({ mutateAsync: mocks.mutate, isPending: false }),
}))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
import { InvoiceCorrectionPanel } from '../InvoiceCorrectionPanel'
afterEach(cleanup)
it('guia o operador com abatimento, restituição e saldo antes de confirmar', async () => {
  const user = userEvent.setup()
  render(<InvoiceCorrectionPanel invoiceId={9} canCorrect />)
  const button = screen.getByRole('button', { name: 'Registrar correção da cobrança' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  await user.selectOptions(screen.getByLabelText('B/L da correção'), '1')
  await user.type(screen.getByLabelText('Valor total corrigido do B/L (BRL)'), '800')
  await user.type(screen.getByLabelText('Motivo da correção'), 'Peso corrigido')
  const preview = screen.getByRole('status').textContent
  expect(preview).toContain('200,00')
  expect(preview).toContain('400,00')
  expect(preview).toContain('0,00')
  await user.click(button)
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ consequence: expect.stringContaining('O total original e os itens da fatura serão preservados') }))
  expect(mocks.mutate).toHaveBeenCalledWith({ invoiceId: 9, receivableId: 1, correctedTotalBrl: 800, reason: 'Peso corrigido' })
})

it('lê o valor em formato brasileiro: "1.000" é mil, não um real', async () => {
  const user = userEvent.setup()
  render(<InvoiceCorrectionPanel invoiceId={9} canCorrect />)
  await user.selectOptions(screen.getByLabelText('B/L da correção'), '1')
  await user.type(screen.getByLabelText('Valor total corrigido do B/L (BRL)'), '1.000')
  // Igual à cobrança vigente: não há redução a registrar.
  expect(screen.queryByRole('status')).toBeNull()
  await user.clear(screen.getByLabelText('Valor total corrigido do B/L (BRL)'))
  await user.type(screen.getByLabelText('Valor total corrigido do B/L (BRL)'), '800,50')
  expect(screen.getByRole('status').textContent).toContain('199,50')
})
