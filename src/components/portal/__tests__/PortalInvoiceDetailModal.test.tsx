// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PortalInvoiceDetail } from '../../../services/portalBilling'
import { PortalInvoiceDetailModal } from '../PortalInvoiceDetailModal'

afterEach(cleanup)

const pixPayload = '00020101021226880014br.gov.bcb.pix'

function manualDetail(): PortalInvoiceDetail {
  return {
    invoice: {
      id: 3,
      invoice_number: 'INV-AV-003',
      invoice_type: 'manual',
      status: 'issued',
      total_brl: 75,
      total_paid_brl: 0,
      balance_brl: 75,
      customer_name: 'Cliente Avulso',
      customer_cnpj_cpf: '12345678000199',
      notes: 'Descrição complementar da cobrança',
      voyage_id: 42,
      voyage_number: '42N',
      vessel_name: 'NAVIO MANUAL',
      issued_at: '2026-06-03',
      pix_payload: pixPayload,
    },
    bls: [],
    items: [{
      id: 41,
      invoice_id: 3,
      bl_id: null,
      description: 'Serviço extraordinário',
      quantity: 1,
      unit_value_brl: 75,
      total_value_brl: 75,
      source: 'manual',
      currency: 'BRL',
      unit_value_usd: null,
      total_value_usd: null,
      calculation_key: null,
      snapshot_payload: null,
    }],
    containers: [],
    payments: [],
  } as unknown as PortalInvoiceDetail
}

describe('PortalInvoiceDetailModal', () => {
  it('mostra fatura avulsa sem seção vazia de B/L, mantém PIX e não oferece reconsolidação', async () => {
    const user = userEvent.setup()
    const onPrint = vi.fn()
    render(
      <PortalInvoiceDetailModal
        open
        invoiceId={3}
        detail={manualDetail()}
        loading={false}
        error={null}
        canObsolete
        obsoleteLoading={false}
        onClose={vi.fn()}
        onObsolete={vi.fn()}
        onPrint={onPrint}
        onPrintReceipt={vi.fn()}
      />,
    )

    // O pagamento vem primeiro: o saldo a pagar em destaque e o Pix ao lado.
    expect(screen.getAllByRole('heading', { level: 3 })[0].textContent).toBe('Pagamento')
    expect(screen.getByText('R$ 75,00 a pagar')).toBeTruthy()
    expect(screen.getByText('Avulsa · emitida em 03/06/2026 · Emitida')).toBeTruthy()
    // A descrição da avulsa é um dado do Pagamento; sai o bloco "Contexto da cobrança".
    expect(screen.getByText('Descrição complementar da cobrança').closest('dl')).toBeTruthy()
    expect(screen.getByText('Descrição complementar da cobrança')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Contexto da cobrança' })).toBeNull()
    expect(screen.getByText('Serviço extraordinário')).toBeTruthy()
    expect(screen.getByText('NAVIO MANUAL / 42N')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'B/Ls' })).toBeNull()
    expect(screen.getByText('Pague com Pix')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copiar código Pix' })).toBeTruthy()
    // Sem pagamento, sem o bloco Pagamentos recebidos.
    expect(screen.queryByRole('heading', { name: 'Pagamentos recebidos' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Refazer consolidada/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: /Imprimir fatura/ }))
    expect(onPrint).toHaveBeenCalledTimes(1)
  })

  function ledgerDetail(invoice: Record<string, unknown>): PortalInvoiceDetail {
    return {
      invoice: { total_paid_brl: 0, customer_name: 'Cliente', customer_cnpj_cpf: '12345678000199', issued_at: '2026-10-08', pix_payload: null, ...invoice },
      bls: [], items: [], containers: [], payments: [],
    } as unknown as PortalInvoiceDetail
  }

  function renderModal(detail: PortalInvoiceDetail, handlers: { onPrintReceipt?: () => void; onOpenInvoice?: (id: number) => void } = {}) {
    render(
      <PortalInvoiceDetailModal
        open
        invoiceId={Number(detail.invoice?.id)}
        detail={detail}
        loading={false}
        error={null}
        canObsolete={false}
        obsoleteLoading={false}
        onClose={vi.fn()}
        onObsolete={vi.fn()}
        onPrint={vi.fn()}
        onPrintReceipt={handlers.onPrintReceipt ?? vi.fn()}
        onOpenInvoice={handlers.onOpenInvoice}
      />,
    )
  }

  it('individual coberta não oferece recibo e leva à consolidada que a quitou', async () => {
    const user = userEvent.setup()
    const onOpenInvoice = vi.fn()
    renderModal(ledgerDetail({
      id: 7, invoice_number: 'INV-2026-0007', invoice_type: 'individual', status: 'covered',
      total_brl: 0.1, balance_brl: 0, covered_by_invoice_id: 9, covered_by_invoice_number: 'INV-2026-0009',
    }), { onOpenInvoice })

    expect(screen.queryByRole('button', { name: /Imprimir recibo/ })).toBeNull()
    expect(screen.getByText('pela consolidada INV-2026-0009')).toBeTruthy()
    expect(screen.getByText('O pagamento e o recibo são os da consolidada.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Abrir INV-2026-0009' }))
    expect(onOpenInvoice).toHaveBeenCalledWith(9)
  })

  it('consolidada paga oferece o próprio recibo', async () => {
    const user = userEvent.setup()
    const onPrintReceipt = vi.fn()
    renderModal(ledgerDetail({
      id: 9, invoice_number: 'INV-2026-0009', invoice_type: 'consolidated', status: 'paid',
      total_brl: 0.21, total_paid_brl: 0.21, balance_brl: 0,
    }), { onPrintReceipt })

    expect(screen.getAllByText('Paga').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /Imprimir recibo/ }))
    expect(onPrintReceipt).toHaveBeenCalledTimes(1)
  })

  const bl = (id: number, blId: string) => ({ id, bl_id: blId, pol: 'CNSHA', pod: 'BRSSA', vessel_name: 'NORDIC STAR', voyage_number: '021W', subtotal_brl: 2702 })
  const item = (id: number, blId: string, description: string, total: number) => ({ id, bl_id: blId, description: `BL ${blId} - ${description}`, quantity: 1, unit_value_brl: total, total_value_brl: total })

  it('parcialmente paga: saldo a pagar, B/L como dado do Pagamento e pagamentos com dia e hora', () => {
    renderModal({
      invoice: { id: 6, invoice_number: 'INV-2026-0006', invoice_type: 'individual', status: 'partially_paid', total_brl: 2702, total_paid_brl: 1500, balance_brl: 1202, issued_at: '2026-10-08T14:13:38+00:00', pix_payload: pixPayload },
      bls: [bl(54, 'NSTR2113000002')],
      items: [item(1, 'NSTR2113000002', 'THD', 1717), item(2, 'NSTR2113000002', 'B/L Fee', 985)],
      containers: [{ id: 9, bl_id: 'NSTR2113000002', container_number: 'FCIU2130021', type: '20GP', seal_number: 'NS90021', gross_weight_kg: 24800 }],
      payments: [
        { id: 35, amount_brl: 1000, payment_method: 'pix', paid_at: '2026-10-14T14:13:38.705077+00:00', created_at: null },
        // Baixa manual do Vela: só o dia, gravado ao meio-dia em ponto.
        { id: 36, amount_brl: 500, payment_method: 'ted', paid_at: '2026-10-15T15:00:00+00:00', created_at: null },
      ],
    } as unknown as PortalInvoiceDetail)

    expect(screen.getByText(/R\$ 1\.202,00 a pagar/)).toBeTruthy()
    expect(screen.getByText('de R$ 2.702,00')).toBeTruthy()
    expect(screen.getByText('Individual · emitida em 08/10/2026 · Parcialmente paga')).toBeTruthy()
    expect(screen.getByText('o QR cobra o saldo, R$ 1.202,00')).toBeTruthy()
    // Um B/L só: B/L e trecho no Pagamento, sem a tabela B/Ls nem a coluna B/L.
    expect(screen.queryByRole('heading', { name: 'B/Ls' })).toBeNull()
    expect(screen.getByText('CNSHA → BRSSA')).toBeTruthy()
    expect(screen.queryAllByRole('columnheader', { name: 'B/L' })).toHaveLength(0)

    const payments = screen.getByRole('table', { name: 'Pagamentos recebidos nesta fatura' })
    expect(within(payments).getByText('14/10/2026 11:13')).toBeTruthy()
    expect(within(payments).getByText('15/10/2026')).toBeTruthy()
    expect(within(payments).getByText('TED')).toBeTruthy()
    expect(screen.getByText('total pago R$ 1.500,00')).toBeTruthy()

    // O total fica no pé, não como uma linha de item.
    const items = screen.getByRole('table', { name: 'Itens cobrados na fatura' })
    expect(within(items).getByRole('rowheader', { name: 'Total da fatura' }).closest('tfoot')).toBeTruthy()
  })

  it('consolidada mostra a tabela B/Ls e a coluna B/L nos itens e contêineres', () => {
    renderModal({
      invoice: { id: 8, invoice_number: 'INV-2026-0008', invoice_type: 'consolidated', status: 'issued', total_brl: 5404, total_paid_brl: 0, balance_brl: 5404, issued_at: '2026-10-15T14:13:38+00:00', pix_payload: pixPayload },
      bls: [bl(63, 'NSTR2113000004'), bl(64, 'NSTR2113000005')],
      items: [item(1, 'NSTR2113000004', 'THD', 2702), item(2, 'NSTR2113000005', 'THD', 2702)],
      containers: [{ id: 104, bl_id: 'NSTR2113000004', container_number: 'CSNU7130041', type: '40HC', seal_number: null, gross_weight_kg: null }],
      payments: [],
    } as unknown as PortalInvoiceDetail)

    expect(screen.getByText('Consolidada · 2 B/Ls · emitida em 15/10/2026 · Emitida')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'B/Ls' })).toBeTruthy()
    expect(within(screen.getByRole('table', { name: 'Itens cobrados na fatura' })).getByRole('columnheader', { name: 'B/L' })).toBeTruthy()
    expect(within(screen.getByRole('table', { name: 'Contêineres da fatura' })).getByRole('columnheader', { name: 'B/L' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Consolidada' })).toBeTruthy()
  })

  it('cancelada fica em cinza, sem complemento, sem Pix e sem total no pé', () => {
    renderModal({
      invoice: { id: 7, invoice_number: 'INV-2026-0007', invoice_type: 'individual', status: 'cancelled', total_brl: 2702, total_paid_brl: 0, balance_brl: 2702, issued_at: '2026-10-08T14:13:38+00:00', pix_payload: pixPayload },
      bls: [bl(55, 'NSTR2113000003')],
      items: [item(1, 'NSTR2113000003', 'THD', 1717), item(2, 'NSTR2113000003', 'ISPS', 985)],
      containers: [],
      payments: [],
    } as unknown as PortalInvoiceDetail)

    const lead = screen.getByText('Cancelada')
    expect(lead.className).toContain('app-lead__value--muted')
    expect(screen.queryByText(/não é cobrada/)).toBeNull()
    expect(screen.getByText('Total cancelado')).toBeTruthy()
    expect(screen.queryByText('Pague com Pix')).toBeNull()
    expect(screen.getByText('THD').closest('tr')!.className).toContain('app-table__row--muted')
    expect(screen.queryByText('Total da fatura')).toBeNull()
  })

  it('paga diz quanto e quando recebeu, sem Pix', () => {
    renderModal({
      invoice: { id: 1, invoice_number: 'INV-2026-0001', invoice_type: 'individual', status: 'paid', total_brl: 4804, total_paid_brl: 4804, balance_brl: 0, issued_at: '2026-08-20T14:13:38+00:00', pix_payload: pixPayload },
      bls: [bl(50, 'XPDU5512000001')],
      items: [], containers: [],
      payments: [{ id: 31, amount_brl: 4804, payment_method: 'pix', paid_at: '2026-09-07T14:13:38+00:00', created_at: null }],
    } as unknown as PortalInvoiceDetail)

    expect(screen.getByText('R$ 4.804,00 recebidos em 07/09/2026')).toBeTruthy()
    expect(screen.getByText('Individual · emitida em 20/08/2026')).toBeTruthy()
    expect(screen.queryByText('Pague com Pix')).toBeNull()
    expect(screen.queryByText('Recebido')).toBeNull()
  })
})
