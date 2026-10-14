// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { LocalChargeLine } from '../../../services/charges/chargeOperationsService'

// A expansao passou a montar a conferencia de calculo, que le as linhas pelo
// hook. O teste controla essa fonte para exercitar a tela, nao a rede.
const chargeLinesState = { data: [] as LocalChargeLine[], isLoading: false, isError: false }
const invoicedSubtotalState = { data: null as { totalBrl: number; totalUsd: number | null } | null }
vi.mock('../../../hooks/useLocalCharges', () => ({
  useBlLocalChargeLines: () => chargeLinesState,
  useInvoicedSubtotalForBl: () => invoicedSubtotalState,
}))

import { ValidacaoOperationsTable } from '../ValidacaoOperationsTable'
import type { LocalChargeOperationalRow } from '../../../services/charges/chargeOperationsService'

afterEach(() => {
  cleanup()
  chargeLinesState.data = []
  chargeLinesState.isLoading = false
  chargeLinesState.isError = false
  invoicedSubtotalState.data = null
})

const row: LocalChargeOperationalRow = {
  id: 'BL-001',
  cargo_mode: 'container',
  pol: 'BRVIX',
  pod: 'BRSSA',
  charge_status: 'ready_for_billing',
  financial_status: 'pending',
  ce_mercante: null,
  review_status: 'reviewed',
  notes: null,
  customer_reconciliation_status: 'reconciled',
  customer_reconciliation_notes: null,
  billing_hold_reason: null,
  last_billing_run_id: null,
  charge_exemption_reason: null,
  charges_calculated_at: null,
  charges_reviewed_at: null,
  created_at: null,
  voyage: { id: 1, voyage_number: '001', vessel: { name: 'Navio' } },
  customer: { id: 1, name: 'Cliente', cnpj_cpf: null },
  totals: { total_brl: 100, total_usd: 0, line_count: 1, review_required_count: 0 },
  trail: { last_event_at: null, last_event_by: null, last_event_field: null, last_event_message: null },
}

function renderTable(overrides: Partial<React.ComponentProps<typeof ValidacaoOperationsTable>> = {}) {
  const callbacks = {
    onToggleAllRows: vi.fn(),
    onToggleRow: vi.fn(),
    onToggleExpandedRow: vi.fn(),
    onIssueSingleInvoice: vi.fn(),
  }

  render(
    <MemoryRouter>
      <ValidacaoOperationsTable
        rows={[row]}
        isLoading={false}
        hasError={false}
        selectedRowIds={[]}
        areAllRowsSelected={false}
        expandedBlId={null}
        reconciliationQueue={[]}
        {...callbacks}
        {...overrides}
      />
    </MemoryRouter>,
  )

  return callbacks
}

describe('ValidacaoOperationsTable', () => {
  it('não oferece emissão para Granito mesmo com CE e preserva o estado operacional', () => {
    renderTable({ rows: [{ ...row, id: 'GR-READY', cargo_mode: 'granito', ce_mercante: '122605051526081' }] })
    expect(screen.queryByRole('button', { name: 'Emitir' })).toBeNull()
    expect(screen.getByText('Apoio operacional')).toBeTruthy()
    cleanup()

    renderTable({ rows: [{ ...row, id: 'GR-WAIT', cargo_mode: 'granito', ce_mercante: null }] })
    expect(screen.queryByRole('button', { name: 'Emitir' })).toBeNull()
    expect(screen.getByText('Apoio operacional')).toBeTruthy()
  })

  it('delega a emissão individual com a linha selecionada', async () => {
    const user = userEvent.setup()
    // Emitir é a ação da linha quando o B/L está pronto (tudo certo, com CE).
    const { onIssueSingleInvoice } = renderTable({ rows: [{ ...row, ce_mercante: '122605051526081' }] })

    await user.click(screen.getByRole('button', { name: 'Emitir' }))

    expect(onIssueSingleInvoice).toHaveBeenCalledWith({ ...row, ce_mercante: '122605051526081' })
  })

  it('delega a seleção e a expansão do B/L', async () => {
    const user = userEvent.setup()
    const { onToggleRow, onToggleExpandedRow } = renderTable()

    await user.click(screen.getByRole('button', { name: 'Selecionar B/L BL-001' }))
    await user.click(screen.getByRole('button', { name: 'Expandir detalhes do B/L BL-001' }))

    expect(onToggleRow).toHaveBeenCalledWith('BL-001')
    expect(onToggleExpandedRow).toHaveBeenCalledWith('BL-001')
  })

  // ADR 0061 / issue #639: a Validacao exibe a conciliacao e aponta para a
  // Revisao; nao decide. Os botoes Aprovar/Rejeitar sairam daqui.
  it('não decide a conciliação: sem Aprovar/Rejeitar, aponta para a Revisão no B/L certo', () => {
    renderTable({
      rows: [{ ...row, customer_reconciliation_status: 'pending' }],
      expandedBlId: 'BL-001',
      reconciliationQueue: [{
        id: 42,
        bl_id: 'BL-001',
        customer_id: 7,
        current_customer_name: 'ACME LOGISTICA LTDA',
        cnpj_cpf: '00.000.000/0001-00',
        manifest_customer_name: 'Cliente manifesto',
        detection_type: 'document',
      }],
    })

    expect(screen.queryByRole('button', { name: 'Aprovar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Rejeitar' })).toBeNull()
    // os dados da conciliacao continuam a vista, que e o que a fila precisa mostrar
    // Cliente vinculado aparece; a ação da linha (e da faixa) leva à Revisão no B/L certo.
    expect(screen.getAllByText('Cliente').length).toBeGreaterThan(0)
    const links = screen.getAllByRole('link', { name: /Vincular na Revisão/ })
    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(link.getAttribute('href')).toBe('/revisao?bl=BL-001')
    }
    expect(screen.queryByText('Conciliação pendente')).toBeNull()
  })

  it('pronto para emitir fica na faixa verde da Situação do B/L, com Emitir', () => {
    renderTable({
      rows: [{ ...row, ce_mercante: '122605051526081' }],
      expandedBlId: 'BL-001',
    })
    expect(screen.getByText('Situação do B/L')).toBeTruthy()
    const band = screen.getByText(/^Pronto para emitir: tudo certo/)
    expect(band.closest('div')!.className).toContain('app-success-bg')
    expect(screen.getAllByRole('button', { name: 'Emitir' })).toHaveLength(2)
  })

  it('B/L sem cliente: motivo em âmbar na faixa e só Trecho, CE Mercante, Cliente e CNPJ', () => {
    renderTable({
      rows: [{ ...row, customer: null, customer_reconciliation_status: 'pending' }],
      expandedBlId: 'BL-001',
    })
    expect(screen.getByText(/^Sem cliente vinculado: /).closest('div')!.className).toContain('app-warning-bg')
    expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual(['Trecho', 'CE Mercante', 'Cliente', 'CNPJ'])
  })

  it('mostra o nome e o CNPJ do manifesto quando o B/L não tem Cliente', () => {
    renderTable({
      rows: [{ ...row, customer: null, customer_reconciliation_status: 'pending' }],
      expandedBlId: 'BL-001',
      reconciliationQueue: [{
        id: 42,
        bl_id: 'BL-001',
        customer_id: null,
        current_customer_name: null,
        cnpj_cpf: '07415554000956',
        manifest_customer_name: 'AC COMERCIAL IMPORTADORA E EXPORTADORA LTDA',
        detection_type: null,
      }],
    })

    expect(screen.getByText('07.415.554/0009-56')).toBeTruthy()
    expect(screen.getAllByText('AC COMERCIAL IMPORTADORA E EXPORTADORA LTDA').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Aprovar' })).toBeNull()
  })

  it('B/L pago não volta à fila como cálculo incompleto nem oferece Emitir', () => {
    renderTable({ rows: [{ ...row, financial_status: 'paid', totals: { ...row.totals, line_count: 0, total_brl: 0 } }] })
    expect(screen.getByText('Faturado')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Emitir' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Recalcular' })).toBeNull()
  })
})

describe('links de resolução da pendência', () => {
  it('aponta o número do B/L na tabela para a ficha do B/L', () => {
    renderTable({ rows: [row] })
    const link = screen.getByRole('link', { name: 'BL-001' })
    expect(link.getAttribute('href')).toBe('/bls/BL-001')
  })

  it('aponta o número do B/L de Granito para /granito', () => {
    renderTable({ rows: [{ ...row, id: 'GR-001', cargo_mode: 'granito' }] })
    const link = screen.getByRole('link', { name: 'GR-001' })
    expect(link.getAttribute('href')).toBe('/granito')
  })

  it('aponta o cliente não vinculado para a Revisão, no B/L certo', () => {
    renderTable({ rows: [{ ...row, customer: null, customer_reconciliation_status: 'pending' }], expandedBlId: 'BL-001' })
    const link = screen.getAllByRole('link', { name: /Vincular na Revisão/ })[0]
    expect(link.getAttribute('href')).toBe('/revisao?bl=BL-001')
  })

  it('aponta o CE Mercante para a ficha do B/L', () => {
    renderTable({ rows: [{ ...row, ce_mercante: null }], expandedBlId: 'BL-001' })
    const link = screen.getAllByRole('link', { name: /Cadastrar CE/ })[0]
    expect(link.getAttribute('href')).toBe('/bls/BL-001')
  })

  it('aponta o portal para a ficha do cliente e nomeia o bloqueio', () => {
    renderTable({
      rows: [{
        ...row,
        ce_mercante: '122605051526081',
        review_status: 'pending_review',
        notes: 'Pendencias de importacao: Acesso ao portal nao provisionado',
        customer: { id: 1, name: 'Cliente', cnpj_cpf: '11222333000144' },
      }],
      expandedBlId: 'BL-001',
    })
    expect(screen.getByText('Portal não provisionado')).toBeTruthy()
    const link = screen.getAllByRole('link', { name: /Abrir Cliente/ })[0]
    expect(link.getAttribute('href')).toBe('/clientes/11222333000144')
  })

  it('não oferece link de portal sem CNPJ do cliente para endereçar a ficha', () => {
    renderTable({
      rows: [{
        ...row,
        ce_mercante: '122605051526081',
        review_status: 'pending_review',
        notes: 'Pendencias de importacao: Acesso ao portal nao provisionado',
        customer: { id: 1, name: 'Cliente', cnpj_cpf: null },
      }],
      expandedBlId: 'BL-001',
    })
    expect(screen.getByText('Portal não provisionado')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Abrir Cliente/ })).toBeNull()
  })
})

describe('conferência de cálculo na expansão', () => {
  const chargeLine = {
    id: 1,
    bl_id: 'BL-001',
    charge_table_id: 10,
    charge_item_id: 100,
    charge_name: 'THC',
    charge_table_name: 'Taxas Locais — Salvador',
    charge_table_pod: 'BRSSA',
    application_basis: 'container_distinct_voyage',
    source: 'auto',
    status: 'calculated',
    quantity: 2,
    currency: 'BRL',
    unit_value_brl: 945,
    unit_value_usd: null,
    total_value_brl: 1890,
    total_value_usd: null,
    override_applied: false,
    calculation_key: null,
    notes: null,
    review_reason: null,
    calculated_at: null,
  } as LocalChargeLine

  // A decisao da issue #583: a expansao mostra o calculo E a tabela usada, e
  // nasce aberta — quem expande esta ali para conferir.
  it('nomeia a tabela usada, o porto de descarga e os itens do cálculo', () => {
    chargeLinesState.data = [chargeLine]
    renderTable({ expandedBlId: 'BL-001' })

    expect(screen.getByText('Conferência do cálculo')).toBeTruthy()
    expect(screen.getByText('Taxas Locais — Salvador')).toBeTruthy()
    expect(screen.getByText(/Descarga em SALVADOR/)).toBeTruthy()
    expect(screen.getByText('THC')).toBeTruthy()
    expect(screen.getByText('por container')).toBeTruthy()
  })

  it('mostra o LOCODE traduzido no trecho do B/L', () => {
    renderTable({ expandedBlId: 'BL-001' })
    expect(screen.getByText('VITORIA → SALVADOR')).toBeTruthy()
  })

  it('marca como anomalia a linha automática sem tabela vinculada', () => {
    chargeLinesState.data = [{ ...chargeLine, charge_table_id: null, charge_table_name: null, charge_table_pod: null }]
    renderTable({ expandedBlId: 'BL-001' })

    expect(screen.getByText('Sem tabela vinculada')).toBeTruthy()
    expect(screen.getByText('Anomalia')).toBeTruthy()
  })

  // O motor grava total_value_brl NULL em linhas USD: headlinear pela moeda
  // BRL faria uma linha ou grupo só em USD aparecer como "R$ 0,00".
  it('não zera o total em BRL quando o grupo é só em USD', () => {
    chargeLinesState.data = [{
      ...chargeLine,
      currency: 'USD',
      unit_value_brl: null,
      unit_value_usd: 300,
      total_value_brl: null,
      total_value_usd: 600,
    }]
    renderTable({ expandedBlId: 'BL-001' })

    expect(screen.queryByText('R$ 0,00')).toBeNull()
    expect(screen.getAllByText('US$ 600,00').length).toBeGreaterThan(0)
  })

  it('diz que as linhas compuseram a fatura quando o B/L já está faturado', () => {
    chargeLinesState.data = [chargeLine]
    renderTable({ rows: [{ ...row, financial_status: 'invoiced' }], expandedBlId: 'BL-001' })
    expect(screen.getByText('Linhas que compuseram a fatura emitida.')).toBeTruthy()
  })

  // A 261 congela o detalhamento na emissao e, na consolidacao com soma que nao
  // fecha, guarda uma linha agregada: e o caso em que a tela mostraria um total
  // diferente do cobrado sem dizer nada.
  it('avisa quando o cálculo não bate com o que a fatura registrou', () => {
    chargeLinesState.data = [chargeLine]
    invoicedSubtotalState.data = { totalBrl: 1500, totalUsd: null }
    renderTable({ rows: [{ ...row, financial_status: 'invoiced' }], expandedBlId: 'BL-001' })

    expect(screen.getByText('O total calculado não bate com o que a fatura registrou.')).toBeTruthy()
  })

  it('não avisa nada quando o cálculo bate com a fatura', () => {
    chargeLinesState.data = [chargeLine]
    invoicedSubtotalState.data = { totalBrl: 1890, totalUsd: null }
    renderTable({ rows: [{ ...row, financial_status: 'invoiced' }], expandedBlId: 'BL-001' })

    expect(screen.queryByText('O total calculado não bate com o que a fatura registrou.')).toBeNull()
  })

  it('orienta o recálculo quando não há linha nenhuma', () => {
    renderTable({ expandedBlId: 'BL-001' })
    expect(screen.getByText(/Nenhuma linha de taxa calculada/)).toBeTruthy()
  })

  // Granito entrega conferencia de quantidades e nao participa da emissao:
  // conferir tabela de cobranca ali seria inventar cobranca que nao existe.
  it('não monta a conferência para Granito', () => {
    chargeLinesState.data = [chargeLine]
    renderTable({ rows: [{ ...row, cargo_mode: 'granito' }], expandedBlId: 'BL-001' })
    expect(screen.queryByText('Conferência de cálculo')).toBeNull()
  })
})

