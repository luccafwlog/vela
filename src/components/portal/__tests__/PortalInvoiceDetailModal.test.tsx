// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
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

    expect(screen.getAllByText('Avulsa').length).toBeGreaterThan(0)
    expect(screen.getByText('Descrição complementar da cobrança')).toBeTruthy()
    expect(screen.getByText('Serviço extraordinário')).toBeTruthy()
    expect(screen.getByText(/NAVIO MANUAL.*42N/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'B/Ls' })).toBeNull()
    expect(screen.getByText('Pagamento via PIX')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Refazer consolidada/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: /Imprimir PDF/ }))
    expect(onPrint).toHaveBeenCalledTimes(1)
  })
})
