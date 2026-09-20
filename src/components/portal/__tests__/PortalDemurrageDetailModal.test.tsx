// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PortalDemurrageInvoiceDetail } from '../../../services/portalBilling'
import { PortalDemurrageDetailModal } from '../PortalDemurrageDetailModal'

afterEach(cleanup)

describe('PortalDemurrageDetailModal', () => {
  it('mostra o ROE aplicado sem decompor o markup em PTAX de referência', () => {
    const detail = {
      invoice: {
        id: 1,
        doc_number: 'DEM-001',
        total_usd: 100,
        current_roe: 5.751,
        current_total_brl: 575.1,
        updated_at: '2026-09-20T12:00:00Z',
        roe_source: 'bcb_live',
        status: 'issued',
        pix_payload: null,
        customer_name: 'Cliente',
        customer_cnpj_cpf: '00000000000000',
      },
      items: [],
    } as PortalDemurrageInvoiceDetail

    render(
      <PortalDemurrageDetailModal
        open
        invoiceId={1}
        detail={detail}
        loading={false}
        onClose={vi.fn()}
        onPrint={vi.fn()}
      />,
    )

    expect(screen.getByText('ROE aplicado')).toBeTruthy()
    expect(screen.getByText(/5,75/)).toBeTruthy()
    expect(screen.queryByText('PTAX ref.')).toBeNull()
  })
})
