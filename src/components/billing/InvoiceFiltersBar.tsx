import { FilterBar } from '../ui/FilterBar'
import { Field, Input, Select } from '../ui/Input'
import { Combobox, type ComboOption } from '../ui/Combobox'
import {
  listBillingCustomers,
  listBlSuggestions,
  listInvoiceNumberSuggestions,
  listPodSuggestions,
  listVoyageSuggestions,
  type InvoiceStatusFilter,
  type InvoiceTypeFilter,
} from '../../services/billing'
import { INVOICE_STATUS_FILTER_OPTIONS } from '../../pages/faturamentoInvoiceStatus'
import type { Filters } from './invoiceFilters'

const pageSizes = [20, 50, 100]

type InvoiceFiltersBarProps = {
  filters: Filters
  filterResetKey: number
  customerInitialValue?: string
  activeFilterCount: number
  onClear: () => void
  updateFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void
}

export function InvoiceFiltersBar({
  filters,
  filterResetKey,
  customerInitialValue = '',
  activeFilterCount,
  onClear,
  updateFilter,
}: InvoiceFiltersBarProps) {
  return (
    <FilterBar activeCount={activeFilterCount} onClear={onClear}>
      <div className="app-filter-grid">
        <Combobox
          key={`bl-${filterResetKey}`}
          label="Número do BL"
          placeholder="Filtro principal"
          initialValue={filters.blSearch}
          onValueChange={(value) => updateFilter('blSearch', value)}
          fetchOptions={async (q) => (await listBlSuggestions(q)).map((id): ComboOption => ({ value: id, label: id }))}
          onSelectOption={(option) => updateFilter('blSearch', option.value)}
        />
        <Combobox
          key={`inv-${filterResetKey}`}
          label="Número da Fatura"
          initialValue={filters.search}
          onValueChange={(value) => updateFilter('search', value)}
          fetchOptions={async (q) => (await listInvoiceNumberSuggestions(q)).map((n): ComboOption => ({ value: n, label: n }))}
          onSelectOption={(option) => updateFilter('search', option.value)}
        />
        <Combobox
          key={`cli-${filterResetKey}-${customerInitialValue}`}
          label="Cliente"
          placeholder="Nome ou CNPJ"
          initialValue={customerInitialValue}
          onValueChange={(value) => { if (!value.trim()) updateFilter('customerId', '') }}
          fetchOptions={async (q) =>
            (await listBillingCustomers(q)).map((c): ComboOption => ({ value: String(c.id), label: c.name, meta: c.cnpj_cpf }))
          }
          onSelectOption={(option) => updateFilter('customerId', option.value)}
        />
        <Combobox
          key={`voy-${filterResetKey}`}
          label="Navio / Viagem"
          initialValue={filters.voyageSearch}
          onValueChange={(value) => updateFilter('voyageSearch', value)}
          fetchOptions={async (q) => (await listVoyageSuggestions(q)).map((v): ComboOption => ({ value: v.voyageNumber, label: v.label }))}
          onSelectOption={(option) => updateFilter('voyageSearch', option.value)}
        />
        <Combobox
          key={`pod-${filterResetKey}`}
          label="POD"
          initialValue={filters.pod}
          onValueChange={(value) => updateFilter('pod', value)}
          fetchOptions={async (q) => (await listPodSuggestions(q)).map((p): ComboOption => ({ value: p, label: p }))}
          onSelectOption={(option) => updateFilter('pod', option.value)}
        />
        <Field label="Tipo de Fatura"><Select value={filters.invoiceType} onChange={(event) => updateFilter('invoiceType', event.target.value as InvoiceTypeFilter)}><option value="">Todos</option><option value="single">Único BL</option><option value="consolidated">Consolidada</option><option value="manual">Avulsa</option></Select></Field>
        <Field label="Status"><Select value={filters.status} onChange={(event) => updateFilter('status', event.target.value as InvoiceStatusFilter)}><option value="">Todos</option>{INVOICE_STATUS_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field>
        <Field label="Itens por página"><Select value={filters.pageSize} onChange={(event) => updateFilter('pageSize', Number(event.target.value))}>{pageSizes.map((size) => <option key={size} value={size}>{size}/pág.</option>)}</Select></Field>
        <Field label="Emissão de"><Input type="date" value={filters.dateFrom} onChange={(event) => updateFilter('dateFrom', event.target.value)} /></Field>
        <Field label="Emissão até"><Input type="date" value={filters.dateTo} onChange={(event) => updateFilter('dateTo', event.target.value)} /></Field>
        <Field label="Pagamento de"><Input type="date" value={filters.paidFrom} onChange={(event) => updateFilter('paidFrom', event.target.value)} /></Field>
        <Field label="Pagamento até"><Input type="date" value={filters.paidTo} onChange={(event) => updateFilter('paidTo', event.target.value)} /></Field>
      </div>
    </FilterBar>
  )
}
