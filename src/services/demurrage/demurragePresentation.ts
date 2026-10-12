import type { DemurrageContainerListItem, DemurrageInvoice } from '../../types/database'
import { formatBRL, formatUSD } from '../../lib/utils'
import { calculateDemurrage } from './demurrageRates'
import { applyDemurrageUsdDiscount } from './demurrageInvoices'
import type { DemurrageBilledInvoiceRef, DemurrageContainerRow } from './demurrageContainers'

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

export function groupByBl(containers: DemurrageContainerListItem[]): Map<string, DemurrageContainerListItem[]> {
  const map = new Map<string, DemurrageContainerListItem[]>()
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
  const end = container.return_date ?? new Date().toISOString().slice(0, 10)
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
  /** Invoices vivas que já cobram alguma caixa deste B/L (sem repetição). */
  invoices: DemurrageBilledInvoiceRef[]
  /** Caixas deste B/L ainda sem Invoice viva. */
  uncovered: DemurrageContainerRow[]
  /** Caixas ainda fora (sem devolução) entre as listadas. */
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

/**
 * Estado de cobrança de um B/L na aba Containers. Só organiza o que a listagem
 * leu: a emissão continua decidida pelo banco (`issue_demurrage_invoice_for_bl`),
 * que confere o grupo inteiro e devolve o motivo quando recusa.
 * ponytail: olha só as caixas deste B/L que estão na lista; caixa de irmão do
 * grupo ainda fora aparece como recusa do banco ao gerar.
 */
export function blBillingState(containers: readonly DemurrageContainerRow[]): BlBillingState {
  const invoices: DemurrageBilledInvoiceRef[] = []
  for (const ref of containers.flatMap((container) => container.billed_in ?? [])) {
    if (!invoices.some((existing) => existing.id === ref.id)) invoices.push(ref)
  }
  const uncovered = containers.filter((container) => !(container.billed_in?.length))
  const stillOut = containers.filter((container) => !container.return_date).length
  const uncoveredUsd = uncovered.reduce((sum, container) => sum + safeTotalUsd(container), 0)
  let action: BlBillingState['action'] = 'none'
  if (containers.length && !uncovered.length) action = 'covered'
  else if (stillOut > 0 && uncovered.some((container) => !container.return_date)) action = 'waiting'
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
  if (invoice.status === 'issued' && invoice.dispute_open) {
    notices.push({
      key: 'dispute',
      tone: 'info',
      title: 'Disputa aberta',
      text: 'A Régua de Cobrança fica pausada até a disputa ser resolvida na conversa de Disputas.',
    })
  }
  if (invoice.status === 'issued' && !invoice.paid_at && invoice.roe_source === 'cached') {
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
 * Invoice complementar: outra Invoice viva do mesmo B/L-âncora foi emitida
 * antes desta (migration 214; ADR 0080, decisão 1).
 * ponytail: só enxerga o mesmo âncora; complementar emitida num âncora que
 * mudou depois (âncora cancelado) não é marcada.
 */
export function previousLiveInvoice<T extends Pick<DemurrageInvoice, 'id' | 'status' | 'created_at'>>(invoice: T, sameBlInvoices: readonly T[]): T | null {
  const created = invoice.created_at ?? ''
  const earlier = sameBlInvoices
    .filter((other) => other.id !== invoice.id && (other.status === 'issued' || other.status === 'paid' || other.status === 'overdue') && (other.created_at ?? '') < created)
    .sort((left, right) => (right.created_at ?? '').localeCompare(left.created_at ?? ''))
  return earlier[0] ?? null
}

export type DiscountPreview = { totalUsd: number; discountUsd: number; netUsd: number }

/** Prévia do desconto com a mesma regra da RPC: em USD, antes da conversão (ADR 0014). */
export function discountPreview(totalUsd: number, mode: string | null | undefined, rawValue: string | number | null | undefined): DiscountPreview | null {
  const value = typeof rawValue === 'number' ? rawValue : Number(String(rawValue ?? '').replace(',', '.'))
  if (!Number.isFinite(value) || value <= 0) return null
  // A RPC arredonda o desconto em centavos (`apply_demurrage_discount`).
  const netUsd = Math.round(applyDemurrageUsdDiscount(totalUsd, mode, value) * 100) / 100
  return { totalUsd, discountUsd: Math.round((totalUsd - netUsd) * 100) / 100, netUsd }
}

/** USD a cobrar: `total_usd` é o total dos itens; o desconto sai antes da conversão. */
export function invoiceNetUsd(invoice: Pick<DemurrageInvoice, 'total_usd' | 'discount_mode' | 'discount_value'>): DiscountPreview {
  return discountPreview(invoice.total_usd ?? 0, invoice.discount_mode, invoice.discount_value)
    ?? { totalUsd: invoice.total_usd ?? 0, discountUsd: 0, netUsd: invoice.total_usd ?? 0 }
}

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
