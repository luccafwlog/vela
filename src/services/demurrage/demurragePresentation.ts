import type { DemurrageContainerListItem, DemurrageInvoice } from '../../types/database'
import { formatBRL, formatUSD } from '../../lib/utils'
import { saoPauloTodayIso } from '../../lib/dates'
import { calculateDemurrage, demurrageFreeTimeDays } from './demurrageRates'
import { parseImportNumber } from '../../lib/importNumber'
import { discountFromValue, invoiceNetUsd, type DiscountPreview } from './demurrageNetUsd'
import type { DemurrageContainerRow } from './demurrageContainers'

export function fmtUSD(value: number | null | undefined) {
  if (value == null) return '---'
  return formatUSD(value)
}

// Ultimo dia util (hoje se for dia de semana; senao a sexta anterior). O recalculo
// do BCB so roda em dias uteis. ponytail: feriados nacionais nao sao considerados
// (banner pode soar falso-positivo em feriado) - operador pode ignorar/informar manual.
// Pela data de Brasília (DEM-D05): a data UTC vira antes da meia-noite e dava
// aviso falso à noite.
export function lastBusinessDayISO(now = new Date()): string {
  const date = new Date(`${saoPauloTodayIso(now)}T12:00:00Z`)
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() - 2)
  else if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

/** A PTAX do dia sai à tarde: o aviso só vale a partir das 14h de Brasília. */
export function isPtaxWarningEligible(date = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(date))
  return hour >= 14
}

export function fmtBRL(value: number | null | undefined) {
  // ponytail: canonical Intl currency spacing may differ from the former print formatter.
  return value == null ? '---' : formatBRL(value)
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
  today = saoPauloTodayIso(),
) {
  if (!container.discharge_date) return null
  const end = container.return_date ?? today
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
