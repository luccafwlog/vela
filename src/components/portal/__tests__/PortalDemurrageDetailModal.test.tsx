// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PortalDemurrageInvoiceDetail, PortalDispute } from '../../../services/portalBilling'
import { PortalDemurrageDetailModal } from '../PortalDemurrageDetailModal'

afterEach(cleanup)

function makeDetail(overrides: Partial<PortalDemurrageInvoiceDetail['invoice']> = {}): PortalDemurrageInvoiceDetail {
  return {
      invoice: {
        id: 1,
        doc_number: 'DEM-001',
        doc_date: '2026-09-20',
        due_date: '2026-09-30',
        billed_at: '2026-09-20',
        paid_at: null,
        total_usd: 100,
        current_roe: 5.751,
        current_total_brl: 575.1,
        updated_at: '2026-09-20T12:00:00Z',
        roe_source: 'bcb_live',
        status: 'issued',
        pix_payload: null,
        dispute_open: false,
        discount_type: null,
        discount_value: null,
        discount_mode: null,
        bl_id: 'BL-001',
        pol: 'CNSHA',
        pod: 'BRVIX',
        voyage_number: '001W',
        vessel_name: 'NAVIO TESTE',
        customer_name: 'Cliente',
        customer_cnpj_cpf: '00000000000000',
        ...overrides,
      },
      items: [],
      refund_summary: { received_brl: 0, refunds: [] },
    } as PortalDemurrageInvoiceDetail
}

function renderModal(detail: PortalDemurrageInvoiceDetail, extra: { dispute?: PortalDispute | null; complementOf?: Array<{ id: number; doc_number: string }> } = {}) {
  const handlers = { onDispute: vi.fn(), onShowDispute: vi.fn(), onOpenInvoice: vi.fn(), onPrint: vi.fn() }
  render(
    <PortalDemurrageDetailModal
      open
      invoiceId={1}
      detail={detail}
      loading={false}
      dispute={extra.dispute}
      complementOf={extra.complementOf}
      onClose={vi.fn()}
      {...handlers}
    />,
  )
  return handlers
}

describe('PortalDemurrageDetailModal', () => {
  it('mostra o pagamento primeiro: a pagar hoje, dólar, ROE de hoje, B/L, trecho e o Pix em preparação', () => {
    const handlers = renderModal(makeDetail())

    expect(screen.getByRole('heading', { name: 'Pagamento' })).toBeTruthy()
    expect(screen.getByText('R$ 575,10 a pagar hoje')).toBeTruthy()
    expect(screen.getByText('ROE de hoje')).toBeTruthy()
    expect(screen.getByText('R$ 5,7510')).toBeTruthy()
    expect(screen.getByText('US$ 100,00')).toBeTruthy()
    expect(screen.getByText('CNSHA → BRVIX')).toBeTruthy()
    expect(screen.getByText(/emitida em 20\/09\/2026/)).toBeTruthy()
    // Emitida sem cobrança confirmada: Portal avisa em vez de esconder o Pix.
    expect(screen.getByRole('status').textContent).toContain('QR Code Pix em preparação')
    fireEvent.click(screen.getByRole('button', { name: /Imprimir Invoice/ }))
    expect(handlers.onPrint).toHaveBeenCalled()
  })

  it('B30: mostra cada período (P1/P2) numa linha, dias × diária, sem Dias cobrados', () => {
    const detail = makeDetail()
    detail.items = [{
      id: 9, invoice_id: 1, container_id: 1, container_number: 'TCLU1234567', container_type: '40HC',
      discharge_date: '2026-09-01', return_date: '2026-09-30', total_days: 30, free_days: 21,
      days_p1: 5, rate_p1_usd: 50, days_p2: 4, rate_p2_usd: 75.5, subtotal_usd: 552, subtotal_brl: null, created_at: '2026-09-20',
    }] as PortalDemurrageInvoiceDetail['items']
    renderModal(detail)
    expect(screen.getByRole('columnheader', { name: '1º período' })).toBeTruthy()
    expect(screen.getByText('5 × US$ 50,00')).toBeTruthy()
    expect(screen.getByText('4 × US$ 75,50')).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Dias cobrados' })).toBeNull()
  })

  it('oferece "Abrir disputa" como botão no fim do detalhe enquanto a fatura está em aberto', () => {
    const handlers = renderModal(makeDetail())
    expect(screen.getByText('se discordar de algum valor')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir disputa' }))
    expect(handlers.onDispute).toHaveBeenCalledWith(1, 'DEM-001')
  })

  it('com disputa aberta, mostra o bloco Disputa e leva à conversa', () => {
    const dispute = { id: 9, demurrage_invoice_id: 1, doc_number: 'DEM-001', state: 'aberta', next_responder: 'equipamentos', subject: null, created_at: '2026-09-22T10:00:00Z', updated_at: '2026-09-22T10:00:00Z', messages: [] } as PortalDispute
    const handlers = renderModal(makeDetail({ dispute_open: true }), { dispute })
    expect(screen.getByText('Em disputa')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Abrir disputa' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Disputa' })).toBeTruthy()
    expect(screen.getByText('aberta em 22/09/2026 · aguarda a equipe de Containers')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ver conversa' }))
    expect(handlers.onShowDispute).toHaveBeenCalled()
  })

  it('Invoice complementar diz qual Invoice completa e abre a primeira', () => {
    const detail = makeDetail()
    detail.items = [{ id: 9, container_number: 'TGHU8120032', container_type: '40HC', total_days: 45, free_days: 21, days_p1: 9, rate_p1_usd: 60, days_p2: 15, rate_p2_usd: 80, subtotal_usd: 1740 }] as PortalDemurrageInvoiceDetail['items']
    const handlers = renderModal(detail, { complementOf: [{ id: 7, doc_number: 'DEM-000' }] })
    expect(screen.getByRole('heading', { name: 'Invoice complementar' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Complementa a DEM-000' })).toBeTruthy()
    expect(screen.getByText(/cobra o contêiner TGHU8120032, que entrou no B\/L depois da primeira Invoice\. A DEM-000 continua valendo/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir DEM-000' }))
    expect(handlers.onOpenInvoice).toHaveBeenCalledWith(7)
  })

  it('fatura paga: ✓ Paga com valor, dia e US$ × ROE, restituições e recibo, sem disputa nem Pix guardado', () => {
    const detail = makeDetail({ status: 'paid', paid_at: '2026-10-11', pix_payload: '00020126PIXANTIGO' })
    detail.refund_summary = {
      received_brl: 575.1,
      refunds: [
        { id: 1, amount_brl: 150, status: 'settled', purpose: 'correction', settled_at: '2026-10-14T12:00:00Z', notes: null, bank_reference: null, beneficiary: null },
        { id: 2, amount_brl: 20, status: 'pending', purpose: 'correction', settled_at: null, notes: null, bank_reference: null, beneficiary: null },
      ],
    }
    renderModal(detail)
    expect(screen.queryByText('Pagamento via PIX')).toBeNull()
    expect(screen.queryByRole('button', { name: /Copiar código Pix/ })).toBeNull()
    expect(screen.getByText('Paga')).toBeTruthy()
    expect(screen.getByText('R$ 575,10 em 11/10/2026 · US$ 100,00 × R$ 5,7510')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Abrir disputa' })).toBeNull()
    expect(screen.getByText('ROE aplicado')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Restituições' })).toBeTruthy()
    expect(screen.getByText('R$ 150,00')).toBeTruthy()
    expect(screen.getByText('Devolvida')).toBeTruthy()
    expect(screen.getByText('A devolver')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Imprimir recibo/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Imprimir Invoice/ })).toBeNull()
  })
})
