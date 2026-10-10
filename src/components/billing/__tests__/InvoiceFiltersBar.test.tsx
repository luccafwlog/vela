// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../services/billing', () => ({
  listBillingCustomers: async () => [],
  listBlSuggestions: async () => [],
  listInvoiceNumberSuggestions: async () => [],
  listPodSuggestions: async () => [],
  listVoyageSuggestions: async () => [],
}))

import { InvoiceFiltersBar } from '../InvoiceFiltersBar'
import type { Filters } from '../invoiceFilters'

const base: Filters = { search: '', customerId: '', status: '', invoiceType: '', blSearch: '', voyageSearch: '', pod: '', dateFrom: '', dateTo: '', paidFrom: '', paidTo: '', page: 1, pageSize: 20 }

afterEach(() => { cleanup(); vi.useRealTimers() })

function bar(filters: Filters, updateFilter = vi.fn()) {
  return <InvoiceFiltersBar filters={filters} filterResetKey={0} activeFilterCount={1} onClear={vi.fn()} onSelectCustomer={vi.fn()} updateFilter={updateFilter} />
}

describe('InvoiceFiltersBar com o filtro na URL', () => {
  it('voltar no navegador troca o texto do B/L junto com o filtro', () => {
    const { rerender } = render(bar({ ...base, blSearch: 'BL-B' }))
    expect((screen.getByRole('combobox', { name: 'B/L' }) as HTMLInputElement).value).toBe('BL-B')

    rerender(bar({ ...base, blSearch: 'BL-A' }))

    expect((screen.getByRole('combobox', { name: 'B/L' }) as HTMLInputElement).value).toBe('BL-A')
  })

  it('a própria digitação, ao chegar na URL, não remonta o campo', async () => {
    vi.useFakeTimers()
    const updateFilter = vi.fn()
    const { rerender } = render(bar(base, updateFilter))
    const input = screen.getByRole('combobox', { name: 'B/L' })
    input.focus()
    fireEvent.change(input, { target: { value: 'BL-9 ' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(updateFilter).toHaveBeenCalledWith('blSearch', 'BL-9 ')

    rerender(bar({ ...base, blSearch: 'BL-9' }, updateFilter))

    expect(screen.getByRole('combobox', { name: 'B/L' })).toBe(input)
    expect(document.activeElement).toBe(input)
  })
})
