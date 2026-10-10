import { supabase } from '../supabase'
import { ensureDemurrageRatesLoaded } from './demurrageRates'
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

// Datas do container passam pela RPC `set_container_dates` (migration 179): a
// data vale para todos os B/Ls ativos que dividem o container na Viagem, o
// status de Demurrage segue a devolução, a Invoice de Demurrage emitida é
// reconciliada e o Histórico registra a mudança. Remover uma data exige motivo.
export async function updateContainerDates(
  containerId: number,
  dischargeDate: string | null,
  returnDate: string | null,
  reason?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('set_container_dates' as never, {
    p_container_id: containerId,
    p_discharge_date: dischargeDate || null,
    p_return_date: returnDate || null,
    p_reason: reason?.trim() || null,
  } as never)
  if (error) throw error
}

export async function updateContainerReturnDate(containerId: number, returnDate: string | null, reason?: string | null): Promise<void> {
  const { data, error } = await supabase
    .from('bl_containers')
    .select('discharge_date')
    .eq('id', containerId)
    .single()
    .overrideTypes<{ discharge_date: string | null }, { merge: false }>()
  if (error) throw error
  await updateContainerDates(containerId, data?.discharge_date ?? null, returnDate, reason)
}
