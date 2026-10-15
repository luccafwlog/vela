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
    free_days: 14, days_p1: 5, rate_p1_usd: 20, days_p2: 0, rate_p2_usd: 30,
    discharge_date: '2026-06-01', return_date: '2026-06-20', subtotal_usd: 100,
  }],
  customer: { name: 'Cliente Demurrage', cnpj_cpf: '11222333000181' },
  bl: { pol: 'CNSHA', pod: 'BRVIX', voyage: { voyage_number: '14N', vessel: { name: 'GREEN' } } },
}

afterEach(cleanup)

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

it('US-048: exibe QR Pix e codigo copia e cola na fatura em aberto', () => {
  render(<InvoiceDocument detail={{ ...detail, paid_at: null, status: 'issued' }} type="invoice" />)

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

it('QR em preparação só para fatura emitida ou vencida sem cobrança; rascunho e cancelada não', () => {
  const open = { ...detail, paid_at: null, pix_payload: null }
  render(<InvoiceDocument detail={{ ...open, status: 'issued' }} type="invoice" />)
  expect(screen.getByTestId('pix-preparing')).toBeTruthy()
  cleanup()
  for (const status of ['draft', 'cancelled']) {
    render(<InvoiceDocument detail={{ ...open, status }} type="invoice" />)
    expect(screen.queryByTestId('pix-preparing')).toBeNull()
    cleanup()
  }
})

// Regressão (etapa 13): a Invoice paga ou cancelada aberta como fatura mostrava
// o QR e o "Valor da fatura", convidando a pagar de novo.
it('fatura paga ou cancelada não oferece Pix', () => {
  for (const closed of [{ ...detail, status: 'paid' }, { ...detail, paid_at: null, status: 'cancelled' }]) {
    render(<InvoiceDocument detail={closed} type="invoice" />)
    expect(screen.queryByText('PAGAMENTO VIA PIX')).toBeNull()
    expect(screen.queryByText(detail.pix_payload!)).toBeNull()
    expect(screen.queryByTestId('pix-preparing')).toBeNull()
    cleanup()
  }
})

it('Invoice complementar diz qual Invoice completa e que não cobra de novo as caixas já cobradas', () => {
  render(<InvoiceDocument detail={{ ...detail, complement_of: ['DEM-2026-0000'] }} type="invoice" />)
  const notice = screen.getByTestId('demurrage-complement-notice').textContent ?? ''
  expect(notice).toContain('Invoice complementar de DEM-2026-0000')
  expect(notice).toContain('os containers já cobrados não entram de novo')
  cleanup()
  render(<InvoiceDocument detail={detail} type="invoice" />)
  expect(screen.queryByTestId('demurrage-complement-notice')).toBeNull()
})

it('cabeçalho da tabela não repete chave React (USD/Dia aparece duas vezes)', () => {
  const errors: unknown[] = []
  const original = console.error
  console.error = (...args: unknown[]) => { errors.push(args) }
  try {
    render(<InvoiceDocument detail={detail} type="invoice" />)
  } finally {
    console.error = original
  }
  expect(errors).toEqual([])
})

it('B30: o recibo impresso mostra o free time de cada container', () => {
  render(<InvoiceDocument detail={detail} type="receipt" />)
  expect(screen.getByRole('columnheader', { name: 'FREE TIME' })).toBeTruthy()
  expect(screen.getByRole('cell', { name: '14' })).toBeTruthy()
})
