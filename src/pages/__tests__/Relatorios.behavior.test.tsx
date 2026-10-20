// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { queryState } = vi.hoisted(() => ({
  queryState: {} as Record<string, { data?: unknown; error?: unknown }>,
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const state = queryState[String(queryKey[0])] ?? {}
    return {
      data: state.data,
      error: state.error ?? null,
      isLoading: false,
      refetch: vi.fn(),
    }
  },
}))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../services/supabase', () => ({ supabase: { from: vi.fn() } }))

import { Relatorios } from '../Relatorios'

const FULL_LOAD = { loaded: 1, total: 1 }

function operationalData(overrides: Record<string, unknown> = {}) {
  return {
    kpis: { totalBls: 5, totalContainers: 8, totalVoyages: 2, totalWeightKg: 3500, totalCbm: 50, ...overrides },
    load: FULL_LOAD,
    rows: [{
      id: 'BL-OP-1', voyage: { vessel: { name: 'NAV' }, voyage_number: 'V9' }, pol: 'CNSHA', pod: 'BRSSZ',
      customer: { name: 'Cliente Op' }, bl_containers: [], total_weight_kg: 1000, bb_weight_ton: 2.5, total_cbm: 50,
      review_status: 'reviewed', financial_status: 'paid', charge_status: 'ready_for_billing', cancelled_at: null,
    }, {
      id: 'BL-OP-2', voyage: null, pol: null, pod: null, customer: null, bl_containers: [], total_weight_kg: 10, total_cbm: 1,
      review_status: 'pending_review', financial_status: 'pending', charge_status: 'review_required', cancelled_at: null,
    }],
  }
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.search}</output>
}

function renderPage(path = '/relatorios') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Relatorios />
      <LocationProbe />
    </MemoryRouter>,
  )
}

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(queryState)) delete queryState[key]
  queryState['report-operational'] = { data: operationalData() }
  queryState['demurrage-report'] = {
    data: {
      load: { loaded: 2, total: 2 },
      kpis: { totalUsd: 100, billedBrl: 500, paidBrl: 0 },
      rows: [
        { id: 1, doc_number: 'DEM-1', bl_id: 'BL-9', status: 'issued', total_usd: 100, current_total_brl: 500, doc_date: '2026-05-10', due_date: null, customer: { name: 'Cliente Dem' } },
        { id: 2, doc_number: 'DEM-2', bl_id: 'BL-8', status: 'cancelled', total_usd: 900, current_total_brl: 4500, doc_date: '2026-05-11', due_date: null, customer: { name: 'Cliente Cancelado' } },
      ],
    },
  }
})

it('US-139: consulta operacional exibe cartões, linhas e o B/L como link', () => {
  renderPage()

  const cards = screen.getByRole('group', { name: 'Totais do recorte' })
  expect(within(cards).getByText('B/Ls')).toBeTruthy()
  expect(within(cards).getByText('Containers')).toBeTruthy()
  // Peso no cartão em toneladas; na tabela, em kg.
  expect(within(cards).getByText('Peso').nextSibling?.textContent).toBe('3,5 t')
  expect(screen.getByRole('link', { name: 'BL-OP-1' }).getAttribute('href')).toBe('/bls/BL-OP-1')
  expect(screen.getByText('Cliente Op')).toBeTruthy()
  expect(screen.getByText('3.500 kg')).toBeTruthy()
  expect(screen.getByText('CNSHA → BRSSZ')).toBeTruthy()
  expect(screen.getByText('Exportar planilha')).toBeTruthy()
  expect(screen.getByLabelText('Criação do B/L de')).toBeTruthy()
})

it('Revisão em texto e a coluna "Taxas locais" com os estados da lista de BLs', () => {
  renderPage()

  const table = screen.getByRole('table')
  expect(within(table).getByRole('columnheader', { name: 'Taxas locais' })).toBeTruthy()
  expect(within(table).queryByRole('columnheader', { name: 'Financeiro' })).toBeNull()
  const [first, second] = within(table).getAllByRole('row').slice(1)
  expect(within(first).getByText('Em ordem')).toBeTruthy()
  expect(within(first).getByText('Paga')).toBeTruthy()
  expect(within(second).getAllByText('Pendente')).toHaveLength(2)
  expect(within(second).getByText('Sem cliente vinculado')).toBeTruthy()
})

it('R1: as abas mudam pelas setas e a visão vai para o endereço', () => {
  queryState['report-financial'] = {
    data: { rows: [], load: { loaded: 0, total: 0 }, accessDenied: false, kpis: { totalInvoices: 0, totalIssued: 0, totalPaid: 0, totalOpen: 0, totalCanceled: 0 } },
  }
  renderPage()

  const operational = screen.getByRole('tab', { name: 'Operacional' })
  operational.focus()
  fireEvent.keyDown(operational, { key: 'ArrowRight' })

  expect(screen.getByRole('tab', { name: 'Financeiro' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByTestId('location').textContent).toBe('?visao=financeiro')
  expect(screen.getByLabelText('Emissão de')).toBeTruthy()
})

it('abre a visão e os filtros do endereço, e a troca de aba mantém período, viagem e Cliente', () => {
  renderPage('/relatorios?visao=demurrage&de=2026-05-01&ate=2026-05-31&cliente=7&clienteNome=ACME&situacao=paid')

  expect(screen.getByRole('tab', { name: 'Demurrage' }).getAttribute('aria-selected')).toBe('true')
  expect((screen.getByLabelText('Data do documento de') as HTMLInputElement).value).toBe('2026-05-01')
  expect(screen.getByText(/Filtros ativos: .*Cliente ACME.*Situação Pago/)).toBeTruthy()

  fireEvent.click(screen.getByRole('tab', { name: 'Operacional' }))
  expect(screen.getByTestId('location').textContent).toBe('?de=2026-05-01&ate=2026-05-31&cliente=7&clienteNome=ACME')
})

it('US-142: Demurrage lista as invoices com link e totais sem as canceladas', () => {
  renderPage('/relatorios?visao=demurrage')

  expect(screen.getByRole('link', { name: 'DEM-1' }).getAttribute('href')).toBe('/demurrage?fatura=1')
  expect(screen.getByRole('link', { name: 'BL-9' })).toBeTruthy()
  expect(screen.getByText('Cliente Dem')).toBeTruthy()
  expect(screen.getByRole('columnheader', { name: 'Total US$' })).toBeTruthy()
  expect(screen.getByText('DEM-2')).toBeTruthy()
  expect(screen.getByText('Total US$ (exceto canceladas)').nextSibling?.textContent).toContain('100,00')
  expect(screen.getByText('Faturado (R$)').nextSibling?.textContent).toContain('500,00')
  expect(screen.getByText('Recebido (R$)').nextSibling?.textContent).toContain('0,00')
})

it('R2: aviso âmbar diz quantas linhas faltam e que a planilha traz todas', () => {
  queryState['report-operational'] = { data: { ...operationalData(), load: { loaded: 10000, total: 12500 } } }
  renderPage()

  expect(screen.getByText(/A tela leu 10\.000 de 12\.500 B\/Ls; faltam 2\.500\..*A planilha traz todas\./)).toBeTruthy()
})

it('achado 4: Por Cliente avisa por fonte, sem somar B/Ls e faturas', () => {
  queryState['report-customers'] = {
    data: {
      invoicesAccessDenied: false,
      load: { bls: { loaded: 10000, total: 10400 }, invoices: { loaded: 300, total: 300 } },
      kpis: { customersWithInvoices: 0, topByBls: null, topByInvoiced: null, totalIssued: 0 },
      rows: [],
    },
  }
  renderPage('/relatorios?visao=por-cliente')

  const notice = screen.getByText(/A tela leu/)
  expect(notice.textContent).toContain('A tela leu 10.000 de 10.400 B/Ls; faltam 400.')
  expect(notice.textContent).not.toContain('faturas;')
  expect(notice.textContent).not.toContain('10.300')
})

it('achado 4: Financeiro com Saldo diz que a contagem é das faturas lidas', () => {
  queryState['report-financial'] = {
    data: {
      accessDenied: false,
      load: { loaded: 10000, total: 11000 },
      kpis: { totalInvoices: 1, totalIssued: 10, totalPaid: 0, totalOpen: 10, totalCanceled: 0 },
      rows: [{ id: 1, invoice_number: 'F-1', status: 'issued', total_brl: 10, balance_brl: 10, issued_at: '2026-05-02', customer: { name: 'C' } }],
    },
  }
  renderPage('/relatorios?visao=financeiro&saldo=aberto')

  const notice = screen.getByText(/A tela leu/)
  expect(notice.textContent).toContain('A tela leu 10.000 de 11.000 faturas; faltam 1.000.')
  expect(notice.textContent).toContain('o filtro de Saldo em aberto vale só sobre as faturas lidas')
  expect(notice.textContent).not.toMatch(/mostra/)
})

it('achado 5: Navio / Viagem e Cliente inválidos no endereço não aparecem como filtro ativo', () => {
  renderPage('/relatorios?viagem=abc&cliente=-1&clienteNome=ACME&de=2026-02-30')

  expect(screen.getByText('Sem filtros ativos')).toBeTruthy()
  expect((screen.getByLabelText('Cliente') as HTMLInputElement).value).toBe('')
  expect((screen.getByLabelText('Criação do B/L de') as HTMLInputElement).value).toBe('')
})

it('achado 3: B/L sem review_status aparece "Em ordem", como no filtro', () => {
  const data = operationalData()
  queryState['report-operational'] = { data: { ...data, rows: [{ ...data.rows[0], review_status: null }, data.rows[1]] } }
  renderPage()

  const [first] = within(screen.getByRole('table')).getAllByRole('row').slice(1)
  expect(within(first).getByText('Em ordem')).toBeTruthy()
  expect(screen.queryByText('Sem revisão')).toBeNull()
})

it('item 8: erro de consulta não aparece junto com "nenhum dado"', () => {
  queryState['report-operational'] = { error: new Error('falhou') }
  renderPage()

  expect(screen.getByRole('alert').textContent).toContain('Não foi possível carregar o relatório operacional.')
  expect(screen.queryByText('Nenhum B/L neste recorte.')).toBeNull()
})

it('Financeiro: fatura abre o registro, saldo âmbar só acima de zero e sem "INV-id"', () => {
  queryState['report-financial'] = {
    data: {
      accessDenied: false,
      load: { loaded: 2, total: 2 },
      kpis: { totalInvoices: 2, totalIssued: 300, totalPaid: 100, totalOpen: 200, totalCanceled: 0 },
      rows: [
        { id: 11, invoice_number: 'FAT-2026-0011', status: 'issued', total_brl: 200, balance_brl: 200, issued_at: '2026-05-02', customer: { name: 'Cliente Fin' } },
        { id: 12, invoice_number: 'FAT-2026-0012', status: 'paid', total_brl: 100, balance_brl: 0, issued_at: '2026-05-03', customer: { name: 'Cliente Fin' } },
        { id: 13, invoice_number: 'FAT-2026-0013', status: 'covered', total_brl: 100, balance_brl: 0, issued_at: '2026-05-03', customer: { name: 'Cliente Fin' } },
      ],
    },
  }
  renderPage('/relatorios?visao=financeiro')

  expect(screen.getByRole('link', { name: 'FAT-2026-0011' }).getAttribute('href')).toBe('/taxas-locais?invoice=11')
  const rows = screen.getAllByRole('row').slice(1)
  expect(rows[0].querySelector('.app-status-text--warning')?.textContent).toContain('200,00')
  expect(rows[1].querySelector('.app-status-text--warning')).toBeNull()
  expect(within(rows[1]).getByText('Paga')).toBeTruthy()
  // Coberta é Paga no Faturamento: mesmo tom com ✓.
  expect(within(rows[2]).getByText('Coberta').className).toBe(within(rows[1]).getByText('Paga').className)
  expect(screen.queryByText(/INV-/)).toBeNull()
})

it('R5: o aviso de acesso não cita perfil que não existe', () => {
  queryState['report-financial'] = {
    data: { accessDenied: true, rows: [], load: { loaded: 0, total: 0 }, kpis: { totalInvoices: 0, totalIssued: 0, totalPaid: 0, totalOpen: 0, totalCanceled: 0 } },
  }
  renderPage('/relatorios?visao=financeiro')

  expect(screen.getByText(/Sem permissão para ver as faturas/)).toBeTruthy()
  expect(screen.queryByText(/admin/i)).toBeNull()
})

it('Por Cliente: Cliente abre a ficha e topos vazios aparecem como ausência', () => {
  queryState['report-customers'] = {
    data: {
      invoicesAccessDenied: false,
      load: { loaded: 1, total: 1 },
      kpis: { customersWithInvoices: 0, topByBls: 'Cliente Vol', topByInvoiced: null, totalIssued: 0 },
      rows: [{ customer_id: 1, name: 'Cliente Vol', cnpj_cpf: '12345678000195', blCount: 2, totalWeightKg: 10, totalCbm: 1, invoiceCount: 0, totalIssued: 0, totalBalance: 0 }],
    },
  }
  renderPage('/relatorios?visao=por-cliente')

  expect(screen.getByRole('link', { name: 'Cliente Vol' }).getAttribute('href')).toBe('/clientes/12345678000195')
  expect(screen.getByText('Clientes com fatura no período')).toBeTruthy()
  expect(screen.getByText('Sem fatura no período')).toBeTruthy()
})
