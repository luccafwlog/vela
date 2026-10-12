import { supabase } from '../supabase'
import { ensureDemurrageRatesLoaded } from './demurrageRates'
import { selectAgreementForDischargeDate } from './customerDemurrageAgreements'
import { CUSTOMER_OF_BL } from '../../lib/supabaseEmbeds'
import type { DemurrageContainerListItem } from '../../types/database'

export type DemurrageContainerFilters = {
  customerId?: number | null
  blId?: string | null
  voyageId?: number | null
}

/** Invoice viva (emitida ou paga) que cobra a caixa (migration 214). */
export type DemurrageBilledInvoiceRef = {
  id: number
  doc_number: string
  status: string
  bl_id: string
}

export type DemurrageContainerAgreement = {
  id: number
  free_days: number | null
  p1_usd: number | null
  p2_usd: number | null
}

export type DemurrageContainerRow = DemurrageContainerListItem & {
  ownership?: string | null
  bl?: (NonNullable<DemurrageContainerListItem['bl']> & { voyage_id?: number | null }) | null
  /** Acordo do Cliente vigente na descarga, o mesmo que o banco usa no status e na Invoice. */
  customer_agreement?: DemurrageContainerAgreement | null
  /** Invoices vivas da mesma Viagem e do mesmo Cliente que já cobram esta caixa. */
  billed_in?: DemurrageBilledInvoiceRef[]
}

type BilledItemRow = {
  container_id: number | null
  container_number: string | null
  invoice: {
    id: number
    doc_number: string
    status: string
    customer_id: number
    bl_id: string
    bl: { voyage_id: number | null } | null
  } | null
}

/**
 * Chave da caixa como o banco a compara em `_demurrage_billed_container_keys`
 * (migration 214): Viagem do B/L da Invoice, Cliente da Invoice e número do
 * container sem espaços nas pontas, em maiúsculas.
 */
export function demurrageBoxKey(voyageId: number | null | undefined, customerId: number | null | undefined, containerNumber: string | null | undefined): string | null {
  const number = (containerNumber ?? '').trim().toUpperCase()
  if (voyageId == null || customerId == null || !number) return null
  return `${voyageId}|${customerId}|${number}`
}

export function indexBilledBoxes(items: readonly BilledItemRow[]): Map<string, DemurrageBilledInvoiceRef[]> {
  const index = new Map<string, DemurrageBilledInvoiceRef[]>()
  for (const item of items) {
    const invoice = item.invoice
    if (!invoice) continue
    const key = demurrageBoxKey(invoice.bl?.voyage_id, invoice.customer_id, item.container_number)
    if (!key) continue
    const refs = index.get(key) ?? []
    if (!refs.some((ref) => ref.id === invoice.id)) {
      refs.push({ id: invoice.id, doc_number: invoice.doc_number, status: invoice.status, bl_id: invoice.bl_id })
    }
    index.set(key, refs)
  }
  return index
}

export async function listDemurrageContainers(filters?: DemurrageContainerFilters): Promise<DemurrageContainerRow[]> {
  await ensureDemurrageRatesLoaded()

  const [itemsResult, agreementsResult] = await Promise.all([
    supabase
      .from('demurrage_invoice_items')
      .select('container_id, container_number, invoice:demurrage_invoices!inner(id, doc_number, status, customer_id, bl_id, bl:bls(voyage_id))')
      .in('invoice.status', ['issued', 'overdue', 'paid']),
    supabase
      .from('customer_demurrage_agreements')
      .select('id, customer_id, free_days, p1_usd, p2_usd, valid_from, valid_to')
      .eq('active', true)
      .order('valid_from', { ascending: false })
      .order('id', { ascending: false }),
  ])
  if (itemsResult.error) throw itemsResult.error
  if (agreementsResult.error) throw agreementsResult.error

  const activeInvoiceItems = (itemsResult.data ?? []) as unknown as BilledItemRow[]
  const billedIndex = indexBilledBoxes(activeInvoiceItems)
  const invoicedContainerIds = [...new Set(activeInvoiceItems
    .map((item) => item.container_id)
    .filter((id): id is number => typeof id === 'number'))]

  type AgreementRow = DemurrageContainerAgreement & { customer_id: number; valid_from: string; valid_to: string | null }
  const agreementsByCustomer = new Map<number, AgreementRow[]>()
  for (const agreement of (agreementsResult.data ?? []) as AgreementRow[]) {
    agreementsByCustomer.set(agreement.customer_id, [...(agreementsByCustomer.get(agreement.customer_id) ?? []), agreement])
  }

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

  const { data, error } = await query.overrideTypes<DemurrageContainerRow[], { merge: false }>()
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

  return rows.map((row) => {
    const customerId = row.bl?.customer?.id
    const agreement = customerId != null
      ? selectAgreementForDischargeDate(agreementsByCustomer.get(customerId) ?? [], row.discharge_date)
      : null
    const key = demurrageBoxKey(row.bl?.voyage_id, customerId, row.container_number)
    return {
      ...row,
      customer_agreement: agreement
        ? { id: agreement.id, free_days: agreement.free_days, p1_usd: agreement.p1_usd, p2_usd: agreement.p2_usd }
        : null,
      billed_in: key ? billedIndex.get(key) ?? [] : [],
    }
  })
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

/**
 * Só a devolução muda: a descarga é a gravada, lida pelo banco sob a trava do
 * container (`p_keep_discharge`, migration 210). A tela não a relê, porque
 * outra sessão podia corrigi-la entre a leitura e a gravação.
 */
export async function updateContainerReturnDate(containerId: number, returnDate: string | null, reason?: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_container_dates' as never, {
    p_container_id: containerId,
    p_discharge_date: null,
    p_return_date: returnDate || null,
    p_reason: reason?.trim() || null,
    p_keep_discharge: true,
  } as never)
  if (error) throw error
}
