import { supabase } from '../supabase'
import { ensureDemurrageRatesLoaded, calculateDemurrage } from './demurrageRates'
import { findActiveAgreementForCustomer } from './customerDemurrageAgreements'
import { reportBestEffortFailure } from '../../lib/telemetry'
import { CUSTOMER_OF_BL } from '../../lib/supabaseEmbeds'
import type { DemurrageContainerListItem } from '../../types/database'

export type DemurrageContainerFilters = {
  customerId?: number | null
  blId?: string | null
  voyageId?: number | null
}

type DemurrageContainerQueryRow = DemurrageContainerListItem & {
  ownership?: string | null
  bl?: (NonNullable<DemurrageContainerListItem['bl']> & { voyage_id?: number | null }) | null
}

type DemurrageRateSourceRow = {
  type: string | null
  discharge_date?: string | null
  return_date?: string | null
  bl?: {
    customer_id?: number | null
    free_time_override?: number | null
    demurrage_rate_override_p1_usd?: number | null
    demurrage_rate_override_p2_usd?: number | null
  } | null
}

export async function listDemurrageContainers(filters?: DemurrageContainerFilters): Promise<DemurrageContainerListItem[]> {
  await ensureDemurrageRatesLoaded()

  const { data: activeInvoiceItems, error: invoiceItemsError } = await supabase
    .from('demurrage_invoice_items')
    .select('container_id, invoice:demurrage_invoices!inner(status)')
    .in('invoice.status', ['issued', 'paid'])
  if (invoiceItemsError) throw invoiceItemsError

  const invoicedContainerIds = [...new Set((activeInvoiceItems ?? [])
    .map((item) => item.container_id)
    .filter((id): id is number => typeof id === 'number'))]

  let query = supabase
    .from('bl_containers')
    .select(`
      id, bl_id, container_number, type, discharge_date, return_date, demurrage_status, ownership,
      bl:bls(
        id, pol, pod, free_time_override,
        demurrage_rate_override_p1_usd, demurrage_rate_override_p2_usd,
        demurrage_roe_manual, demurrage_roe, voyage_id,
        customer:${CUSTOMER_OF_BL}(id, name, cnpj_cpf),
        voyage:voyages(id, voyage_number, vessel:vessels(id, name))
      )
    `)
    .not('discharge_date', 'is', null)
    .order('discharge_date', { ascending: false })

  // Além do status operacional, preserva a rastreabilidade de containers que
  // já foram congelados em uma fatura ativa. Isso evita que a fatura exista,
  // mas seu container desapareça após uma atualização posterior do B/L.
  query = invoicedContainerIds.length > 0
    ? query.or(`demurrage_status.in.(overdue,returned),id.in.(${invoicedContainerIds.join(',')})`)
    : query.in('demurrage_status', ['overdue', 'returned'])

  if (filters?.blId) query = query.eq('bl_id', filters.blId)

  const { data, error } = await query.overrideTypes<DemurrageContainerQueryRow[], { merge: false }>()
  if (error) throw error

  // SOC é do cliente e não volta ao estoque: fica fora da Demurrage, salvo se
  // já estiver congelado numa fatura ativa (rastreabilidade acima).
  let rows = (data ?? []).filter((r) => r.ownership !== 'SOC' || invoicedContainerIds.includes(r.id))

  if (filters?.customerId) {
    rows = rows.filter((r) => r.bl?.customer?.id === filters.customerId)
  }
  if (filters?.voyageId) {
    rows = rows.filter((r) => r.bl?.voyage_id === filters.voyageId)
  }

  return rows
}

export async function updateContainerDates(containerId: number, dischargeDate: string, returnDate: string | null): Promise<void> {
  if (!returnDate) {
    const { error } = await supabase.from('bl_containers').update({ discharge_date: dischargeDate, return_date: null, demurrage_status: 'within_free_time' }).eq('id', containerId)
    if (error) throw error
    return
  }

  const { data: row, error: fetchErr } = await supabase
    .from('bl_containers')
    .select('type, bl:bls(customer_id, free_time_override, demurrage_rate_override_p1_usd, demurrage_rate_override_p2_usd)')
    .eq('id', containerId)
    .single()
    .overrideTypes<DemurrageRateSourceRow, { merge: false }>()
  if (fetchErr) throw fetchErr

  const container = row!
  const bl = container.bl
  const agreement = bl?.customer_id ? await findActiveAgreementForCustomer(bl.customer_id, dischargeDate) : null
  await ensureDemurrageRatesLoaded()
  const calc = calculateDemurrage(
    container.type,
    dischargeDate,
    returnDate,
    bl?.free_time_override,
    bl?.demurrage_rate_override_p1_usd,
    bl?.demurrage_rate_override_p2_usd,
    agreement,
  )

  const demurrage_status = calc.status === 'overdue' ? 'overdue' : 'within_free_time'
  const { error } = await supabase.from('bl_containers').update({ discharge_date: dischargeDate, return_date: returnDate, demurrage_status }).eq('id', containerId)
  if (error) throw error
}

export async function updateContainerReturnDate(containerId: number, returnDate: string | null): Promise<void> {
  if (!returnDate) {
    const oldReturnDate = await fetchCurrentReturnDate(containerId)
    const { error } = await supabase.from('bl_containers').update({ return_date: null, demurrage_status: 'within_free_time' }).eq('id', containerId)
    if (error) throw error
    await auditReturnDateChange(containerId, oldReturnDate, null)
    return
  }

  const { data: row, error: fetchErr } = await supabase
    .from('bl_containers')
    .select('type, discharge_date, return_date, bl:bls(customer_id, free_time_override, demurrage_rate_override_p1_usd, demurrage_rate_override_p2_usd)')
    .eq('id', containerId)
    .single()
    .overrideTypes<DemurrageRateSourceRow, { merge: false }>()
  if (fetchErr) throw fetchErr

  const container = row!
  const bl = container.bl
  const dischargeDate = container.discharge_date ?? ''
  const agreement = bl?.customer_id && dischargeDate ? await findActiveAgreementForCustomer(bl.customer_id, dischargeDate) : null
  await ensureDemurrageRatesLoaded()
  const calc = calculateDemurrage(
    container.type,
    dischargeDate,
    returnDate,
    bl?.free_time_override,
    bl?.demurrage_rate_override_p1_usd,
    bl?.demurrage_rate_override_p2_usd,
    agreement,
  )

  const demurrage_status = calc.status === 'overdue' ? 'overdue' : 'within_free_time'
  const { error } = await supabase.from('bl_containers').update({ return_date: returnDate, demurrage_status }).eq('id', containerId)
  if (error) throw error

  await auditReturnDateChange(containerId, container.return_date ?? null, returnDate)
}

// Auditoria best-effort da data de devolução — nunca quebra o fluxo do usuário.
// Cobre tanto definir quanto limpar (null) a data, para a linha do tempo do B/L.
async function auditReturnDateChange(containerId: number, oldReturnDate: string | null, returnDate: string | null): Promise<void> {
  try {
    const { data: userData } = await supabase.auth.getUser()
    await supabase.from('audit_logs').insert({
      entity_type: 'bl_container',
      entity_id: String(containerId),
      field_name: 'return_date',
      old_value: oldReturnDate,
      new_value: returnDate,
      changed_by: userData?.user?.id ?? null,
      justification: 'Data de devolução atualizada na seção Demurrage.',
    })
  } catch (auditError) {
    reportBestEffortFailure('auditar data de devolução do container', auditError, { containerId })
  }
}

async function fetchCurrentReturnDate(containerId: number): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('bl_containers')
      .select('return_date')
      .eq('id', containerId)
      .single()
      .overrideTypes<{ return_date: string | null }, { merge: false }>()
    if (error) throw error
    return data?.return_date ?? null
  } catch (error) {
    reportBestEffortFailure('buscar return_date anterior para auditoria', error, { containerId })
    return null
  }
}
