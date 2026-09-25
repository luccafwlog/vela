import { useQuery } from '@tanstack/react-query'
import { canonicalizeDocument } from '../lib/cnpj'
import { supabase } from '../services/supabase'
import { fetchCustomerPendingBalance, fetchIssuedInvoiceBalanceByCustomer } from '../services/customers'
import { escapeFilterTerm } from '../lib/utils'
import { classifyDbError } from '../lib/errors'
import { sortCustomerRows, type CustomerSortKey, type SortDirection } from '../lib/customerTableViewModel'
import { BLS_OF_CUSTOMER, BLS_OF_CUSTOMER_INNER } from '../lib/supabaseEmbeds'
import type { Customer, CustomerDetail, CustomerListItem } from '../types/database'

export type CustomerFilters = {
  search: string
  contactEmail: string
  emailStatus: '' | 'with' | 'without'
  blStatus: '' | 'with' | 'without'
  pendingStatus: '' | 'with' | 'without'
  sortKey: CustomerSortKey
  sortDirection: SortDirection
  page: number
  pageSize: number
}

type CustomerSummary = {
  totalCustomers: number
  pendingBalance: number
  totalBls: number
  chargePending: number
  chargeReady: number
}

export function summarizeCustomerRows(rows: CustomerListItem[]): CustomerSummary {
  const bls = rows.flatMap((row) => row.bls ?? [])

  return {
    totalCustomers: rows.length,
    pendingBalance: rows.reduce((sum, row) => sum + Number(row.pending_balance ?? 0), 0),
    totalBls: bls.length,
    chargePending: bls.filter((bl) => bl.charge_status === 'review_required' || bl.charge_status === 'not_calculated').length,
    chargeReady: bls.filter((bl) => bl.charge_status === 'ready_for_billing').length,
  }
}

function customerHasEmail(row: CustomerListItem) {
  return (row.customer_contacts ?? []).some(
    (contact) => !contact.deactivated_at && String(contact.email ?? '').trim().length > 0,
  )
}

export function filterCustomerRowsByClientSideFilters(rows: CustomerListItem[], filters: CustomerFilters) {
  const contactEmail = filters.contactEmail.trim().toLowerCase()

  return rows.filter((row) => {
    const hasEmails = customerHasEmail(row)
    const hasBls = (row.bls?.length ?? 0) > 0
    const hasPendingBalance = Number(row.pending_balance ?? 0) > 0

    if (contactEmail) {
      const matchesContactEmail = (row.customer_contacts ?? []).some((contact) =>
        !contact.deactivated_at && String(contact.email ?? '').toLowerCase().includes(contactEmail),
      )
      if (!matchesContactEmail) return false
    }
    if (filters.emailStatus === 'with' && !hasEmails) return false
    if (filters.emailStatus === 'without' && hasEmails) return false
    if (filters.blStatus === 'with' && !hasBls) return false
    if (filters.blStatus === 'without' && hasBls) return false
    if (filters.pendingStatus === 'with' && !hasPendingBalance) return false
    if (filters.pendingStatus === 'without' && hasPendingBalance) return false
    return true
  })
}

/**
 * Os KPIs somam TODOS os clientes que passam pelos filtros, entao paginacao e
 * ordenacao nao mudam o resultado. Sem esta normalizacao a query key carrega
 * `page`/`sortKey`/`sortDirection` e cada clique em "proxima pagina" ou em um
 * cabecalho de coluna dispara outra varredura completa da base (mais a das
 * faturas emitidas) so para recalcular os mesmos numeros.
 */
export function customerSummaryFilters(filters: CustomerFilters): CustomerFilters {
  return {
    search: filters.search,
    contactEmail: filters.contactEmail,
    emailStatus: filters.emailStatus,
    blStatus: filters.blStatus,
    pendingStatus: filters.pendingStatus,
    sortKey: 'name',
    sortDirection: 'asc',
    page: 0,
    pageSize: 0,
  }
}

export function useCustomerSummary(filters: CustomerFilters) {
  const scope = customerSummaryFilters(filters)
  return useQuery({
    queryKey: ['customers-summary', scope],
    queryFn: async () => {
      const result = await fetchCustomerRows(scope, false)
      return summarizeCustomerRows(result.rows)
    },
    staleTime: 60_000,
  })
}

export function useCustomers(filters: CustomerFilters) {
  return useQuery({
    queryKey: ['customers', filters],
    queryFn: () => fetchCustomerRows(filters, true),
  })
}

export async function fetchCustomerRows(filters: CustomerFilters, paginate: boolean) {
  const from = filters.page * filters.pageSize
  const to = from + filters.pageSize - 1

  // Ordenacao por B/Ls e saldo depende de dados agregados/calculados no cliente,
  // entao qualquer ordenacao fora de "nome ascendente" exige varrer tudo antes de paginar.
  const needsClientSideSort = filters.sortKey !== 'name' || filters.sortDirection !== 'asc'

  const hasClientSideFilter =
    Boolean(filters.contactEmail.trim()) ||
    Boolean(filters.emailStatus) ||
    filters.blStatus === 'without' ||
    Boolean(filters.pendingStatus) ||
    needsClientSideSort

  const blsJoin =
    filters.blStatus === 'with'
      ? `${BLS_OF_CUSTOMER_INNER}(id, charge_status)`
      : `${BLS_OF_CUSTOMER}(id, charge_status)`

  let query = supabase
    .from('customers')
    .select(`*, ${blsJoin}, customer_contacts(id, email, purpose, is_primary, deactivated_at, origin, customer_contact_box_links(box_code))`, { count: 'exact' })
    .order('name', { ascending: true })

  if (filters.search) {
    const search = escapeFilterTerm(filters.search)
    const normalizedDocument = canonicalizeDocument(filters.search)
    const documentClause = /\d/.test(filters.search) && normalizedDocument ? `,cnpj_cpf.ilike.%${normalizedDocument}%` : ''
    const terms = search
      ? `name.ilike.%${search}%,trade_name.ilike.%${search}%,cnpj_cpf.ilike.%${search}%`
      : ''
    const filter = [terms, documentClause.slice(1)].filter(Boolean).join(',')
    if (filter) query = query.or(filter)
  }

  let rawRows: unknown[] = []
  let count: number | null = null
  if (paginate && !hasClientSideFilter) {
    const result = await query.range(from, to)
    if (result.error) throw result.error
    rawRows = result.data ?? []
    count = result.count
  } else {
    for (let offset = 0; ; offset += 1000) {
      const result = await query.range(offset, offset + 999)
      if (result.error) throw result.error
      const batch = result.data ?? []
      rawRows.push(...batch)
      if (batch.length < 1000) break
    }
  }

  let rows = rawRows as CustomerListItem[]
  const balances = await fetchIssuedInvoiceBalanceByCustomer(rows.map((row) => row.id))
  rows = rows.map((row) => ({ ...row, pending_balance: balances.get(row.id) ?? 0 }))
  rows = filterCustomerRowsByClientSideFilters(rows, filters)
  rows = sortCustomerRows(rows, filters.sortKey, filters.sortDirection)

  if (!paginate) {
    return {
      rows,
      count: rows.length,
      totalCount: rows.length,
    }
  }

  if (hasClientSideFilter) {
    const paginatedRows = rows.slice(from, from + filters.pageSize)
    return {
      rows: paginatedRows,
      count: paginatedRows.length,
      totalCount: rows.length,
    }
  }

  return {
    rows,
    count: rows.length,
    totalCount: count ?? 0,
  }
}

export function useCustomerDetail(cnpj?: string) {
  return useQuery({
    queryKey: ['customer-detail', cnpj],
    enabled: Boolean(cnpj),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select(
          `
          *,
          customer_contacts(*, customer_contact_box_links(box_code)),
          ${BLS_OF_CUSTOMER}(id, consignee, financial_status, review_status, created_at)
        `,
        )
        .eq('cnpj_cpf', canonicalizeDocument(cnpj))
        .single()

      if (error) throw error

      const customer = data as unknown as CustomerDetail

      // Pagina ate esgotar: o saldo pendente e um agregado exato, nao pode
      // ficar subestimado por um cliente com mais de uma pagina de invoices.
      const invoices: NonNullable<CustomerDetail['invoices']>[number][] = []
      let invoicesFrom = 0
      const INVOICES_PAGE_SIZE = 500
      while (true) {
        const { data: page, error: invoiceError } = await supabase
          .from('invoices')
          .select('id, invoice_number, issued_at, total_brl, balance_brl, status')
          .eq('customer_id', customer.id)
          .order('issued_at', { ascending: false })
          .range(invoicesFrom, invoicesFrom + INVOICES_PAGE_SIZE - 1)

        if (invoiceError) {
          if (classifyDbError(invoiceError).kind === 'permissao') {
            return {
              ...customer,
              pending_balance: 0,
              invoices: [],
              invoices_access_denied: true,
            } as CustomerDetail
          }
          throw invoiceError
        }

        invoices.push(...((page ?? []) as NonNullable<CustomerDetail['invoices']>))
        if (!page || page.length < INVOICES_PAGE_SIZE) break
        invoicesFrom += INVOICES_PAGE_SIZE
      }

      const canonicalBalance = await fetchCustomerPendingBalance(customer.id)

      return {
        ...customer,
        pending_balance: canonicalBalance.totalBrl,
        pending_balance_local: canonicalBalance.localBrl,
        pending_balance_demurrage: canonicalBalance.demurrageBrl,
        invoices: (invoices ?? []) as CustomerDetail['invoices'],
        invoices_access_denied: false,
      } as CustomerDetail
    },
  })
}


export function useCustomerLookup(search: string) {
  const filter = buildCustomerLookupFilter(search)
  return useQuery({
    queryKey: ['customer-lookup', search],
    enabled: Boolean(filter),
    queryFn: () => fetchCustomerLookup(search),
  })
}

function buildCustomerLookupFilter(search: string) {
  const term = escapeFilterTerm(search)
  const document = canonicalizeDocument(search)
  const clauses: string[] = []

  if (term.length >= 2) {
    clauses.push(`name.ilike.%${term}%`, `cnpj_cpf.ilike.%${term}%`)
  }
  if (/\d/.test(search) && document.length >= 2 && document !== term) {
    clauses.push(`cnpj_cpf.ilike.%${document}%`)
  }

  return clauses.join(',')
}

export async function fetchCustomerLookup(search: string) {
  const filter = buildCustomerLookupFilter(search)
  if (!filter) return []

  const { data, error } = await supabase
    .from('customers')
    .select('id, cnpj_cpf, name, city, state, customer_contacts(email)')
    .or(filter)
    // Cliente desativado sai das listas de escolha (ADR 0073; migration 092).
    .is('deactivated_at' as never, null as never)
    .order('name', { ascending: true })
    .range(0, 24)

  if (error) throw error
  return (data ?? []) as (Pick<Customer, 'id' | 'cnpj_cpf' | 'name' | 'city' | 'state'> & { customer_contacts?: { email: string | null }[] | null })[]
}
