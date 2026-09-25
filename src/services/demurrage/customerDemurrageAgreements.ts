import { supabase } from '../supabase'
import type {
  CustomerDemurrageAgreement,
  CustomerDemurrageAgreementFormInput,
  CustomerDemurrageAgreementListItem,
} from '../../types/customerDemurrageAgreements'
import { deleteOneById } from '../deleteRecords'

export type CustomerDemurrageAgreementFilters = {
  customerId?: number | null
  activeOnly?: boolean
}

export async function listCustomerDemurrageAgreements(
  filters?: CustomerDemurrageAgreementFilters,
): Promise<CustomerDemurrageAgreementListItem[]> {
  let query = supabase
    .from('customer_demurrage_agreements')
    .select(`
      id,
      customer_id,
      free_days,
      p1_usd,
      p2_usd,
      valid_from,
      valid_to,
      active,
      notes,
      created_at,
      updated_at,
      customer:customers(id, name, cnpj_cpf)
    `)
    .order('valid_from', { ascending: false })
    .order('id', { ascending: false })

  if (filters?.customerId) {
    query = query.eq('customer_id', filters.customerId)
  }
  if (filters?.activeOnly) {
    query = query.eq('active', true)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as CustomerDemurrageAgreementListItem[]
}

export async function findActiveAgreementForCustomer(
  customerId: number,
  referenceDate?: string | null,
): Promise<CustomerDemurrageAgreement | null> {
  const ref = referenceDate || new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('customer_demurrage_agreements')
    .select('*')
    .eq('customer_id', customerId)
    .eq('active', true)
    .lte('valid_from', ref)
    .or(`valid_to.is.null,valid_to.gte.${ref}`)
    .order('valid_from', { ascending: false })
    .limit(1)

  if (error) throw error
  if (!data || data.length === 0) return null
  return data[0] as unknown as CustomerDemurrageAgreement
}

export async function fetchActiveAgreementsForCustomers(
  customerIds: number[],
  referenceDate?: string | null,
): Promise<Map<number, CustomerDemurrageAgreement>> {
  if (!customerIds.length) return new Map()
  const uniqueIds = [...new Set(customerIds)]
  const ref = referenceDate || new Date().toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('customer_demurrage_agreements')
    .select('*')
    .in('customer_id', uniqueIds)
    .eq('active', true)
    .lte('valid_from', ref)
    .or(`valid_to.is.null,valid_to.gte.${ref}`)
    .order('valid_from', { ascending: false })

  if (error) throw error
  const map = new Map<number, CustomerDemurrageAgreement>()
  for (const row of (data ?? []) as unknown as CustomerDemurrageAgreement[]) {
    if (!map.has(row.customer_id)) {
      map.set(row.customer_id, row)
    }
  }
  return map
}

export async function saveCustomerDemurrageAgreement(
  input: CustomerDemurrageAgreementFormInput,
): Promise<void> {
  if (!input.customer_id) {
    throw new Error('Cliente obrigatorio para cadastro de acordo.')
  }
  if (input.free_days == null || input.free_days < 0) {
    throw new Error('Free time em dias e obrigatorio e deve ser maior ou igual a 0.')
  }
  if (!input.valid_from) {
    throw new Error('Data de inicio de vigencia e obrigatoria.')
  }
  if (input.valid_to && input.valid_to < input.valid_from) {
    throw new Error('Data de termino da vigencia nao pode ser anterior ao inicio.')
  }

  const payload = {
    ...(input.id ? { id: input.id } : {}),
    customer_id: input.customer_id,
    free_days: Number(input.free_days),
    p1_usd: input.p1_usd != null && input.p1_usd !== ('' as unknown as number) ? Number(input.p1_usd) : null,
    p2_usd: input.p2_usd != null && input.p2_usd !== ('' as unknown as number) ? Number(input.p2_usd) : null,
    valid_from: input.valid_from,
    valid_to: input.valid_to || null,
    active: input.active ?? true,
    notes: input.notes?.trim() || null,
  }

  const { error } = await supabase.from('customer_demurrage_agreements').upsert(payload)
  if (error) {
    const msg = error.message || ''
    if (msg.includes('customer_demurrage_agreements_no_overlap') || msg.includes('23P01')) {
      throw new Error('Ja existe um acordo ativo para este cliente com vigencia sobreposta.')
    }
    throw error
  }
}

export async function deleteCustomerDemurrageAgreement(id: number, reason: string): Promise<void> {
  const { error } = await deleteOneById('customer_demurrage_agreements', id, reason)
  if (error) throw error
}

export async function toggleCustomerDemurrageAgreementActive(id: number, active: boolean): Promise<void> {
  const { error } = await supabase
    .from('customer_demurrage_agreements')
    .update({ active })
    .eq('id', id)
  if (error) {
    const msg = error.message || ''
    if (msg.includes('customer_demurrage_agreements_no_overlap') || msg.includes('23P01')) {
      throw new Error('Nao e possivel reativar: ja existe outro acordo ativo para este cliente no mesmo periodo.')
    }
    throw error
  }
}

// Qual acordo vale para uma data de descarga. A escolha e por container (cada
// um tem sua data), nao por cliente: guardar "o acordo do cliente" antes de
// olhar a data faz um acordo vencido mascarar o vigente e a cobranca cair na
// tabela padrao. Espera a lista ja ordenada por vigencia decrescente, de modo
// que o mais recente vence quando dois periodos se sobrepoem.
export function selectAgreementForDischargeDate<
  T extends { valid_from: string; valid_to?: string | null },
>(agreements: T[], dischargeDate: string | null | undefined): T | null {
  if (!dischargeDate) return null
  return (
    agreements.find(
      (a) => dischargeDate >= a.valid_from && (!a.valid_to || dischargeDate <= a.valid_to),
    ) ?? null
  )
}
