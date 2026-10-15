// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { formatUSD } from '../../../lib/utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  demurrage: { data: undefined as unknown, isLoading: false, isError: false },
  receivables: { data: undefined as unknown, isLoading: false, isError: false },
  payments: { data: undefined as unknown, isLoading: false, isError: false },
  invoices: { data: { rows: [], denied: false } as unknown, isLoading: false, isError: false },
  overrides: { data: [] as unknown[], isLoading: false, isError: false },
  manual: { data: [] as unknown[], isLoading: false, isError: false },
  agreements: { data: [] as unknown[], isLoading: false, isError: false },
  role: 'administrativo' as string | null,
}))

vi.mock('../../../hooks/useCustomerFicha', () => ({
  useCustomerDemurrageInvoices: () => mocks.demurrage,
  useCustomerReceivables: () => mocks.receivables,
  useCustomerPayments: () => mocks.payments,
  useCustomerInvoices: () => mocks.invoices,
  useCustomerRateOverrides: () => mocks.overrides,
  useCustomerManualChargeBls: () => mocks.manual,
}))

vi.mock('../../../hooks/useCustomerDemurrageAgreements', () => ({
  useCustomerDemurrageAgreements: () => mocks.agreements,
  useSaveCustomerDemurrageAgreement: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('../../../hooks/usePortalProvisioning', () => ({
  usePortalProvisioningForCustomer: () => ({ data: undefined }),
}))

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ effectiveRole: mocks.role }) }))

vi.mock('../BillingPortalReleaseCard', () => ({
  BillingPortalReleaseCard: () => null,
}))

import { FinanceiroTab } from '../FinanceiroTab'

const baseData = { id: 101, name: 'ACME', invoices: [], invoices_access_denied: false } as never

afterEach(() => {
  cleanup()
  mocks.role = 'administrativo'
  mocks.demurrage = { data: undefined, isLoading: false, isError: false }
  mocks.receivables = { data: undefined, isLoading: false, isError: false }
  mocks.payments = { data: undefined, isLoading: false, isError: false }
  mocks.invoices = { data: { rows: [], denied: false }, isLoading: false, isError: false }
})

describe('FinanceiroTab — estados de carregamento e erro', () => {
  it('mostra carregando, nao "nenhum recebivel", enquanto a query esta pendente', () => {
    mocks.receivables = { data: undefined, isLoading: true, isError: false }
    render(<MemoryRouter><FinanceiroTab data={baseData} /></MemoryRouter>)
    expect(screen.getAllByText('Carregando…').length).toBeGreaterThan(0)
    expect(screen.queryByText('Nenhuma fatura de Taxas Locais.')).toBeNull()
  })

  it('mostra erro explicito, nao "nenhuma invoice de demurrage", quando a query falha', () => {
    mocks.demurrage = { data: undefined, isLoading: false, isError: true }
    render(<MemoryRouter><FinanceiroTab data={baseData} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('radio', { name: /Demurrage/ }))
    expect(screen.getByText('Erro ao carregar dados financeiros.')).toBeTruthy()
    expect(screen.queryByText('Nenhuma invoice de demurrage.')).toBeNull()
  })

  it('exibe a lista de acordos de demurrage do cliente', () => {
    mocks.agreements = {
      data: [{
        id: 1,
        customer_id: 101,
        free_days: 28,
        p1_usd: 25,
        p2_usd: 50,
        valid_from: '2026-01-01',
        valid_to: '2026-12-31',
        active: true,
        notes: 'Acordo comercial especial',
      }],
      isLoading: false,
      isError: false,
    }
    render(<MemoryRouter><FinanceiroTab data={baseData} /></MemoryRouter>)
    expect(screen.getByText('28 dias de free time')).toBeTruthy()
    expect(screen.getByText(/Acordo comercial especial/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Novo acordo/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Editar acordo de 28 dias' })).toBeTruthy()
  })

  it('oferece cadastrar e editar acordo a qualquer Departamento (P9)', () => {
    mocks.role = 'financeiro'
    mocks.agreements = { data: [{ id: 5, customer_id: 1, free_days: 28, p1_usd: null, p2_usd: null, valid_from: '2026-01-01', valid_to: null, active: true, notes: null }], isLoading: false, isError: false }
    render(<MemoryRouter><FinanceiroTab data={baseData} /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /Novo acordo/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Editar acordo de 28 dias' })).toBeTruthy()
  })

  it('B29: Invoice de Demurrage não vence — sem coluna Vencimento nem situação Vencida', () => {
    mocks.demurrage = { data: { rows: [{ id: 78, doc_number: 'DEM-078', bl_id: 'BL-9', billed_at: '2026-07-01', due_date: '2026-07-10', status: 'overdue', total_usd: 100, current_total_brl: 550 }], denied: false }, isLoading: false, isError: false }
    render(<MemoryRouter><FinanceiroTab data={baseData} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('radio', { name: /Demurrage/ }))
    expect(screen.getByRole('link', { name: 'DEM-078' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Vencimento' })).toBeNull()
    expect(screen.queryByText('Vencida')).toBeNull()
    expect(screen.getByText('Emitida')).toBeTruthy()
  })

  it('B29/A13: a coluna Total US$ mostra o USD líquido do desconto, como /demurrage', () => {
    mocks.demurrage = { data: { rows: [{ id: 79, doc_number: 'DEM-079', bl_id: 'BL-9', billed_at: '2026-07-01', status: 'issued', total_usd: 1000, discount_mode: 'percent', discount_value: 10, current_total_brl: 4950 }], denied: false }, isLoading: false, isError: false }
    render(<MemoryRouter><FinanceiroTab data={baseData} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('radio', { name: /Demurrage/ }))
    const row = screen.getByRole('link', { name: 'DEM-079' }).closest('tr') as HTMLElement
    expect(row.textContent).toContain(formatUSD(900))
    expect(row.textContent).not.toContain(formatUSD(1000))
  })

  it('abre a Invoice de Demurrage direto no detalhe de /demurrage', () => {
    mocks.demurrage = { data: { rows: [{ id: 77, doc_number: 'DEM-077', bl_id: 'BL-9', billed_at: '2026-07-01', status: 'issued', total_usd: 100, current_total_brl: 550 }], denied: false }, isLoading: false, isError: false }
    render(<MemoryRouter><FinanceiroTab data={baseData} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('radio', { name: /Demurrage/ }))
    expect(screen.getByRole('link', { name: 'DEM-077' }).getAttribute('href')).toBe('/demurrage?fatura=77')
    expect(screen.getByRole('link', { name: /Abrir em Demurrage/ }).getAttribute('href')).toBe('/demurrage?tab=faturas&busca=ACME')
  })

  it('com CNPJ, os links de Demurrage buscam só este Cliente, não os de nome parecido', () => {
    render(<MemoryRouter><FinanceiroTab data={{ ...(baseData as object), cnpj_cpf: '12.345.678/0001-95' } as never} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('radio', { name: /Demurrage/ }))
    expect(screen.getByRole('link', { name: /Abrir em Demurrage/ }).getAttribute('href')).toBe('/demurrage?tab=faturas&busca=12345678000195')
    expect(screen.getByRole('link', { name: 'Ver em Tarifas' }).getAttribute('href')).toBe('/demurrage/taxas?tab=acordos&cliente=12345678000195')
  })

  it('uma linha por fatura, com o saldo por B/L ao abrir e a consolidada marcada pelo ícone', () => {
    mocks.invoices = { data: { rows: [{ id: 5, invoice_number: 'FAT-5', issued_at: '2026-10-01', total_brl: 300, balance_brl: 100, status: 'partially_paid', invoice_type: 'consolidated', bl_ids: ['BL-A', 'BL-B'] }], denied: false }, isLoading: false, isError: false }
    mocks.receivables = { data: { rows: [{ id: 1, bl_id: 'BL-A', original_amount_brl: 200, settled_amount_brl: 200, balance_brl: 0, status: 'settled' }, { id: 2, bl_id: 'BL-B', original_amount_brl: 100, settled_amount_brl: 0, balance_brl: 100, status: 'open' }], denied: false }, isLoading: false, isError: false }
    render(<MemoryRouter><FinanceiroTab data={baseData} /></MemoryRouter>)
    const row = screen.getByRole('link', { name: 'FAT-5' }).closest('tr')!
    expect(row.textContent).toContain('Parcialmente paga')
    expect(row.textContent).toContain('+1')
    expect(screen.getByRole('img', { name: 'Consolidada' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ver saldo por B/L' }))
    expect(screen.getByRole('table', { name: 'Saldo por B/L' }).textContent).toContain('BL-B')
  })
})
