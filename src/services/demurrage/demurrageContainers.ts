import { supabase } from '../supabase'
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
  /** Clientes que dividem a caixa na Viagem (D19, migration 521); a previsão é a parte do Cliente. */
  box_share_count?: number
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

/**
 * B/L do grupo de Demurrage que emite a Invoice (`demurrage_group_anchor`,
 * migration 179/191). O banco não expõe a função a `authenticated` (190),
 * então a tela monta o grupo com a mesma leitura da aba Demurrage. Só o ROE
 * manual do âncora entra na Invoice do grupo (`create_demurrage_invoice_authoritative`).
 */
export async function readDemurrageGroupAnchor(blId: string): Promise<string> {
  const groups = buildBillingGroups(await readGroupBoxes([blId]), new Map())
  return groups.get(blId)?.anchorBlId ?? blId
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

/**
 * Invoices vivas (emitidas ou pagas) que cobram as caixas de um B/L, pela chave
 * do banco (Viagem, Cliente, número; migration 214). Inclui a Invoice do grupo
 * emitida em outro B/L, que a ficha do B/L não acha pelo `bl_id`. Devolve o
 * índice por número normalizado do container.
 */
export async function listBlDemurrageCoverage(bl: {
  voyage_id: number | null | undefined
  customer_id: number | null | undefined
  bl_containers?: ReadonlyArray<{ container_number: string | null }> | null
}): Promise<Map<string, DemurrageBilledInvoiceRef[]>> {
  const coverage = new Map<string, DemurrageBilledInvoiceRef[]>()
  const numbers = Array.from(new Set((bl.bl_containers ?? [])
    .map((container) => (container.container_number ?? '').trim())
    .filter(Boolean)
    .flatMap((number) => [number, number.toUpperCase()])))
  if (bl.voyage_id == null || bl.customer_id == null || !numbers.length) return coverage
  const { data, error } = await supabase
    .from('demurrage_invoice_items')
    .select('container_id, container_number, invoice:demurrage_invoices!inner(id, doc_number, status, customer_id, bl_id, bl:bls(voyage_id))')
    .eq('invoice.customer_id', bl.customer_id)
    .in('invoice.status', ['issued', 'overdue', 'paid'])
    .in('container_number', numbers)
  if (error) throw error
  const index = indexBilledBoxes((data ?? []) as unknown as BilledItemRow[])
  for (const container of bl.bl_containers ?? []) {
    const number = (container.container_number ?? '').trim().toUpperCase()
    const key = demurrageBoxKey(bl.voyage_id, bl.customer_id, number)
    const refs = key ? index.get(key) : undefined
    if (refs?.length) coverage.set(number, [...refs].sort((left, right) => right.id - left.id))
  }
  return coverage
}

export type DemurrageBoxWaiver = { id: number; container_key: string; reason: string; created_at: string }

/**
 * Dispensas vivas das caixas de um B/L (migration 517), pela mesma chave da
 * cobrança (Viagem, Cliente, número). Índice pelo número normalizado.
 */
export async function listBlDemurrageWaivers(bl: {
  voyage_id: number | null | undefined
  customer_id: number | null | undefined
  bl_containers?: ReadonlyArray<{ container_number: string | null }> | null
}): Promise<Map<string, DemurrageBoxWaiver>> {
  const keys = Array.from(new Set((bl.bl_containers ?? []).map((container) => (container.container_number ?? '').trim().toUpperCase()).filter(Boolean)))
  if (bl.voyage_id == null || bl.customer_id == null || !keys.length) return new Map()
  const { data, error } = await supabase
    .from('demurrage_box_waivers' as never)
    .select('id, container_key, reason, created_at')
    .eq('voyage_id', bl.voyage_id)
    .eq('customer_id', bl.customer_id)
    .is('revoked_at', null)
    .in('container_key', keys)
  if (error) throw error
  return new Map(((data ?? []) as DemurrageBoxWaiver[]).map((waiver) => [waiver.container_key, waiver]))
}
