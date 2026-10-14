import type { DemurrageContainerListItem, DemurrageInvoice } from '../../types/database'
import { formatBRL, formatUSD } from '../../lib/utils'
import { saoPauloTodayIso } from '../../lib/dates'
import { calculateDemurrage, demurrageFreeTimeDays } from './demurrageRates'
import { parseImportNumber } from '../../lib/importNumber'
import { demurrageBoxKey } from './demurrageBoxKey'
import { discountFromValue, invoiceNetUsd, type DiscountPreview } from './demurrageNetUsd'
import type { DemurrageBilledInvoiceRef, DemurrageBillingGroup, DemurrageContainerRow } from './demurrageContainers'

export function fmtUSD(value: number | null | undefined) {
  if (value == null) return '---'
  return formatUSD(value)
}

// Ultimo dia util (hoje se for dia de semana; senao a sexta anterior). O recalculo
// do BCB so roda em dias uteis. ponytail: feriados nacionais nao sao considerados
// (banner pode soar falso-positivo em feriado) - operador pode ignorar/informar manual.
export function lastBusinessDayISO(): string {
  const date = new Date()
  if (date.getDay() === 0) date.setDate(date.getDate() - 2)
  else if (date.getDay() === 6) date.setDate(date.getDate() - 1)
  return date.toISOString().slice(0, 10)
}

export function isPtaxWarningEligible(date = new Date()): boolean {
  return date.getHours() >= 14
}

export function fmtBRL(value: number | null | undefined) {
  // ponytail: canonical Intl currency spacing may differ from the former print formatter.
  return value == null ? '---' : formatBRL(value)
}

export function groupByBl<T extends Pick<DemurrageContainerListItem, 'bl_id'>>(containers: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const container of containers) {
    const blId = container.bl_id ?? 'unknown'
    if (!map.has(blId)) map.set(blId, [])
    map.get(blId)!.push(container)
  }
  return map
}

function containerBlRates(container: DemurrageContainerListItem) {
  return container.bl as {
    free_time_override?: number | null
    demurrage_rate_override_p1_usd?: number | null
    demurrage_rate_override_p2_usd?: number | null
  } | null
}

// Demurrage operacional do container: usa a devolucao quando existe, senao hoje
// (container ainda fora, sobreestadia correndo). Null sem data de descarga.
// Sem acordo explícito, vale o acordo do Cliente vigente na descarga que a
// listagem anexou (`customer_agreement`): é a mesma ordem do banco (free time do
// B/L > acordo > tabela), para a previsão não divergir do status gravado.
export function effectiveDemurrage(
  container: DemurrageContainerListItem & Pick<DemurrageContainerRow, 'customer_agreement'>,
  customerAgreement: { free_days?: number | null; p1_usd?: number | null; p2_usd?: number | null } | null | undefined = container.customer_agreement,
) {
  if (!container.discharge_date) return null
  const end = container.return_date ?? saoPauloTodayIso()
  const bl = containerBlRates(container)
  return calculateDemurrage(
    container.type,
    container.discharge_date,
    end,
    bl?.free_time_override,
    bl?.demurrage_rate_override_p1_usd,
    bl?.demurrage_rate_override_p2_usd,
    customerAgreement,
  )
}

/** Prazo de free time do container (B/L > acordo > tabela); null sem tarifa. */
export function containerFreeTimeDays(container: DemurrageContainerListItem & Pick<DemurrageContainerRow, 'customer_agreement'>): number | null {
  try {
    return demurrageFreeTimeDays(container.type, containerBlRates(container)?.free_time_override, container.customer_agreement)
  } catch {
    return null
  }
}

export type FreeTimeSource = 'bl' | 'acordo' | 'tabela'

/** De onde vem o free time aplicado ao container: B/L, acordo do Cliente ou tabela. */
export function freeTimeSource(container: DemurrageContainerListItem & Pick<DemurrageContainerRow, 'customer_agreement'>): FreeTimeSource {
  const bl = containerBlRates(container)
  if (bl?.free_time_override != null) return 'bl'
  if (container.customer_agreement?.free_days != null) return 'acordo'
  return 'tabela'
}

export const FREE_TIME_SOURCE_LABELS: Record<FreeTimeSource, string> = {
  bl: 'do B/L',
  acordo: 'acordo do Cliente',
  tabela: 'tabela',
}

export type BlBillingState = {
  /** Invoices vivas que já cobram alguma caixa do grupo (sem repetição). */
  invoices: DemurrageBilledInvoiceRef[]
  /** Caixas listadas do grupo ainda sem Invoice viva (uma por número). */
  uncovered: DemurrageContainerRow[]
  /** Caixas não-SOC do grupo ainda fora, inclusive as que a lista não mostra. */
  stillOut: number
  /** USD previsto das caixas ainda sem Invoice. */
  uncoveredUsd: number
  /**
   * `generate`: primeira Invoice do grupo; `complement`: Invoice complementar
   * só com as caixas ainda não cobradas (migration 214); `waiting`: há caixa
   * fora; `covered`: todas cobradas; `none`: nada a cobrar.
   */
  action: 'generate' | 'complement' | 'waiting' | 'covered' | 'none'
}

function boxKey(container: DemurrageContainerRow): string {
  return demurrageBoxKey(container.bl?.voyage_id, container.bl?.customer?.id, container.container_number) ?? `id:${container.id}`
}

/** Uma linha por caixa: o container compartilhado aparece em cada B/L do grupo. */
export function distinctBoxes<T extends DemurrageContainerRow>(containers: readonly T[]): T[] {
  const seen = new Set<string>()
  return containers.filter((container) => {
    const key = boxKey(container)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Estado de cobrança do grupo do B/L na aba Containers, na ordem de
 * `issue_demurrage_invoice_for_bl` (214): todas as caixas cobertas →
 * `existing`; caixa não-SOC fora → `waiting_return`; senão emite (a
 * complementar quando o grupo já tem Invoice). Recebe TODAS as caixas listadas
 * do grupo, nunca só as que a busca ou a lente deixaram visíveis; as contagens
 * do grupo vêm de `billing_group`, que inclui as caixas fora da lista. Sem o
 * grupo (B/L cancelado ou leitura antiga), cai nas caixas recebidas.
 */
export function blBillingState(containers: readonly DemurrageContainerRow[], group?: DemurrageBillingGroup | null): BlBillingState {
  const boxes = distinctBoxes(containers)
  const invoices: DemurrageBilledInvoiceRef[] = [...(group?.invoices ?? [])]
  for (const ref of boxes.flatMap((container) => container.billed_in ?? [])) {
    if (!invoices.some((existing) => existing.id === ref.id)) invoices.push(ref)
  }
  const uncovered = boxes.filter((container) => !(container.billed_in?.length))
  const stillOut = group ? group.stillOut : boxes.filter((container) => !container.return_date).length
  const uncoveredCount = group ? group.uncovered : uncovered.length
  const uncoveredUsd = uncovered.reduce((sum, container) => sum + safeTotalUsd(container), 0)
  let action: BlBillingState['action'] = 'none'
  if ((group ? group.boxes : boxes.length) && invoices.length && !uncoveredCount) action = 'covered'
  else if (stillOut > 0) action = uncoveredCount ? 'waiting' : 'covered'
  else if (uncoveredUsd > 0) action = invoices.length ? 'complement' : 'generate'
  return { invoices, uncovered, stillOut, uncoveredUsd, action }
}

function safeTotalUsd(container: DemurrageContainerRow): number {
  try {
    return effectiveDemurrage(container)?.total_usd ?? 0
  } catch {
    return 0
  }
}

/** Colunas que a listagem lê com `select('*')` e que o tipo gerado ainda não traz. */
export type DemurrageInvoiceRow = DemurrageInvoice & { dunning_suspended_reason?: string | null }

export const DATES_CHANGED_PAID_PREFIX = 'Datas de container alteradas depois do pagamento'
export const DATES_CHANGED_NEGOTIATED_PREFIX = 'Datas de container alteradas em Invoice com desconto ou disputa'

/**
 * Invoice paga suspensa porque as datas do container mudaram depois do
 * pagamento (migrations 179 e 191): o estorno da baixa a reemite, ou a deixa
 * para reemissão à mão quando tem desconto ou disputa (migration 203). Usado
 * pelo cancelamento de baixa em Demurrage e na Conciliação PIX.
 */
export function reversalDatesNotice(invoice: { dunning_suspended_reason?: string | null; discount_value?: number | null; dispute_open?: boolean | null }): { negotiated: boolean } | null {
  if (!invoice.dunning_suspended_reason?.startsWith(DATES_CHANGED_PAID_PREFIX)) return null
  return { negotiated: Number(invoice.discount_value ?? 0) > 0 || Boolean(invoice.dispute_open) }
}

export type InvoiceNotice = { key: string; tone: 'warning' | 'info' | 'danger'; title: string; text: string }

/**
 * Avisos da Invoice na ordem de urgência. A Régua deixa de cobrar a Invoice
 * com `dunning_suspended_reason` (migrations 179, 203 e 214) e pausa com
 * disputa aberta; a tela diz o porquê e o caminho, sem decidir nada.
 */
export function demurrageInvoiceNotices(invoice: Pick<DemurrageInvoiceRow, 'status' | 'dunning_suspended_reason' | 'dispute_open' | 'roe_source' | 'paid_at'>): InvoiceNotice[] {
  const notices: InvoiceNotice[] = []
  const reason = invoice.dunning_suspended_reason?.trim()
  if (invoice.status !== 'cancelled' && reason) {
    if (reason.startsWith(DATES_CHANGED_PAID_PREFIX)) {
      notices.push({
        key: 'dates-paid',
        tone: 'warning',
        title: 'Fora da Régua: as datas do container mudaram depois do pagamento',
        text: 'Os itens não batem mais com as datas atuais. Confira a diferença e trate pela restituição de Demurrage ou por uma fatura avulsa. O alerta "Datas mudaram em Invoice de Demurrage emitida" fecha quando os itens voltarem a bater com as datas.',
      })
    } else if (reason.startsWith(DATES_CHANGED_NEGOTIATED_PREFIX)) {
      notices.push({
        key: 'dates-negotiated',
        tone: 'warning',
        title: 'Fora da Régua: datas alteradas numa Invoice com desconto ou disputa',
        text: 'Esta Invoice não é reemitida sozinha. Cancele, gere de novo pela aba Containers e refaça o desconto ou responda a disputa. Se as datas voltarem às faturadas, a suspensão sai.',
      })
    } else {
      notices.push({ key: 'suspended', tone: 'warning', title: 'Fora da Régua', text: reason })
    }
  }
  const open = invoice.status === 'issued' || invoice.status === 'overdue'
  if (open && invoice.dispute_open) {
    notices.push({
      key: 'dispute',
      tone: 'info',
      title: 'Disputa aberta',
      text: 'A Régua de Cobrança fica pausada até a disputa ser resolvida na conversa de Disputas.',
    })
  }
  if (open && !invoice.paid_at && invoice.roe_source === 'cached') {
    notices.push({
      key: 'roe-cache',
      tone: 'info',
      title: 'Valor em BRL calculado com PTAX do cache',
      text: 'O BCB não respondeu no último recálculo. O valor em BRL é atualizado no próximo recálculo ou pelo botão Informar PTAX.',
    })
  }
  return notices
}

/**
 * Invoice complementar: outras Invoices vivas do mesmo B/L-âncora emitidas
 * antes desta (migration 214; ADR 0080, decisão 1). Devolve todas, da mais
 * antiga para a mais nova; empate de `created_at` (duas emissões na mesma
 * transação da reconciliação) desempata pelo id, que segue a ordem de criação.
 * ponytail: a marca é inferida, porque o banco não grava `complementary`. Só
 * enxerga o mesmo âncora, e se a original for cancelada depois a complementar
 * perde a marca, embora continue cobrando só as caixas dela. Upgrade: gravar
 * a marca na emissão.
 */
export function earlierLiveInvoices<T extends Pick<DemurrageInvoice, 'id' | 'status' | 'created_at'>>(invoice: T, sameBlInvoices: readonly T[]): T[] {
  const before = (left: T, right: T) => {
    const byDate = (left.created_at ?? '').localeCompare(right.created_at ?? '')
    return byDate !== 0 ? byDate < 0 : left.id < right.id
  }
  return sameBlInvoices
    .filter((other) => other.id !== invoice.id && LIVE_INVOICE_STATUSES.has(other.status ?? '') && before(other, invoice))
    .sort((left, right) => (before(left, right) ? -1 : 1))
}

const LIVE_INVOICE_STATUSES = new Set(['issued', 'overdue', 'paid'])

/** Número digitado em pt-BR ("1.000", "12,5"), o mesmo leitor do formulário. */
function parseTypedNumber(raw: string | number | null | undefined): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  const parsed = parseImportNumber(raw ?? '', 'pt-BR')
  return parsed.kind === 'value' ? Number(parsed.decimal) : null
}

/**
 * Prévia do desconto com a regra de `apply_demurrage_discount` (migration
 * 012), a partir do valor digitado; a regra numérica está em `demurrageNetUsd`.
 */
export function discountPreview(totalUsd: number, mode: string | null | undefined, rawValue: string | number | null | undefined): DiscountPreview | null {
  return discountFromValue(totalUsd, mode, parseTypedNumber(rawValue))
}

export { invoiceNetUsd }
export type { DiscountPreview }

export type AgreementSituation = 'vigente' | 'futuro' | 'encerrado' | 'inativo'

export const AGREEMENT_SITUATION_LABELS: Record<AgreementSituation, string> = {
  vigente: 'Vigente',
  futuro: 'Começa depois',
  encerrado: 'Encerrado',
  inativo: 'Inativo',
}

/**
 * Situação do acordo hoje. O cálculo escolhe o acordo pela data de descarga
 * (`selectAgreementForDischargeDate`), então "Encerrado" ainda vale para
 * descargas dentro da vigência.
 */
export function agreementSituation(agreement: { active: boolean | null; valid_from: string; valid_to?: string | null }, today: string): AgreementSituation {
  if (!agreement.active) return 'inativo'
  const from = agreement.valid_from.slice(0, 10)
  const to = agreement.valid_to?.slice(0, 10) ?? null
  if (from > today) return 'futuro'
  if (to && to < today) return 'encerrado'
  return 'vigente'
}

/** Dias corridos entre a descarga e hoje (ou a devolução), como o cálculo conta. */
export function daysSince(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T12:00:00Z`)
  const to = Date.parse(`${toIso.slice(0, 10)}T12:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0
  return Math.max(0, Math.round((to - from) / 86_400_000))
}
