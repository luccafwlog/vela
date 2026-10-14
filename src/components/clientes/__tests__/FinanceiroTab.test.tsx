// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  demurrage: { data: undefined as unknown, isLoading: false, isError: false },
  receivables: { data: undefined as unknown, isLoading: false, isError: false },
  payments: { data: undefined as unknown, isLoading: false, isError: false },
  invoices: { data: { rows: [], denied: false } as unknown, isLoading: false, isError: false },
  overrides: { data: [] as unknown[], isLoading: false, isError: false },
  manual: { data: [] as unknown[], isLoading: false, isError: false },
  agreements: { data: [] as unknown[], isLoading: false, isError: false },
  isAdmin: true,
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

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: mocks.isAdmin }) }))

vi.mock('../BillingPortalReleaseCard', () => ({
  BillingPortalReleaseCard: () => null,
}))

import { FinanceiroTab } from '../FinanceiroTab'

const baseData = { id: 101, name: 'ACME', invoices: [], invoices_access_denied: false } as never

afterEach(() => {
  cleanup()
  mocks.isAdmin = true
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

  it('não oferece cadastrar nem editar acordo a quem a policy recusa', () => {
    mocks.isAdmin = false
    render(<MemoryRouter><FinanceiroTab data={baseData} /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: /Novo acordo/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Editar acordo de 28 dias' })).toBeNull()
    expect(screen.getByText('Cadastrar e editar acordos é do Administrativo.')).toBeTruthy()
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
