// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { InvoiceDocument, type DemurrageInvoiceDocumentDetail } from '../InvoiceDocument'

const detail: DemurrageInvoiceDocumentDetail = {
  doc_number: 'DEM-2026-0001',
  bl_id: 'BL-9',
  current_roe: 5,
  current_total_brl: 500,
  discount_value: 0,
  discount_mode: null,
  discount_type: null,
  due_date: '2026-07-01',
  paid_at: '2026-06-25',
  pix_payload: '00020101021226880014br.gov.bcb.pix',
  total_usd: 100,
  items: [{
    id: 1, container_number: 'TCLU1234567', container_type: '40GP',
    days_p1: 5, rate_p1_usd: 20, days_p2: 0, rate_p2_usd: 30,
    discharge_date: '2026-06-01', return_date: '2026-06-20', subtotal_usd: 100,
  }],
  customer: { name: 'Cliente Demurrage', cnpj_cpf: '11222333000181' },
  bl: { pol: 'CNSHA', pod: 'BRVIX', voyage: { voyage_number: '14N', vessel: { name: 'GREEN' } } },
}

afterEach(cleanup)

it('identifica simulação e suprime payload legado mesmo se vier no detalhe', () => {
  render(<InvoiceDocument detail={{ ...detail, pix_integration_state: 'simulation:cancel_pending' }} type="invoice" />)
  expect(screen.getByTestId('pix-simulation-notice').textContent).toContain('Cancelamento aguardando confirmação')
  expect(screen.queryByText(detail.pix_payload!)).toBeNull()
  expect(screen.queryByLabelText('QR Code Pix')).toBeNull()
})

it('US-048: imprime a fatura de demurrage com numero, BL e cliente', () => {
  render(<InvoiceDocument detail={detail} type="invoice" />)

  expect(screen.getByText('FATURA DE SOBREESTADIA DE CONTAINER')).toBeTruthy()
  expect(screen.getByText('BL-9')).toBeTruthy()
  expect(screen.getByText(/Cliente Demurrage/)).toBeTruthy()
  expect(screen.getAllByText('TCLU1234567').length).toBeGreaterThan(0)
})

it('US-048: imprime o recibo de quitacao quando type=receipt', () => {
  render(<InvoiceDocument detail={detail} type="receipt" />)
  expect(screen.getByText('RECIBO DE SOBREESTADIA DE CONTAINER')).toBeTruthy()
  expect(screen.getByText(/PAGO EM:/)).toBeTruthy()
  expect(screen.getByText(/PAGO EM: 25\/06\/2026/)).toBeTruthy()
})

it('US-048: exibe QR Pix e codigo copia e cola na fatura', () => {
  render(<InvoiceDocument detail={detail} type="invoice" />)

  expect(screen.getByText('PAGAMENTO VIA PIX')).toBeTruthy()
  expect(screen.getByText(detail.pix_payload!)).toBeTruthy()
  expect(screen.getByRole('img', { name: /qr code/i })).toBeTruthy()
})

it('F1: imprime o valor BRL persistido da linha, sem reconverter o USD pelo ROE atual', () => {
  const detailWithPersistedLine = {
    ...detail,
    current_roe: 5,
    current_total_brl: 500,
    items: [{ ...detail.items[0], subtotal_brl: 498 }],
  } satisfies DemurrageInvoiceDocumentDetail

  render(<InvoiceDocument detail={detailWithPersistedLine} type="invoice" />)

  const line = screen.getAllByText('TCLU1234567').at(-1)?.closest('tr')
  expect(line?.textContent).toContain('R$ 498,00')
  expect(line?.textContent).not.toContain('R$ 500,00')
})
