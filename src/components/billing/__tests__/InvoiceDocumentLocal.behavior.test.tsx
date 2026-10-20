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
  // Coberta: o dinheiro entrou na consolidada; não é "Valor recebido" nesta fatura.
  expect(screen.queryByText('Valor recebido:')).toBeNull()
  expect(screen.getByText('Recebido pela consolidada CON-21 (atribuído a estes B/Ls):')).toBeTruthy()
  expect(screen.getByText('Valor líquido atribuído a estes B/Ls:')).toBeTruthy()
  expect(screen.getByText('R$ 550,00')).toBeTruthy()
  expect(screen.getByText(/Quitação pela fatura consolidada CON-21/)).toBeTruthy()
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

it('lote 6b: B/L Misto lista todas as taxas logo abaixo da linha do B/L, sem divisão por tipo de carga', () => {
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

  expect(screen.getByText(/CSNU1234567 \(40'HC\), COSU9876543 \(20'DC\)/)).toBeTruthy()
  expect(screen.getByText(/Peso BB: 15,400 ton \| 4 packages/)).toBeTruthy()

  for (const gone of [/CARGA CONTEINERIZADA/, /CARGA SOLTA \(BREAKBULK\)/, /TAXAS ADMINISTRATIVAS/, /Subtotal Contêineres/, /Subtotal Carga Solta/, /Subtotal Taxas Documentais/]) {
    expect(screen.queryByText(gone)).toBeNull()
  }
  const blRow = screen.getByText(/B\/L COSU1234567890 — MISTO/).closest('tr')!
  const rows = [...blRow.parentElement!.querySelectorAll('tr')]
  const after = rows.slice(rows.indexOf(blRow) + 1, rows.indexOf(blRow) + 5).map((row) => row.textContent ?? '')
  expect(after[0]).toContain("THD Standard - 40'HC")
  expect(after[2]).toContain('Movimentação Portuária Carga Solta')
  expect(after[3]).toContain('Taxa de Expedição de B/L')
  // Quantidade fracionária com vírgula decimal.
  expect(screen.getByText('15,4')).toBeTruthy()
  expect(screen.getByTestId('invoice-totals').textContent).toContain('R$ 3.682,00')
})

it('lote 6b: consolidada mantém o subtotal por B/L e o TOTAL vai em caixa fora da tabela', () => {
  const consolidated = {
    invoice: { id: 110, invoice_number: 'INV-110', status: 'issued', total_brl: 1600, customer_name: 'Cliente', issued_at: '2026-09-17' },
    bls: [{ bl_id: 'BL-A', pol: 'CNSHA', pod: 'BRVIX' }, { bl_id: 'BL-B', pol: 'CNSHA', pod: 'BRVIX' }],
    items: [
      { id: 1, bl_id: 'BL-A', description: 'THD', quantity: 1, unit_value_brl: 1150, total_value_brl: 1150 },
      { id: 2, bl_id: 'BL-B', description: 'BL Fee', quantity: 1, unit_value_brl: 450, total_value_brl: 450 },
    ],
    payments: [],
  } as never
  render(<InvoiceDocumentLocal detail={consolidated} />)
  expect(screen.getByText('Subtotal BL-A:')).toBeTruthy()
  expect(screen.getByText('Subtotal BL-B:')).toBeTruthy()
  expect(screen.queryByText(/CARGA CONTEINERIZADA|TAXAS ADMINISTRATIVAS/)).toBeNull()
  const totals = screen.getByTestId('invoice-totals')
  expect(totals.closest('table')).toBeNull()
  expect(totals.textContent).toContain('TOTAL:R$ 1.600,00')
  expect(screen.getByText('Navio / Viagem:')).toBeTruthy()
})

it('lote 6b: consolidada agrupa cada B/L num tbody indivisível e o quadro do topo traz só quantidades', () => {
  const consolidated = {
    invoice: { id: 111, invoice_number: 'INV-111', status: 'issued', total_brl: 300, customer_name: 'Cliente', issued_at: '2026-09-17' },
    bls: [
      { bl_id: 'BL-A', containers: [{ container_number: 'MSCU1234567', type: '40HC' }, { container_number: 'MSCU7654321', type: '20DC' }] },
      { bl_id: 'BL-B', containers: ['TGHU0000001', 'MSCU1234567'] },
      { bl_id: 'BL-C' },
    ],
    items: [
      { id: 1, bl_id: 'BL-A', description: 'THC', quantity: 1, unit_value_brl: 100, total_value_brl: 100 },
      { id: 2, bl_id: 'BL-B', description: 'THC', quantity: 1, unit_value_brl: 100, total_value_brl: 100 },
      { id: 3, bl_id: 'BL-C', description: 'BL Fee', quantity: 1, unit_value_brl: 100, total_value_brl: 100 },
    ],
    payments: [],
  } as never
  render(<InvoiceDocumentLocal detail={consolidated} />)
  expect(screen.getByText('Qtd. de B/Ls:')).toBeTruthy()
  expect(screen.getByTestId('invoice-bl-summary').textContent).toBe('3')
  // Contêiner repetido em dois B/Ls conta uma vez; a lista não sai no topo.
  expect(screen.getByTestId('invoice-container-summary').textContent).toBe('3')
  expect(screen.queryByText(/MSCU1234567/)).toBeNull()

  const groups = screen.getAllByTestId('invoice-bl-group')
  expect(groups.map((group) => group.tagName)).toEqual(['TBODY', 'TBODY', 'TBODY'])
  expect(groups.every((group) => group.style.breakInside === 'avoid')).toBe(true)
  expect(groups[1].textContent).toContain('B/L BL-B')
  expect(groups[1].textContent).toContain('Subtotal BL-B:')
  expect(groups[1].textContent).not.toContain('BL-A')
})

it('imprime fatura avulsa com título FATURA, descrição e contexto opcional sem categorias artificiais', () => {
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

  expect(screen.getByText('FATURA')).toBeTruthy()
  expect(screen.queryByText('FATURA AVULSA')).toBeNull()
  expect(screen.getByText('Descrição complementar da cobrança')).toBeTruthy()
  expect(screen.getByText('Serviço extraordinário')).toBeTruthy()
  expect(screen.getByText(/Navio Manual.*42N/)).toBeTruthy()
  expect(screen.queryByText(/1\. CARGA CONTEINERIZADA/)).toBeNull()
  expect(screen.queryByText(/2\. CARGA SOLTA/)).toBeNull()
  expect(screen.queryByText(/3\. TAXAS ADMINISTRATIVAS/)).toBeNull()
})

it('InvoiceDocumentLocal omite Navio / Viagem quando fatura avulsa não tem navio nem viagem', () => {
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

  expect(screen.getByText('FATURA')).toBeTruthy()
  expect(screen.queryByText('FATURA AVULSA')).toBeNull()
  expect(screen.getByText('Consultoria e honorários')).toBeTruthy()
  expect(screen.queryByText('Navio / Viagem:')).toBeNull()
  expect(screen.queryByText('B/Ls:')).toBeNull()
})


it('mantém total documental e apresenta saldo corrigido no bloco Pix', () => {
  const issued = { ...detail as object, invoice: { ...(detail as {invoice:object}).invoice, status: 'partially_paid', balance_brl: 40 } } as never
  render(<InvoiceDocumentLocal detail={issued} />)
  expect(screen.getByTestId('invoice-totals').textContent).toContain('100,00')
  expect(screen.getByTestId('invoice-pix-box').textContent).toContain('Saldo a pagar:')
  expect(screen.getByTestId('invoice-pix-box').textContent).toContain('40,00')
  expect(screen.getByTestId('invoice-pix-box').textContent).toContain('a baixa da fatura pode levar de 1 a 5 minutos')
})

it('lote 6b: Pix sem "Saldo a pagar" quando o saldo é o próprio total; código em 12px', () => {
  const open = { ...detail as object, invoice: { ...(detail as {invoice:object}).invoice, status: 'issued', balance_brl: 100, total_paid_brl: 0 } } as never
  const { container } = render(<InvoiceDocumentLocal detail={open} />)
  const box = screen.getByTestId('invoice-pix-box')
  expect(box.textContent).not.toContain('Saldo a pagar')
  expect(box.textContent).toContain('Para ver a fatura como paga, atualize a página no Portal do Cliente.')
  expect(screen.getByText(pixPayload).style.fontSize).toBe('12px')
  const tiny = [...container.querySelectorAll<HTMLElement>('[style]')].filter((el) => {
    const size = parseFloat(el.style.fontSize)
    return !Number.isNaN(size) && size < 12
  })
  expect(tiny).toEqual([])
})

it('lote 6b: recibo de fatura avulsa tem título RECIBO', () => {
  const manual = { invoice: { id: 5, invoice_number: 'AV-5', invoice_type: 'manual', status: 'paid', total_brl: 10, total_paid_brl: 10, balance_brl: 0 }, bls: [], items: [], payments: [] } as never
  render(<InvoiceDocumentLocal detail={manual} type="receipt" />)
  expect(screen.getByText('RECIBO')).toBeTruthy()
})

it('não oferece QR de uma fatura paga, mesmo com payload legado', () => {
  render(<InvoiceDocumentLocal detail={detail} />)
  expect(screen.queryByTestId('invoice-pix-box')).toBeNull()
})

it('fatura pagável sem cobrança confirmada mostra QR em preparação; paga não mostra aviso', () => {
  const pending = { ...(detail as { invoice: object }), invoice: { ...(detail as { invoice: object }).invoice, status: 'issued', balance_brl: 100, total_paid_brl: 0, pix_payload: null } } as never
  render(<InvoiceDocumentLocal detail={pending} type="invoice" />)
  expect(screen.getByTestId('pix-preparing').textContent).toContain('QR Code em preparação')
  expect(screen.queryByTestId('invoice-pix-box')).toBeNull()
  cleanup()
  const paid = { ...(detail as { invoice: object }), invoice: { ...(detail as { invoice: object }).invoice, pix_payload: null } } as never
  render(<InvoiceDocumentLocal detail={paid} type="invoice" />)
  expect(screen.queryByTestId('pix-preparing')).toBeNull()
})

it('não imprime a nota interna da emissão pelo CE e imprime o endereço congelado', () => {
  const ceIssued = { ...(detail as { invoice: object }), invoice: { ...(detail as { invoice: object }).invoice, status: 'issued', balance_brl: 100, total_paid_brl: 0,
    customer_address: 'Rua da Emissão, 10, Vitória - ES', notes: 'Sistema — CE Mercante: fatura automática após o registro do CE.' } } as never
  render(<InvoiceDocumentLocal detail={ceIssued} />)
  expect(screen.getByText(/Rua da Emissão, 10, Vitória - ES/)).toBeTruthy()
  expect(screen.queryByText(/Sistema — CE Mercante/)).toBeNull()
})

it('valores em R$ não quebram em duas linhas', () => {
  render(<InvoiceDocumentLocal detail={detail} />)
  const line = screen.getByText('Taxa manual').closest('tr') as HTMLElement
  const cells = [...line.querySelectorAll('td')] as HTMLElement[]
  expect(cells.at(-1)?.style.whiteSpace).toBe('nowrap')
  expect(cells.at(-2)?.style.whiteSpace).toBe('nowrap')
})
