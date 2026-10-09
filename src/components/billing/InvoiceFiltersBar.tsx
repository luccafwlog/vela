import { useState } from 'react'
import { FilterBar } from '../ui/FilterBar'
import { formatCnpjCpf } from '../../lib/utils'
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
  /** Escolha de Cliente grava o id e o nome (para reabrir o campo preenchido). */
  onSelectCustomer: (customerId: string, customerName: string) => void
  updateFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void
}

/**
 * O Combobox lê `initialValue` só na montagem. Com o filtro na URL, voltar ou
 * avançar no navegador muda o valor sem passar pelo campo; quando o valor da
 * URL deixa de bater com o que o campo enviou, a revisão muda e o campo remonta
 * com o texto certo. Digitação própria não remonta (perderia o foco).
 */
function useUrlFieldRevision(value: string) {
  const [sent, setSent] = useState(value)
  const [previous, setPrevious] = useState(value)
  const [revision, setRevision] = useState(0)
  if (value !== previous) {
    setPrevious(value)
    if (value.trim() !== sent.trim()) {
      setSent(value)
      setRevision((current) => current + 1)
    }
  }
  return { revision, track: setSent }
}

export function InvoiceFiltersBar({
  filters,
  filterResetKey,
  customerInitialValue = '',
  activeFilterCount,
  onClear,
  onSelectCustomer,
  updateFilter,
}: InvoiceFiltersBarProps) {
  const bl = useUrlFieldRevision(filters.blSearch)
  const invoice = useUrlFieldRevision(filters.search)
  const voyage = useUrlFieldRevision(filters.voyageSearch)
  const pod = useUrlFieldRevision(filters.pod)
  return (
    <FilterBar activeCount={activeFilterCount} onClear={onClear}>
      <div className="app-filter-grid">
        <Combobox
          key={`bl-${filterResetKey}-${bl.revision}`}
          label="B/L"
          placeholder="Número do B/L"
          initialValue={filters.blSearch}
          onInputChange={bl.track}
          onValueChange={(value) => updateFilter('blSearch', value)}
          fetchOptions={async (q) => (await listBlSuggestions(q)).map((id): ComboOption => ({ value: id, label: id }))}
          onSelectOption={(option) => { bl.track(option.value); updateFilter('blSearch', option.value) }}
        />
        <Combobox
          key={`inv-${filterResetKey}-${invoice.revision}`}
          label="Fatura"
          placeholder="Número da fatura"
          initialValue={filters.search}
          onInputChange={invoice.track}
          onValueChange={(value) => updateFilter('search', value)}
          fetchOptions={async (q) => (await listInvoiceNumberSuggestions(q)).map((n): ComboOption => ({ value: n, label: n }))}
          onSelectOption={(option) => { invoice.track(option.value); updateFilter('search', option.value) }}
        />
        <Combobox
          key={`cli-${filterResetKey}-${customerInitialValue}`}
          label="Cliente"
          placeholder="Nome ou CNPJ"
          initialValue={customerInitialValue}
          onValueChange={(value) => { if (!value.trim()) updateFilter('customerId', '') }}
          fetchOptions={async (q) =>
            (await listBillingCustomers(q)).map((c): ComboOption => ({ value: String(c.id), label: c.name, meta: formatCnpjCpf(c.cnpj_cpf) }))
          }
          onSelectOption={(option) => onSelectCustomer(option.value, option.label)}
        />
        <Combobox
          key={`voy-${filterResetKey}-${voyage.revision}`}
          label="Navio / Viagem"
          initialValue={filters.voyageSearch}
          onInputChange={voyage.track}
          onValueChange={(value) => updateFilter('voyageSearch', value)}
          fetchOptions={async (q) => (await listVoyageSuggestions(q)).map((v): ComboOption => ({ value: v.voyageNumber, label: v.label }))}
          onSelectOption={(option) => { voyage.track(option.value); updateFilter('voyageSearch', option.value) }}
        />
        <Combobox
          key={`pod-${filterResetKey}-${pod.revision}`}
          label="POD"
          initialValue={filters.pod}
          onInputChange={pod.track}
          onValueChange={(value) => updateFilter('pod', value)}
          fetchOptions={async (q) => (await listPodSuggestions(q)).map((p): ComboOption => ({ value: p, label: p }))}
          onSelectOption={(option) => { pod.track(option.value); updateFilter('pod', option.value) }}
        />
        <Field label="Tipo"><Select value={filters.invoiceType} onChange={(event) => updateFilter('invoiceType', event.target.value as InvoiceTypeFilter)}><option value="">Todos</option><option value="single">Única BL</option><option value="consolidated">Consolidada</option><option value="manual">Avulsa</option></Select></Field>
        <Field label="Situação"><Select value={filters.status} onChange={(event) => updateFilter('status', event.target.value as InvoiceStatusFilter)}><option value="">Todos</option>{INVOICE_STATUS_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field>
        <Field label="Itens por página"><Select value={filters.pageSize} onChange={(event) => updateFilter('pageSize', Number(event.target.value))}>{pageSizes.map((size) => <option key={size} value={size}>{size}/pág.</option>)}</Select></Field>
        <Field label="Emissão de"><Input type="date" value={filters.dateFrom} onChange={(event) => updateFilter('dateFrom', event.target.value)} /></Field>
        <Field label="Emissão até"><Input type="date" value={filters.dateTo} onChange={(event) => updateFilter('dateTo', event.target.value)} /></Field>
        <Field label="Pagamento de"><Input type="date" value={filters.paidFrom} onChange={(event) => updateFilter('paidFrom', event.target.value)} /></Field>
        <Field label="Pagamento até"><Input type="date" value={filters.paidTo} onChange={(event) => updateFilter('paidTo', event.target.value)} /></Field>
      </div>
    </FilterBar>
  )
}
