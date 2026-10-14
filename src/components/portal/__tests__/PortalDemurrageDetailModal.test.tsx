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
    } as PortalDemurrageInvoiceDetail
}

function renderModal(detail: PortalDemurrageInvoiceDetail, extra: { dispute?: PortalDispute | null } = {}) {
  const handlers = { onDispute: vi.fn(), onShowDispute: vi.fn() }
  render(
    <PortalDemurrageDetailModal
      open
      invoiceId={1}
      detail={detail}
      loading={false}
      dispute={extra.dispute}
      onClose={vi.fn()}
      onPrint={vi.fn()}
      {...handlers}
    />,
  )
  return handlers
}

describe('PortalDemurrageDetailModal', () => {
  it('mostra o pagamento primeiro, com o ROE de hoje e o Pix em preparação', () => {
    renderModal(makeDetail())

    expect(screen.getByRole('heading', { name: 'Pagamento' })).toBeTruthy()
    expect(screen.getByText('Total a pagar hoje')).toBeTruthy()
    expect(screen.getByText('ROE de hoje')).toBeTruthy()
    expect(screen.getByText(/5,7510/)).toBeTruthy()
    expect(screen.getByText('US$ 100,00')).toBeTruthy()
    expect(screen.queryByText('PTAX ref.')).toBeNull()
    // Emitida sem cobrança confirmada: Portal avisa em vez de esconder o Pix.
    expect(screen.getByRole('status').textContent).toContain('QR Code Pix em preparação')
  })

  it('oferece a disputa no fim do detalhe enquanto a fatura está em aberto', () => {
    const handlers = renderModal(makeDetail())
    expect(screen.getByText(/Discorda de algum valor\?/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir disputa' }))
    expect(handlers.onDispute).toHaveBeenCalledWith(1, 'DEM-001')
  })

  it('com disputa aberta, mostra a data e leva às mensagens', () => {
    const dispute = { id: 9, demurrage_invoice_id: 1, doc_number: 'DEM-001', state: 'aberta', next_responder: 'equipamentos', subject: null, created_at: '2026-09-22T10:00:00Z', updated_at: '2026-09-22T10:00:00Z', messages: [] } as PortalDispute
    const handlers = renderModal(makeDetail({ dispute_open: true }), { dispute })
    expect(screen.getByText('Em disputa')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Abrir disputa' })).toBeNull()
    expect(screen.getByText(/Disputa aberta em 22\/09\/2026/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ver mensagens' }))
    expect(handlers.onShowDispute).toHaveBeenCalled()
  })

  it('fatura paga não oferece disputa nem o Pix guardado, e mostra Paga', () => {
    renderModal(makeDetail({ status: 'paid', pix_payload: '00020126PIXANTIGO' }))
    expect(screen.queryByText('Pagamento via PIX')).toBeNull()
    expect(screen.queryByRole('button', { name: /Copiar código Pix/ })).toBeNull()
    expect(screen.getByText('Paga')).toBeTruthy()
    expect(screen.queryByText(/Discorda de algum valor/)).toBeNull()
    expect(screen.getByText('ROE aplicado')).toBeTruthy()
  })
})
