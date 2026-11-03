// @vitest-environment jsdom
// Filtro Status das abas de Faturas do Portal: a aba Demurrage não oferece
// Cancelada (a Invoice cancelada não chega ao Portal); Taxas Locais continua
// com ela (decisão do dono de 2026-11-03).
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DemurrageTab, LocalFeesTab } from '../PortalBillingTabs'
import { EMPTY_PORTAL_BILLING_FILTERS, portalBillingFiltersFromSearch } from '../../../lib/portalBillingFilters'

afterEach(cleanup)

const common = {
  invoices: [], totalCount: 0, page: 0, onPageChange: vi.fn(), loading: false, error: false,
  filters: EMPTY_PORTAL_BILLING_FILTERS, onFilters: vi.fn(), vesselOptions: [], pods: [],
  onOpenDetail: vi.fn(), onPayPix: vi.fn(), onExport: vi.fn(), exporting: false,
}

function statusOptions() {
  fireEvent.click(screen.getByRole('button', { name: /Filtros/ }))
  const select = screen.getByLabelText('Status') as HTMLSelectElement
  return Array.from(select.options).map((option) => option.textContent)
}

it('aba Demurrage: Status sem Cancelada, com Todos como padrão', () => {
  render(<DemurrageTab {...common} openDisputeCount={0} onOpenDisputes={vi.fn()} />)
  expect(statusOptions()).toEqual(['Todos', 'Emitida', 'Paga'])
})

it('aba Taxas Locais: Status continua com Cancelada', () => {
  render(<LocalFeesTab {...common} />)
  expect(statusOptions()).toEqual(['Em vigor (sem canceladas)', 'Emitida', 'Paga', 'Cancelada'])
})

it('link antigo com status=cancelled na aba Demurrage cai em Todos; em Taxas Locais filtra as canceladas', () => {
  expect(portalBillingFiltersFromSearch(new URLSearchParams('tab=demurrage&status=cancelled'))).toBeNull()
  expect(portalBillingFiltersFromSearch(new URLSearchParams('tab=demurrage&status=cancelled&bl=BL1'))).toEqual({ ...EMPTY_PORTAL_BILLING_FILTERS, bl: 'BL1' })
  expect(portalBillingFiltersFromSearch(new URLSearchParams('tab=demurrage&status=paid'))?.status).toBe('paid')
  expect(portalBillingFiltersFromSearch(new URLSearchParams('tab=local&status=cancelled'))?.status).toBe('cancelled')
  expect(portalBillingFiltersFromSearch(new URLSearchParams('status=cancelled'))?.status).toBe('cancelled')
})
