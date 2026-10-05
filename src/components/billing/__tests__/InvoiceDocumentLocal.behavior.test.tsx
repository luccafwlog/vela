// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { InvoiceDocumentLocal } from '../InvoiceDocumentLocal'

const pixPayload = '00020101021226880014br.gov.bcb.pix'
const detail = {
  invoice: {
    id: 9,
    invoice_number: 'INV-9',
    status: 'paid',
    total_brl: 100,
    total_paid_brl: 100,
    balance_brl: 0,
    customer_name: 'Cliente Local',
    customer_cnpj_cpf: '12345678000199',
    issued_at: '2026-06-23',
    pix_payload: pixPayload,
  },
  bls: [{ bl_id: 'BL-9', vessel_name: 'GREEN', voyage_number: '14N', pol: 'CNSHA', pod: 'BRVIX' }],
  items: [{ id: 31, bl_id: 'BL-9', description: 'Taxa manual', quantity: 0.142857, unit_value_brl: 100, total_value_brl: 100, snapshot_payload: { shared_quantity_label: '1/7' } }],
  payments: [{ paid_at: '2026-06-25' }],
} as never

afterEach(cleanup)

it('recibo distingue o total emitido do dinheiro efetivamente recebido após abatimento', () => {
  const adjustedDetail = {
    invoice: {
      id: 19, invoice_number: 'INV-19', status: 'paid',
      total_brl: 600, total_paid_brl: 500, balance_brl: 0,
      customer_name: 'Cliente com abatimento', issued_at: '2026-10-04',
    },
    bls: [{ bl_id: 'BL-19' }],
    items: [{ id: 39, description: 'Taxas originais', quantity: 1, unit_value_brl: 600, total_value_brl: 600 }],
    payments: [{ amount_brl: 500, paid_at: '2026-10-04' }],
  } as never
  render(<InvoiceDocumentLocal detail={adjustedDetail} type="receipt" />)
  expect(screen.getByText('RECIBO DE TAXAS LOCAIS')).toBeTruthy()
  expect(screen.getByTestId('invoice-totals').textContent).toContain('R$ 600,00')
  expect(screen.getByText('Valor recebido:')).toBeTruthy()
  expect(screen.getAllByText('R$ 500,00').length).toBeGreaterThan(0)
})

it('recibo mostra devolução confirmada, pendente e valor líquido sem confundir cobertura', () => {
  const covered = {
    invoice: { id: 20, invoice_number: 'INV-20', status: 'covered', total_brl: 600, total_paid_brl: 0, balance_brl: 0 },
    bls: [], items: [], payments: [],
    financial_summary: { gross_received_brl: 600, offset_brl: 0, refunded_brl: 50,
      pending_refund_brl: 50, net_received_brl: 550, paid_at: '2026-10-04', covered_by_invoice_number: 'CON-21' },
  } as never
  render(<InvoiceDocumentLocal detail={covered} type="receipt" />)
  expect(screen.getByText('Devolvido ao Cliente:')).toBeTruthy()
  expect(screen.getByText('Restituição pendente:')).toBeTruthy()
  expect(screen.getByText('Valor líquido recebido:')).toBeTruthy()
  expect(screen.getByText('R$ 550,00')).toBeTruthy()
  expect(screen.getByText(/CON-21/)).toBeTruthy()
  expect(screen.getByText('Pago em 04/10/2026')).toBeTruthy()
})

it('imprime recibo de taxas locais sem PIX e com o mesmo conteúdo da fatura', () => {
  render(<InvoiceDocumentLocal detail={detail} type="receipt" />)

  expect(screen.getByText('RECIBO DE TAXAS LOCAIS')).toBeTruthy()
  expect(screen.getByText(/Cliente Local/)).toBeTruthy()
  expect(screen.getByText('Pago em 25/06/2026')).toBeTruthy()
  expect(screen.getByText('Taxa manual')).toBeTruthy()
  expect(screen.getByText('1/7')).toBeTruthy()
  expect(screen.getByText('Fração do container compartilhado')).toBeTruthy()
  expect(screen.queryByText('0.142857')).toBeNull()
  expect(screen.queryByText('PAGAMENTO VIA PIX')).toBeNull()
  expect(screen.queryByText(pixPayload)).toBeNull()
})

it('renderiza fatura adaptativa para B/L Misto com três blocos e subtotais', () => {
  const mistoDetail = {
    invoice: {
      id: 101,
      invoice_number: 'INV-2026-0101',
      status: 'issued',
      total_brl: 3682,
      customer_name: 'Importadora Mista Ltda',
      customer_cnpj_cpf: '12345678000199',
      issued_at: '2026-09-17',
    },
    bls: [
      {
        bl_id: 'COSU1234567890',
        cargo_mode: 'misto',
        containers: [
          { container_number: 'CSNU1234567', type: "40'HC" },
          { container_number: 'COSU9876543', type: "20'DC" },
        ],
        bb_weight_ton: 15.4,
        bb_packages_qty: 4,
        vessel_name: 'COSCO SHIPPING',
        voyage_number: '001W',
      },
    ],
    items: [
      { id: 1, bl_id: 'COSU1234567890', description: "THD Standard - 40'HC (CSNU1234567)", quantity: 1, unit_value_brl: 1150, total_value_brl: 1150 },
      { id: 2, bl_id: 'COSU1234567890', description: "THD Standard - 20'DC (COSU9876543)", quantity: 1, unit_value_brl: 850, total_value_brl: 850 },
      { id: 3, bl_id: 'COSU1234567890', description: 'Movimentação Portuária Carga Solta', quantity: 15.4, unit_value_brl: 80, total_value_brl: 1232 },
      { id: 4, bl_id: 'COSU1234567890', description: 'Taxa de Expedição de B/L (BL Fee)', quantity: 1, unit_value_brl: 450, total_value_brl: 450 },
    ],
    payments: [],
  } as never

  render(<InvoiceDocumentLocal detail={mistoDetail} />)

  // Metadados do cabeçalho
  expect(screen.getByText(/CSNU1234567 \(40'HC\), COSU9876543 \(20'DC\)/)).toBeTruthy()
  expect(screen.getByText(/Peso BB: 15,400 ton \| 4 packages/)).toBeTruthy()

  // Bloco 1: Carga Conteinerizada
  expect(screen.getByText(/1\. CARGA CONTEINERIZADA/)).toBeTruthy()
  expect(screen.getByText(/Subtotal Contêineres:/)).toBeTruthy()
  expect(screen.getByText('R$ 2.000,00')).toBeTruthy()

  // Bloco 2: Carga Solta
  expect(screen.getByText(/2\. CARGA SOLTA \(BREAKBULK\)/)).toBeTruthy()
  expect(screen.getByText(/Subtotal Carga Solta:/)).toBeTruthy()
  expect(screen.getAllByText('R$ 1.232,00')).toHaveLength(2)

  // Bloco 3: Taxas Documentais
  expect(screen.getByText(/3\. TAXAS ADMINISTRATIVAS E DOCUMENTAIS/)).toBeTruthy()
  expect(screen.getByText(/Subtotal Taxas Documentais:/)).toBeTruthy()
  expect(screen.getAllByText('R$ 450,00')).toHaveLength(3)

  // Total geral
  expect(screen.getByText('R$ 3.682,00')).toBeTruthy()
})

it('suprime bloco de carga solta para B/L exclusivamente container', () => {
  const cntrDetail = {
    invoice: {
      id: 102,
      invoice_number: 'INV-2026-0102',
      status: 'issued',
      total_brl: 1600,
      customer_name: 'Cliente CNTR Puro',
      issued_at: '2026-09-17',
    },
    bls: [
      {
        bl_id: 'COSU1111111111',
        cargo_mode: 'container',
        containers: [{ container_number: 'CSNU1234567', type: "40'HC" }],
      },
    ],
    items: [
      { id: 11, bl_id: 'COSU1111111111', description: "THD Standard - 40'HC (CSNU1234567)", quantity: 1, unit_value_brl: 1150, total_value_brl: 1150 },
      { id: 12, bl_id: 'COSU1111111111', description: 'Taxa de Expedição de B/L (BL Fee)', quantity: 1, unit_value_brl: 450, total_value_brl: 450 },
    ],
    payments: [],
  } as never

  render(<InvoiceDocumentLocal detail={cntrDetail} />)

  expect(screen.getByText(/1\. CARGA CONTEINERIZADA/)).toBeTruthy()
  expect(screen.getByText(/Subtotal Contêineres:/)).toBeTruthy()
  expect(screen.queryByText(/2\. CARGA SOLTA/)).toBeNull()
  expect(screen.queryByText(/Subtotal Carga Solta:/)).toBeNull()
  expect(screen.getByText(/3\. TAXAS ADMINISTRATIVAS E DOCUMENTAIS/)).toBeTruthy()
})

it('suprime bloco de contêineres para B/L exclusivamente carga solta', () => {
  const bbDetail = {
    invoice: {
      id: 103,
      invoice_number: 'INV-2026-0103',
      status: 'issued',
      total_brl: 1682,
      customer_name: 'Cliente BB Puro',
      issued_at: '2026-09-17',
    },
    bls: [
      {
        bl_id: 'COSU2222222222',
        cargo_mode: 'carga_solta',
        bb_weight_ton: 15.4,
      },
    ],
    items: [
      { id: 21, bl_id: 'COSU2222222222', description: 'Movimentação Portuária Carga Solta', quantity: 15.4, unit_value_brl: 80, total_value_brl: 1232 },
      { id: 22, bl_id: 'COSU2222222222', description: 'Taxa de Expedição de B/L (BL Fee)', quantity: 1, unit_value_brl: 450, total_value_brl: 450 },
    ],
    payments: [],
  } as never

  render(<InvoiceDocumentLocal detail={bbDetail} />)

  expect(screen.queryByText(/1\. CARGA CONTEINERIZADA/)).toBeNull()
  expect(screen.queryByText(/Subtotal Contêineres:/)).toBeNull()
  expect(screen.getByText(/2\. CARGA SOLTA \(BREAKBULK\)/)).toBeTruthy()
  expect(screen.getByText(/Subtotal Carga Solta:/)).toBeTruthy()
  expect(screen.getByText(/3\. TAXAS ADMINISTRATIVAS E DOCUMENTAIS/)).toBeTruthy()
})

it('imprime fatura avulsa com descrição e contexto opcional sem categorias artificiais', () => {
  const manualDetail = {
    invoice: {
      id: 104,
      invoice_number: 'INV-2026-0104',
      invoice_type: 'manual',
      status: 'issued',
      total_brl: 75,
      customer_name: 'Cliente Avulso',
      notes: 'Descrição complementar da cobrança',
      voyage_id: 42,
      voyage_number: '42N',
      vessel_name: 'Navio Manual',
      issued_at: '2026-09-17',
    },
    bls: [],
    items: [{ id: 41, description: 'Serviço extraordinário', quantity: 1, unit_value_brl: 75, total_value_brl: 75, source: 'manual' }],
    payments: [],
  } as never

  render(<InvoiceDocumentLocal detail={manualDetail} />)

  expect(screen.getByText('FATURA AVULSA')).toBeTruthy()
  expect(screen.getByText('Descrição complementar da cobrança')).toBeTruthy()
  expect(screen.getByText('Serviço extraordinário')).toBeTruthy()
  expect(screen.getByText(/Navio Manual.*42N/)).toBeTruthy()
  expect(screen.queryByText(/1\. CARGA CONTEINERIZADA/)).toBeNull()
  expect(screen.queryByText(/2\. CARGA SOLTA/)).toBeNull()
  expect(screen.queryByText(/3\. TAXAS ADMINISTRATIVAS/)).toBeNull()
})

it('InvoiceDocumentLocal omite Navio/Voy. quando fatura avulsa não tem navio nem viagem', () => {
  const noVoyageDetail = {
    invoice: {
      id: 4,
      invoice_number: 'INV-2026-0105',
      invoice_type: 'manual',
      status: 'issued',
      total_brl: 120,
      customer_name: 'Cliente Sem Navio',
      notes: 'Consultoria e honorários',
      voyage_id: null,
      voyage_number: null,
      vessel_name: null,
      issued_at: '2026-09-18',
    },
    bls: [],
    items: [{ id: 42, description: 'Honorários técnicos', quantity: 1, unit_value_brl: 120, total_value_brl: 120, source: 'manual' }],
    payments: [],
  } as never

  render(<InvoiceDocumentLocal detail={noVoyageDetail} />)

  expect(screen.getByText('FATURA AVULSA')).toBeTruthy()
  expect(screen.getByText('Consultoria e honorários')).toBeTruthy()
  expect(screen.queryByText('Navio/Voy.:')).toBeNull()
  expect(screen.queryByText('B/Ls:')).toBeNull()
})


it('mantém total documental e apresenta saldo corrigido no bloco Pix', () => {
  const issued = { ...detail as object, invoice: { ...(detail as {invoice:object}).invoice, status: 'partially_paid', balance_brl: 40 } } as never
  render(<InvoiceDocumentLocal detail={issued} />)
  expect(screen.getByTestId('invoice-totals').textContent).toContain('100,00')
  expect(screen.getByTestId('invoice-pix-box').textContent).toContain('Saldo a pagar:')
  expect(screen.getByTestId('invoice-pix-box').textContent).toContain('40,00')
})

it('não oferece QR de uma fatura paga, mesmo com payload legado', () => {
  render(<InvoiceDocumentLocal detail={detail} />)
  expect(screen.queryByTestId('invoice-pix-box')).toBeNull()
})
