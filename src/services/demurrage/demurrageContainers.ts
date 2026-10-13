import { supabase } from '../supabase'
import { ensureDemurrageRatesLoaded } from './demurrageRates'
import { selectAgreementForDischargeDate } from './customerDemurrageAgreements'
import { CUSTOMER_OF_BL } from '../../lib/supabaseEmbeds'
import type { DemurrageContainerListItem } from '../../types/database'
import { demurrageBoxKey } from './demurrageBoxKey'

export { demurrageBoxKey }

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

/**
 * Grupo de cobrança do B/L como o banco o monta (`demurrage_group_bl_ids`,
 * migration 191): B/Ls ativos da mesma Viagem e do mesmo Cliente ligados por
 * container compartilhado. `issue_demurrage_invoice_for_bl` decide pelo grupo
 * inteiro, inclusive caixas que a aba não lista (ainda fora no free time).
 */
export type DemurrageBillingGroup = {
  /** Primeiro B/L do grupo em ordem de id: onde a Invoice nasce. */
  anchorBlId: string
  blIds: string[]
  /** Caixas não-SOC distintas do grupo. */
  boxes: number
  /** Caixas não-SOC distintas sem devolução: o banco devolve `waiting_return`. */
  stillOut: number
  /** Caixas não-SOC distintas que nenhuma Invoice viva da Viagem e do Cliente cobre. */
  uncovered: number
  /** Invoices vivas que cobrem caixas do grupo. */
  invoices: DemurrageBilledInvoiceRef[]
}

export type DemurrageContainerRow = DemurrageContainerListItem & {
  ownership?: string | null
  bl?: (NonNullable<DemurrageContainerListItem['bl']> & { voyage_id?: number | null }) | null
  /** Acordo do Cliente vigente na descarga, o mesmo que o banco usa no status e na Invoice. */
  customer_agreement?: DemurrageContainerAgreement | null
  /** Invoices vivas da mesma Viagem e do mesmo Cliente que já cobram esta caixa. */
  billed_in?: DemurrageBilledInvoiceRef[]
  /** Grupo de cobrança do B/L da caixa (ausente quando não se pôde montar). */
  billing_group?: DemurrageBillingGroup | null
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

/** Caixa de um B/L lida só para montar o grupo de cobrança. */
export type GroupBoxRow = {
  bl_id: string
  container_number: string | null
  ownership: string | null
  return_date: string | null
  bl: { voyage_id: number | null; customer_id: number | null; cancelled_at: string | null } | null
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

/**
 * Monta os grupos de cobrança a partir das caixas dos B/Ls envolvidos, com a
 * regra de `demurrage_group_bl_ids` (191) e as contagens de
 * `issue_demurrage_invoice_for_bl` (214). Devolve o grupo de cada B/L ativo.
 * ponytail: o âncora é o menor id pela ordem de código do JavaScript; o banco
 * ordena pela collation do Postgres. Só diverge com ids em caixa mista ou
 * acentos, que os B/Ls não usam.
 */
export function buildBillingGroups(
  boxes: readonly GroupBoxRow[],
  billedIndex: ReadonlyMap<string, DemurrageBilledInvoiceRef[]>,
): Map<string, DemurrageBillingGroup> {
  const active = boxes.filter((box) => box.bl && !box.bl.cancelled_at && box.bl.customer_id != null && box.bl.voyage_id != null)
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root)!
    parent.set(id, root)
    return root
  }
  const union = (left: string, right: string) => {
    const a = find(left)
    const b = find(right)
    if (a !== b) parent.set(a < b ? b : a, a < b ? a : b)
  }
  const firstBlByKey = new Map<string, string>()
  for (const box of active) {
    if (!parent.has(box.bl_id)) parent.set(box.bl_id, box.bl_id)
    const key = demurrageBoxKey(box.bl!.voyage_id, box.bl!.customer_id, box.container_number)
    if (!key) continue
    const first = firstBlByKey.get(key)
    if (first) union(first, box.bl_id)
    else firstBlByKey.set(key, box.bl_id)
  }

  const members = new Map<string, GroupBoxRow[]>()
  for (const box of active) {
    const root = find(box.bl_id)
    members.set(root, [...(members.get(root) ?? []), box])
  }

  const byBl = new Map<string, DemurrageBillingGroup>()
  for (const groupBoxes of members.values()) {
    const blIds = [...new Set(groupBoxes.map((box) => box.bl_id))].sort()
    const keys = new Set<string>()
    const out = new Set<string>()
    for (const box of groupBoxes) {
      if (box.ownership === 'SOC') continue
      const key = demurrageBoxKey(box.bl!.voyage_id, box.bl!.customer_id, box.container_number)
      // O banco recusa por qualquer caixa não-SOC sem devolução, até sem número.
      if (!box.return_date) out.add(key ?? `${box.bl_id}#${out.size}`)
      if (key) keys.add(key)
    }
    const invoices: DemurrageBilledInvoiceRef[] = []
    let uncovered = 0
    for (const key of keys) {
      const refs = billedIndex.get(key) ?? []
      if (!refs.length) uncovered += 1
      for (const ref of refs) if (!invoices.some((existing) => existing.id === ref.id)) invoices.push(ref)
    }
    const group: DemurrageBillingGroup = { anchorBlId: blIds[0], blIds, boxes: keys.size, stillOut: out.size, uncovered, invoices }
    for (const blId of blIds) byBl.set(blId, group)
  }
  return byBl
}

const PAGE_SIZE = 1000
const IN_CHUNK = 150

type PageResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>

/** Lê todas as páginas: o PostgREST corta em `max_rows` (1000) sem avisar. */
async function readAllPages<T>(page: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if ((data ?? []).length < PAGE_SIZE) return rows
  }
}

function chunks<T>(values: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size))
  return out
}

const CONTAINER_SELECT = `
      id, bl_id, container_number, type, discharge_date, return_date, demurrage_status, ownership,
      bl:bls(
        id, pol, pod, free_time_override,
        demurrage_rate_override_p1_usd, demurrage_rate_override_p2_usd,
        demurrage_roe_manual, demurrage_roe, voyage_id,
        customer:${CUSTOMER_OF_BL}(id, name, cnpj_cpf),
        voyage:voyages(id, voyage_number, vessel:vessels(id, name))
      )
    `
const GROUP_BOX_SELECT = 'bl_id, container_number, ownership, return_date, bl:bls(voyage_id, customer_id, cancelled_at)'

async function readGroupBoxesOfBls(blIds: readonly string[]): Promise<GroupBoxRow[]> {
  const parts = await Promise.all(chunks(blIds).map((ids) => readAllPages<GroupBoxRow>((from, to) => supabase
    .from('bl_containers')
    .select(GROUP_BOX_SELECT)
    .in('bl_id', ids)
    .order('id')
    .range(from, to) as unknown as PageResult<GroupBoxRow>)))
  return parts.flat()
}

/**
 * Caixas de todos os B/Ls dos grupos dos B/Ls listados. Os irmãos entram pelo
 * número do container compartilhado, como na recursão de
 * `demurrage_group_bl_ids`.
 * ponytail: o banco compara `upper(btrim(número))`; aqui o irmão é achado pelo
 * número gravado igual. Cadastro com caixa ou espaço diferentes no mesmo
 * container fica de fora do grupo até a emissão recusar. Upgrade: RPC de
 * leitura que devolva o estado do grupo por B/L.
 */
async function readGroupBoxes(listedBlIds: readonly string[]): Promise<GroupBoxRow[]> {
  const seenBls = new Set(listedBlIds)
  const seenNumbers = new Set<string>()
  const boxes: GroupBoxRow[] = await readGroupBoxesOfBls([...seenBls])
  for (let round = 0; round < 5; round += 1) {
    const numbers = [...new Set(boxes
      .filter((box) => box.bl && !box.bl.cancelled_at)
      .map((box) => box.container_number ?? '')
      .filter((number) => number.trim() && !seenNumbers.has(number)))]
    if (!numbers.length) break
    numbers.forEach((number) => seenNumbers.add(number))
    const groupOf = new Set(boxes.map((box) => `${box.bl?.voyage_id}|${box.bl?.customer_id}`))
    const siblings = (await Promise.all(chunks(numbers).map((part) => readAllPages<GroupBoxRow>((from, to) => supabase
      .from('bl_containers')
      .select(GROUP_BOX_SELECT)
      .in('container_number', part)
      .order('id')
      .range(from, to) as unknown as PageResult<GroupBoxRow>)))).flat()
    const newBls = [...new Set(siblings
      .filter((box) => box.bl && !box.bl.cancelled_at && !seenBls.has(box.bl_id) && groupOf.has(`${box.bl.voyage_id}|${box.bl.customer_id}`))
      .map((box) => box.bl_id))]
    if (!newBls.length) break
    newBls.forEach((id) => seenBls.add(id))
    boxes.push(...await readGroupBoxesOfBls(newBls))
  }
  return boxes
}

export async function listDemurrageContainers(filters?: DemurrageContainerFilters): Promise<DemurrageContainerRow[]> {
  await ensureDemurrageRatesLoaded()

  const [activeInvoiceItems, agreements] = await Promise.all([
    readAllPages<BilledItemRow>((from, to) => supabase
      .from('demurrage_invoice_items')
      .select('container_id, container_number, invoice:demurrage_invoices!inner(id, doc_number, status, customer_id, bl_id, bl:bls(voyage_id))')
      .in('invoice.status', ['issued', 'overdue', 'paid'])
      .order('id')
      .range(from, to) as unknown as PageResult<BilledItemRow>),
    readAllPages<AgreementRow>((from, to) => supabase
      .from('customer_demurrage_agreements')
      .select('id, customer_id, free_days, p1_usd, p2_usd, valid_from, valid_to')
      .eq('active', true)
      .order('valid_from', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to) as unknown as PageResult<AgreementRow>),
  ])

  const billedIndex = indexBilledBoxes(activeInvoiceItems)
  const invoicedContainerIds = new Set(activeInvoiceItems
    .map((item) => item.container_id)
    .filter((id): id is number => typeof id === 'number'))

  const agreementsByCustomer = new Map<number, AgreementRow[]>()
  for (const agreement of agreements) {
    agreementsByCustomer.set(agreement.customer_id, [...(agreementsByCustomer.get(agreement.customer_id) ?? []), agreement])
  }

  // Em atraso ou devolvidos, mais os que já estão congelados numa Invoice viva
  // (rastreabilidade: a Invoice existe e a caixa não pode sumir da lista). Os
  // ids das Invoices vão em lotes para a URL não crescer com o histórico.
  const statusRows = await readAllPages<DemurrageContainerRow>((from, to) => {
    let query = supabase
      .from('bl_containers')
      .select(CONTAINER_SELECT)
      .not('discharge_date', 'is', null)
      .in('demurrage_status', ['overdue', 'returned'])
    if (filters?.blId) query = query.eq('bl_id', filters.blId)
    return query.order('discharge_date', { ascending: false }).order('id').range(from, to) as unknown as PageResult<DemurrageContainerRow>
  })
  const listedIds = new Set(statusRows.map((row) => row.id))
  const missingInvoiced = [...invoicedContainerIds].filter((id) => !listedIds.has(id))
  const invoicedRows = (await Promise.all(chunks(missingInvoiced).map((ids) => readAllPages<DemurrageContainerRow>((from, to) => {
    let query = supabase
      .from('bl_containers')
      .select(CONTAINER_SELECT)
      .not('discharge_date', 'is', null)
      .in('id', ids)
    if (filters?.blId) query = query.eq('bl_id', filters.blId)
    return query.order('id').range(from, to) as unknown as PageResult<DemurrageContainerRow>
  })))).flat()

  // SOC é do cliente e não volta ao estoque: fica fora da Demurrage, salvo se
  // já estiver congelado numa fatura ativa (rastreabilidade acima).
  let rows = [...statusRows, ...invoicedRows]
    .filter((r) => r.ownership !== 'SOC' || invoicedContainerIds.has(r.id))
    .sort((left, right) => (right.discharge_date ?? '').localeCompare(left.discharge_date ?? '') || left.id - right.id)

  if (filters?.customerId) {
    rows = rows.filter((r) => r.bl?.customer?.id === filters.customerId)
  }
  if (filters?.voyageId) {
    rows = rows.filter((r) => r.bl?.voyage_id === filters.voyageId)
  }

  // O grupo só é lido onde a ação pode mudar: B/L com alguma caixa listada
  // ainda sem Invoice viva. Todo devolvido fica `returned` para sempre, e ler o
  // grupo de todo o histórico cresceria sem limite.
  // ponytail: B/L com todas as caixas listadas já cobradas fica sem
  // `billing_group` (a tela diz "Todas as caixas cobradas"), mesmo que um irmão
  // ainda no free time e fora da lista esteja sem Invoice; ele aparece quando
  // entrar em atraso ou voltar. Upgrade: a mesma RPC de leitura do grupo.
  const pendingBlIds = [...new Set(rows
    .filter((row) => {
      const key = demurrageBoxKey(row.bl?.voyage_id, row.bl?.customer?.id, row.container_number)
      return Boolean(row.bl_id) && !(key && billedIndex.get(key)?.length)
    })
    .map((row) => row.bl_id))]
  const groups = pendingBlIds.length ? buildBillingGroups(await readGroupBoxes(pendingBlIds), billedIndex) : new Map<string, DemurrageBillingGroup>()

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
      billing_group: groups.get(row.bl_id) ?? null,
    }
  })
}

type AgreementRow = DemurrageContainerAgreement & { customer_id: number; valid_from: string; valid_to: string | null }

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
