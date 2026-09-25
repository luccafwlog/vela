import { canonicalizeDocument, canonicalizeValidCnpj } from '../lib/cnpj'
import { onlyDigits } from '../lib/utils'
import { supabase } from './supabase'
import type { DeleteDependencyReport } from './deleteDependencies'
import { deleteRecords } from './deleteRecords'
import type { Customer, CustomerContact } from '../types/database'

type CustomerEditableFields = Pick<
  Customer,
  'name' | 'trade_name' | 'address' | 'city' | 'state' | 'zip' | 'notes'
>

type CreateCustomerContactInput = {
  name: string
  email?: string | null
  phone?: string | null
  purpose?: string | null
  is_primary?: boolean
  box_codes?: string[]
}

export type CreateCustomerInput = {
  cnpjCpf: string
  name: string
  tradeName?: string
  address?: string
  city?: string
  state?: string
  zip?: string
  notes?: string
  contacts?: CreateCustomerContactInput[]
}

export async function createCustomer(input: CreateCustomerInput) {
  const cnpj = canonicalizeValidCnpj(input.cnpjCpf)
  if (!cnpj) throw new Error('CNPJ inválido.')
  const contacts = (input.contacts ?? []).filter(
    (contact) => contact.name.trim() || (contact.email ?? '').trim() || (contact.phone ?? '').trim(),
  )
  const { data, error } = await supabase.rpc('create_customer_with_contacts', {
    p_customer: {
      cnpj_cpf: cnpj,
      name: input.name.trim(),
      trade_name: normalizeText(input.tradeName),
      address: normalizeText(input.address),
      city: normalizeText(input.city),
      state: normalizeState(input.state),
      zip: normalizeZip(input.zip),
      notes: normalizeText(input.notes),
    },
    p_contacts: contacts.map((contact) => ({
      name: contact.name.trim(),
      email: normalizeText(contact.email),
      phone: normalizeText(contact.phone),
      purpose: contact.purpose ?? 'geral',
      is_primary: contact.is_primary ?? false,
      box_codes: contact.box_codes ?? (contact.is_primary ? ['documentacao_operacao', 'financeiro', 'demurrage'] : ['documentacao_operacao']),
    })),
  })

  if (error || !data) throw error
  return data as unknown as Customer
}

export async function updateCustomerWithAudit({
  customerId,
  original,
  values,
  changedBy,
  justification,
}: {
  customerId: number
  original: CustomerEditableFields
  values: CustomerEditableFields
  changedBy: string
  justification: string
}) {
  const changedEntries = Object.entries(values).filter(
    ([field, value]) => stringifyValue(original[field as keyof CustomerEditableFields]) !== stringifyValue(value),
  ) as Array<[keyof CustomerEditableFields, CustomerEditableFields[keyof CustomerEditableFields]]>

  if (!changedEntries.length) return false

  const payload = Object.fromEntries(changedEntries) as Partial<CustomerEditableFields>
  const { data, error } = await supabase.rpc('update_customer_with_audit', {
    p_customer_id: customerId,
    p_updates: payload,
    p_changed_by: changedBy,
    p_justification: justification,
  })

  if (error) throw error
  return data === true
}

export async function upsertCustomerContact(customerId: number, contact: Omit<CustomerContact, 'customer_id' | 'created_at'>) {
  const payload = {
    customer_id: customerId,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    purpose: contact.purpose,
    is_primary: contact.is_primary ?? false,
  }

  const query = contact.id
    ? supabase.from('customer_contacts').update(payload).eq('id', contact.id).select('*').single()
    : supabase.from('customer_contacts').insert(payload).select('*').single()

  const { data, error } = await query
  if (error || !data) throw error
  return data as CustomerContact
}

// Adiciona um e-mail de contato a um cliente existente direto da fila de
// revisao. Normaliza via ensure_customer_contact_email (lower + trim) e
// vincula a caixa documentacao_operacao, em vez de inserir direto — insercao
// direta produzia pares A@X.com / a@x.com que quebravam o indice unico e
// criava contatos sem roteamento para nenhuma caixa (Issue 609).
export async function addCustomerEmail(customerId: number, email: string) {
  const normalized = email.trim().toLowerCase()
  if (!normalized) throw new Error('Informe um e-mail válido.')
  const { error } = await supabase.rpc('ensure_customer_contact_email', {
    p_customer_id: customerId,
    p_email: normalized,
    p_contact_name: 'Contato faturamento',
    p_purpose: 'faturamento',
  } as never)
  if (error) throw error
}

export async function deleteCustomerContact(contactId: number) {
  const { error } = await supabase
    .from('customer_contacts')
    .update({ deactivated_at: new Date().toISOString(), is_primary: false } as never)
    .eq('id', contactId)
  if (error) throw error
}

/** Previa da exclusao de clientes, calculada pelo banco. */
export function checkCustomerDependencies(ids: number[]): Promise<DeleteDependencyReport<number>> {
  return deleteRecords('customer', ids, { dryRun: true })
}

/** Exclui clientes com contatos e overrides; cada um sai por inteiro ou volta com o motivo. */
export function deleteCustomers(ids: number[]): Promise<DeleteDependencyReport<number>> {
  return deleteRecords('customer', ids)
}

type CustomerPendingBalanceRow = {
  customer_id: number
  local_balance_brl: number | string | null
  demurrage_balance_brl: number | string | null
  total_balance_brl: number | string | null
}

export function mapPendingBalancesByCustomer(rows: CustomerPendingBalanceRow[]) {
  const balances = new Map<number, number>()
  for (const row of rows) {
    balances.set(row.customer_id, Number(row.total_balance_brl ?? 0))
  }
  return balances
}

export async function fetchCustomerPendingBalance(customerId: number) {
  const { data, error } = await supabase.rpc('get_customer_pending_balances' as never, {
    p_customer_ids: [customerId],
  } as never)
  if (error) throw error
  const row = ((data ?? []) as unknown as CustomerPendingBalanceRow[])[0]
  return {
    localBrl: Number(row?.local_balance_brl ?? 0),
    demurrageBrl: Number(row?.demurrage_balance_brl ?? 0),
    totalBrl: Number(row?.total_balance_brl ?? 0),
  }
}

export async function fetchIssuedInvoiceBalanceByCustomer(customerIds?: number[]) {
  if (customerIds && customerIds.length === 0) return new Map<number, number>()
  const { data, error } = await supabase.rpc('get_customer_pending_balances' as never, {
    p_customer_ids: customerIds ? Array.from(new Set(customerIds)) : null,
  } as never)
  if (error) throw error
  return mapPendingBalancesByCustomer((data ?? []) as unknown as CustomerPendingBalanceRow[])
}

function stringifyValue(value: unknown) {
  return value === null || value === undefined ? '' : String(value)
}

function normalizeText(value?: string | null) {
  const text = (value ?? '').trim()
  return text || null
}

function normalizeState(value?: string | null) {
  const text = normalizeText(value)
  return text ? text.toUpperCase().slice(0, 2) : null
}

function normalizeZip(value?: string | null) {
  const digits = onlyDigits(value)
  return digits || null
}

/** Busca cliente existente por CNPJ (fallback de cadastro duplicado). */
export async function findCustomerIdByDocument(cnpjCpf: string): Promise<number | null> {
  const { data } = await supabase
    .from('customers')
    .select('id')
    .eq('cnpj_cpf', canonicalizeDocument(cnpjCpf))
    .maybeSingle()
  return data?.id ?? null
}
