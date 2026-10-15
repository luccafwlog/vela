import { supabase } from '../supabase'
import { CUSTOMER_OF_BL } from '../../lib/supabaseEmbeds'
import { saoPauloTodayIso } from '../../lib/dates'
import { ensureDemurrageRatesLoaded } from './demurrageRates'
import { selectAgreementForDischargeDate } from './customerDemurrageAgreements'
import { demurrageBoxKey } from './demurrageBoxKey'
import { indexBilledBoxes, type DemurrageBilledInvoiceRef, type DemurrageContainerRow } from './demurrageContainers'
import { containerFreeTimeDays, daysSince, effectiveDemurrage, freeTimeSource, FREE_TIME_SOURCE_LABELS } from './demurragePresentation'

/**
 * Contêineres dos B/Ls de um Cliente (aba Contêineres da ficha, lote 1 da
 * identidade): os mesmos dados e o mesmo cálculo da tela Demurrage, só
 * agrupados por Cliente. Entra todo contêiner de B/L ativo, inclusive SOC e
 * os que ainda estão no free time.
 */
const SELECT = `
  id, bl_id, container_number, type, discharge_date, return_date, demurrage_status, ownership,
  bl:bls!inner(
    id, pol, pod, free_time_override,
    demurrage_rate_override_p1_usd, demurrage_rate_override_p2_usd,
    demurrage_roe_manual, demurrage_roe, voyage_id, customer_id, cancelled_at,
    customer:${CUSTOMER_OF_BL}(id, name, cnpj_cpf),
    voyage:voyages(id, voyage_number, vessel:vessels(id, name))
  )
`

const PAGE = 1000

async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw error
    const chunk = (data ?? []) as T[]
    rows.push(...chunk)
    if (chunk.length < PAGE) return rows
  }
}

export async function listCustomerContainers(customerId: number): Promise<DemurrageContainerRow[]> {
  await ensureDemurrageRatesLoaded()
  const [containers, items, agreements] = await Promise.all([
    readAll<DemurrageContainerRow & { bl: { customer_id: number | null; cancelled_at: string | null } | null }>((from, to) => supabase
      .from('bl_containers')
      .select(SELECT)
      .eq('bl.customer_id', customerId)
      .is('bl.cancelled_at', null)
      .order('discharge_date', { ascending: false, nullsFirst: false })
      .order('id')
      .range(from, to)),
    readAll<Parameters<typeof indexBilledBoxes>[0][number]>((from, to) => supabase
      .from('demurrage_invoice_items')
      .select('container_id, container_number, invoice:demurrage_invoices!inner(id, doc_number, status, customer_id, bl_id, bl:bls(voyage_id))')
      .eq('invoice.customer_id', customerId)
      .in('invoice.status', ['issued', 'overdue', 'paid'])
      .order('id')
      .range(from, to)),
    readAll<{ id: number; free_days: number | null; p1_usd: number | null; p2_usd: number | null; valid_from: string; valid_to: string | null }>((from, to) => supabase
      .from('customer_demurrage_agreements')
      .select('id, free_days, p1_usd, p2_usd, valid_from, valid_to')
      .eq('customer_id', customerId)
      .eq('active', true)
      .order('valid_from', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)),
  ])
  const billed = indexBilledBoxes(items)
  return containers.map((row) => {
    const agreement = selectAgreementForDischargeDate(agreements, row.discharge_date)
    const key = demurrageBoxKey(row.bl?.voyage_id, customerId, row.container_number)
    return {
      ...row,
      customer_agreement: agreement ? { id: agreement.id, free_days: agreement.free_days, p1_usd: agreement.p1_usd, p2_usd: agreement.p2_usd } : null,
      billed_in: key ? billed.get(key) ?? [] : [],
    }
  })
}

export type CustomerContainerDemurrage =
  | { kind: 'none' }
  | { kind: 'soc' }
  | { kind: 'running'; usd: number }
  | { kind: 'to_bill'; usd: number }
  | { kind: 'invoice'; invoice: DemurrageBilledInvoiceRef }
  | { kind: 'error'; message: string }

export type CustomerContainerView = {
  soc: boolean
  /** Dias de uso: da descarga até a devolução, ou até hoje. Null sem descarga. */
  days: number | null
  freeTimeDays: number | null
  freeTimeSourceLabel: string | null
  /** Passou do free time (Dias em âmbar). */
  overFreeTime: boolean
  demurrage: CustomerContainerDemurrage
}

/** O que a linha mostra: dias, free time e a coluna Demurrage em uma palavra. */
export function customerContainerView(row: DemurrageContainerRow, today = saoPauloTodayIso()): CustomerContainerView {
  const soc = row.ownership === 'SOC'
  const days = row.discharge_date ? daysSince(row.discharge_date, row.return_date ?? today) : null
  if (soc) return { soc, days, freeTimeDays: null, freeTimeSourceLabel: null, overFreeTime: false, demurrage: { kind: 'soc' } }
  const freeTimeDays = containerFreeTimeDays(row)
  const freeTimeSourceLabel = freeTimeDays == null ? null : FREE_TIME_SOURCE_LABELS[freeTimeSource(row)]
  const overFreeTime = days != null && freeTimeDays != null && days > freeTimeDays
  // A fatura viva que cobra a caixa vence o valor previsto; a mais recente primeiro.
  const invoice = [...(row.billed_in ?? [])].sort((left, right) => right.id - left.id)[0]
  if (invoice) return { soc, days, freeTimeDays, freeTimeSourceLabel, overFreeTime, demurrage: { kind: 'invoice', invoice } }
  let usd: number
  try {
    usd = effectiveDemurrage(row, row.customer_agreement, today)?.total_usd ?? 0
  } catch (error) {
    return { soc, days, freeTimeDays, freeTimeSourceLabel, overFreeTime, demurrage: { kind: 'error', message: error instanceof Error ? error.message : String(error) } }
  }
  if (usd <= 0) return { soc, days, freeTimeDays, freeTimeSourceLabel, overFreeTime, demurrage: { kind: 'none' } }
  return { soc, days, freeTimeDays, freeTimeSourceLabel, overFreeTime, demurrage: row.return_date ? { kind: 'to_bill', usd } : { kind: 'running', usd } }
}
