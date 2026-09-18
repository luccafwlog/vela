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

it('imprime recibo de taxas locais sem PIX e com o mesmo conteúdo da fatura', () => {
  render(<InvoiceDocumentLocal detail={detail} type="receipt" />)

  expect(screen.getByText('RECIBO DE TAXAS LOCAIS')).toBeTruthy()
  expect(screen.getByText(/Cliente Local/)).toBeTruthy()
  expect(screen.getByText('Pago em 25/06/2026')).toBeTruthy()
  expect(screen.getByText('Taxa manual')).toBeTruthy()
  expect(screen.getByText('1/7')).toBeTruthy()
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
  expect(screen.getByText(/Peso BB: 15,400 ton \| 4 volumes/)).toBeTruthy()

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
