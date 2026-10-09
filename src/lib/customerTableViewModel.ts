export function buildCustomerBillingUrl(customer: { id: number; name: string }) {
  return `/taxas-locais?tab=invoices&customer=${customer.id}&customerName=${encodeURIComponent(customer.name)}`
}

export function getPrimaryContactEmail(
  contacts: Array<{ id?: number; email?: string | null; is_primary?: boolean | null; purpose?: string | null }> | null | undefined,
) {
  const withEmail = (contacts ?? []).filter((contact) => String(contact.email ?? '').trim().length > 0)
  return withEmail.find((contact) => contact.is_primary)?.email ?? withEmail[0]?.email ?? null
}

export function summarizeContactsForDisplay(
  contacts: Array<{
    id?: number
    email?: string | null
    is_primary?: boolean | null
    purpose?: string | null
    deactivated_at?: string | null
    customer_contact_box_links?: Array<{ box_code: string }> | null
  }> | null | undefined,
) {
  const activeContacts = (contacts ?? []).filter((c) => !c.deactivated_at)
  const count = activeContacts.length
  const primary = activeContacts.find((contact) => contact.is_primary && String(contact.email ?? '').trim())
    ?? activeContacts.find((contact) => String(contact.email ?? '').trim())

  const boxCount = primary?.customer_contact_box_links?.length ?? null

  return {
    count,
    primaryEmail: primary?.email ?? null,
    isPrimary: Boolean(primary?.is_primary),
    boxCount,
    empty: !primary?.email,
  }
}

type CustomerFilterChipInput = {
  search: string
  contactEmail: string
  emailStatus: '' | 'with' | 'without'
  blStatus: '' | 'with' | 'without'
  pendingStatus: '' | 'with' | 'without'
}

export function getCustomerFilterChips(filters: CustomerFilterChipInput) {
  const chips: Array<{ key: keyof CustomerFilterChipInput; label: string }> = []
  if (filters.search.trim()) chips.push({ key: 'search', label: `Cliente: ${filters.search.trim()}` })
  if (filters.contactEmail.trim()) chips.push({ key: 'contactEmail', label: `E-mail: ${filters.contactEmail.trim()}` })
  if (filters.emailStatus === 'with') chips.push({ key: 'emailStatus', label: 'Com e-mails' })
  if (filters.emailStatus === 'without') chips.push({ key: 'emailStatus', label: 'Sem e-mails' })
  if (filters.blStatus === 'with') chips.push({ key: 'blStatus', label: 'Com B/Ls' })
  if (filters.blStatus === 'without') chips.push({ key: 'blStatus', label: 'Sem B/Ls' })
  if (filters.pendingStatus === 'with') chips.push({ key: 'pendingStatus', label: 'Com saldo pendente' })
  if (filters.pendingStatus === 'without') chips.push({ key: 'pendingStatus', label: 'Sem saldo pendente' })
  return chips
}

export type CustomerSortKey = 'name' | 'bls' | 'pendingBalance'
export type SortDirection = 'asc' | 'desc'

export function sortCustomerRows<T extends { name: string; pending_balance?: number | null; bls?: unknown[] | null }>(
  rows: T[],
  key: CustomerSortKey,
  direction: SortDirection,
) {
  const multiplier = direction === 'asc' ? 1 : -1
  return [...rows].sort((left, right) => {
    if (key === 'name') return left.name.localeCompare(right.name) * multiplier
    if (key === 'bls') return ((left.bls?.length ?? 0) - (right.bls?.length ?? 0)) * multiplier
    return (Number(left.pending_balance ?? 0) - Number(right.pending_balance ?? 0)) * multiplier
  })
}
