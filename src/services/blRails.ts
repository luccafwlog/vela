import type { BL } from '../types/database'
import { INVOICE_STATUS_LABELS, statusLabel } from '../lib/statusLabels'
import { isCustomerReconciliationResolved } from './customerReconciliation'
import { isBreakbulkCargoMode, isContainerCargoMode } from '../lib/cargoMode'
import { invoiceTypeLabel } from './billing'

export type RailState = 'done' | 'pending' | 'blocked' | 'diverted'

export type RailStage = {
  key: string
  label: string
  detail: string
  state: RailState
  href?: string
}

type RailBl = Pick<
  BL,
  'id' | 'voyage_id' | 'cargo_mode' | 'ce_mercante' | 'review_status'
  | 'customer_reconciliation_status' | 'customer_id' | 'charge_status' | 'financial_status' | 'billing_hold_reason' | 'bb_weight_ton'
>

export type RailContainer = { container_number: string; discharge_date: string | null; return_date: string | null; ownership?: string | null }
export type RailSchedule = { etd?: string | null; atd?: string | null; eta?: string | null; ata?: string | null }
export type RailOmission = { omittedPod: string; dischargePod: string }
export type RailInvoice = {
  id: number
  invoice_number?: string | null
  status: string | null
  total_brl: number | null
  invoice_type?: string | null
}
export type RailDemurrageInvoice = { id: number; status: string | null }
/**
 * `billingReady`: Portal pronto ou Liberação de faturamento sem Portal vigente,
 * a condição da pendência "Acesso ao portal nao provisionado" da Revisão.
 */
export type RailPortalVisibility = { visible: boolean; reasons: string[]; billingReady?: boolean }
export type DocumentalSummary = { pendingCount: number; label: string }

const DOCUMENTAL_CORE_KEYS = new Set(['customer', 'charges', 'ce', 'invoice'])
// O gate da Revisão trava a emissão; não desfaz o que já foi emitido
// (`recompute_bl_review_status`).
const INVOICED_FINANCIAL_STATUSES = new Set(['invoiced', 'partially_paid', 'paid'])

function normalizeText(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

function classifyDocumentalReason(reason: string): RailStage['key'] {
  const normalized = normalizeText(reason).replace(/[_-]+/g, ' ')
  if (normalized.includes('ce mercante') || normalized === 'ce' || normalized.includes('ce ausente') || normalized.includes('sem ce')) return 'ce'
  if (normalized.includes('cliente') || normalized.includes('email') || normalized.includes('e mail') || normalized.includes('portal')) return 'customer'
  if (normalized.includes('peso') || normalized.includes('tabela') || normalized.includes('no table') || normalized.includes('linha') || normalized.includes('calcul') || normalized.includes('taxa') || normalized.includes('billing hold') || normalized.includes('no billable')) return 'charges'
  // Toda pendência legada precisa aparecer em um card acionável. Até que um
  // código mais específico seja criado, o card Cliente é a rota de correção
  // documental mais segura para mensagens não classificadas.
  return 'customer'
}

function reasonDetail(reason: string) {
  const normalized = normalizeText(reason).replace(/[_-]+/g, ' ')
  if (normalized.includes('peso') && (normalized.includes('bb') || normalized.includes('weight missing'))) return 'Peso BB ausente'
  if (normalized.includes('tabela') || normalized.includes('no table')) return 'Tabela não encontrada'
  if (normalized.includes('unsupported basis')) return 'Regra de cobrança incompatível'
  if (normalized.includes('no containers')) return 'Containers não encontrados'
  if (normalized.includes('linha') || normalized.includes('calcul') || normalized.includes('invalid')) return 'Linha inválida'
  if (normalized.includes('email') || normalized.includes('e mail')) return 'Cliente sem e-mail cadastrado'
  // Situação não carregada (ou com falha): o card fica fechado sem afirmar que a conta não está ativa.
  if (normalized.includes('portal') && normalized.includes('indisponivel')) return 'Situação do Portal indisponível'
  if (normalized.includes('portal')) return 'Conta do Portal não está ativa/provisionada'
  if (normalized.includes('cliente') && normalized.includes('vincul')) return 'Sem cliente vinculado'
  if (normalized.includes('revis') || normalized.includes('review')) return 'Pendência documental'
  return reason.trim() || 'Pendência documental'
}

function isPortalAccessReason(reason: string) {
  return normalizeText(reason).includes('portal') && classifyDocumentalReason(reason) === 'customer'
}

function documentalReasonMap(input: { bl: RailBl; reviewReasons?: string[]; portalVisibility?: RailPortalVisibility | null }) {
  const missingLooseCargoWeight = isBreakbulkCargoMode(input.bl.cargo_mode)
    && (input.bl.bb_weight_ton == null || Number(input.bl.bb_weight_ton) <= 0)
  // Conta do Portal não ativa só é pendência do Cliente enquanto segura a
  // fatura: com Liberação vigente (ou Portal pronto) o gate passa, e B/L
  // faturado já saiu do gate. Os outros motivos (CE, Cliente) continuam.
  const portalAccessSettled = input.portalVisibility?.billingReady === true
    || INVOICED_FINANCIAL_STATUSES.has(input.bl.financial_status ?? '')
  const portalReasons = input.portalVisibility == null
    ? ['Status do Portal indisponível']
    : input.portalVisibility.visible ? [] : input.portalVisibility.reasons
  const reasons = [
    ...(input.reviewReasons ?? []),
    ...portalReasons,
    ...(input.bl.billing_hold_reason ? [input.bl.billing_hold_reason] : []),
    ...(missingLooseCargoWeight ? ['Peso BB ausente'] : []),
  ]
  const map = new Map<RailStage['key'], string>()
  for (const reason of reasons) {
    if (portalAccessSettled && isPortalAccessReason(reason)) continue
    const key = classifyDocumentalReason(reason)
    if (!map.has(key)) map.set(key, reasonDetail(reason))
  }
  return {
    map,
    // Cliente apto sem Portal ativo: diz por quê, em vez de "Cliente apto" seco.
    portalAccessWaived: portalAccessSettled && input.portalVisibility?.visible === false
      && input.portalVisibility.reasons.some(isPortalAccessReason),
  }
}

const fmt = (value: string | null | undefined) =>
  value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(value)) : null

function distinct(containers: RailContainer[], has: (c: RailContainer) => boolean) {
  const all = new Set(containers.map((c) => c.container_number))
  const done = new Set(containers.filter(has).map((c) => c.container_number))
  return { done: done.size, total: all.size }
}

export function buildOperationalRail(input: {
  bl: RailBl
  polSchedule: RailSchedule | null
  podSchedule: RailSchedule | null
  containers: RailContainer[]
  omission: RailOmission | null
}): RailStage[] {
  const { bl, polSchedule, podSchedule, containers, omission } = input
  const voyageHref = bl.voyage_id ? `/viagens/${bl.voyage_id}` : undefined
  const pol: RailStage = polSchedule?.atd
    ? { key: 'pol', label: 'Saída do POL', detail: `ATD ${fmt(polSchedule.atd)}`, state: 'done', href: voyageHref }
    : { key: 'pol', label: 'Saída do POL', detail: polSchedule?.etd ? `ETD ${fmt(polSchedule.etd)}` : 'Sem previsão', state: 'pending', href: voyageHref }
  const pod: RailStage = omission
    ? { key: 'pod', label: 'Chegada ao POD', detail: `Omitida — descarga em ${omission.dischargePod}`, state: 'diverted', href: voyageHref }
    : podSchedule?.ata
      ? { key: 'pod', label: 'Chegada ao POD', detail: `ATA ${fmt(podSchedule.ata)}`, state: 'done', href: voyageHref }
      : { key: 'pod', label: 'Chegada ao POD', detail: podSchedule?.eta ? `ETA ${fmt(podSchedule.eta)}` : 'Sem previsão', state: 'pending', href: voyageHref }

  if (!isContainerCargoMode(bl.cargo_mode)) return [pol, pod]
  const discharge = distinct(containers, (c) => Boolean(c.discharge_date))
  // SOC é do cliente e nunca volta ao estoque: não há devolução a esperar.
  const returnable = containers.filter((c) => c.ownership !== 'SOC')
  const returned = distinct(returnable, (c) => Boolean(c.return_date))
  const returnDetail = returned.total > 0
    ? `${returned.done}/${returned.total} devolvidos`
    : containers.length > 0 ? 'Só SOC, sem devolução' : 'Sem containers'
  return [
    pol,
    pod,
    { key: 'discharge', label: 'Descarga', detail: discharge.total === 0 ? 'Sem containers' : `${discharge.done}/${discharge.total} descarregados`, state: discharge.total === 0 || discharge.done === discharge.total ? 'done' : 'pending', href: '/containers' },
    { key: 'return', label: 'Devolução', detail: returnDetail, state: returned.total === 0 || returned.done === returned.total ? 'done' : 'pending', href: `/bls/${bl.id}?tab=faturamento` },
  ]
}

export function buildDocumentalRail(input: {
  bl: RailBl
  latestInvoice: RailInvoice | null
  demurrageInvoices: RailDemurrageInvoice[]
  reviewReasons?: string[]
  portalVisibility?: RailPortalVisibility | null
  /** Containers do B/L: o aviso de Invoice retida só vale com caixa que gera Demurrage. */
  containers?: RailContainer[]
}): RailStage[] {
  const { bl, latestInvoice, demurrageInvoices, reviewReasons, portalVisibility, containers } = input
  const fichaFat = `/bls/${bl.id}?tab=faturamento`
  const fichaDet = `/bls/${bl.id}?tab=detalhes`
  const { map: reasonMap, portalAccessWaived } = documentalReasonMap({ bl, reviewReasons, portalVisibility })
  const customerReadyDetail = !portalAccessWaived
    ? 'Cliente apto'
    : portalVisibility?.billingReady === true ? 'Cliente apto · Liberação sem Portal' : 'B/L faturado · Portal não está ativo'

  const customer: RailStage = !bl.customer_id
    ? { key: 'customer', label: 'Cliente', detail: 'Sem cliente vinculado', state: 'blocked', href: '/revisao?bl=' + encodeURIComponent(bl.id) }
    : !isCustomerReconciliationResolved(bl.customer_reconciliation_status)
      ? { key: 'customer', label: 'Cliente', detail: 'Pendente de reconciliação', state: 'blocked', href: '/revisao?bl=' + encodeURIComponent(bl.id) }
      : reasonMap.has('customer')
        ? { key: 'customer', label: 'Cliente', detail: reasonMap.get('customer')!, state: 'blocked', href: '/revisao?bl=' + encodeURIComponent(bl.id) }
        : bl.review_status === 'pending_review' && !reasonMap.has('charges')
          ? { key: 'customer', label: 'Cliente', detail: 'Pendência documental', state: 'blocked', href: '/revisao?bl=' + encodeURIComponent(bl.id) }
          : { key: 'customer', label: 'Cliente', detail: customerReadyDetail, state: 'done' }

  const chargeStatus = bl.charge_status ?? 'not_calculated'
  const chargeIssue = reasonMap.get('charges')
  const charges: RailStage = chargeIssue
    ? { key: 'charges', label: 'Taxas Locais', detail: `Bloqueado · ${chargeIssue}`, state: 'blocked', href: fichaFat }
    : chargeStatus === 'exempt'
      ? { key: 'charges', label: 'Taxas Locais', detail: 'Isento', state: 'done' }
      : ['calculated', 'reviewed', 'ready_for_billing', 'invoiced'].includes(chargeStatus)
        ? { key: 'charges', label: 'Taxas Locais', detail: 'Calculado', state: 'done' }
        : chargeStatus === 'review_required'
          ? { key: 'charges', label: 'Taxas Locais', detail: 'Bloqueado · Cálculo pendente', state: 'blocked', href: fichaFat }
          : { key: 'charges', label: 'Taxas Locais', detail: 'Não calculado', state: 'pending', href: fichaFat }

  const ceMercante = bl.ce_mercante?.trim() ?? ''
  const ce: RailStage = ceMercante
    ? { key: 'ce', label: 'CE Mercante', detail: ceMercante, state: 'done' }
    : { key: 'ce', label: 'CE Mercante', detail: 'Pendente · bloqueia emissão e Portal', state: 'blocked', href: fichaDet }

  const invoiceStatus = latestInvoice?.status?.trim().toLowerCase() ?? null
  const invoiceLabel = invoiceStatus === 'overdue'
    ? 'Emitida'
    : statusLabel(INVOICE_STATUS_LABELS, invoiceStatus, 'Status não informado')
  const invoiceState: RailState = !latestInvoice
    ? 'pending'
    : invoiceStatus === 'cancelled' || invoiceStatus === 'obsolete'
      ? 'blocked'
      : invoiceStatus === 'draft'
        ? 'pending'
        : 'done'
  const invoiceType = invoiceTypeLabel(latestInvoice?.invoice_type)
  const invoice: RailStage = latestInvoice
    ? { key: 'invoice', label: 'Fatura', detail: `#${latestInvoice.invoice_number ?? latestInvoice.id} · ${invoiceLabel} · ${invoiceType}`, state: invoiceState, href: `/taxas-locais?invoice=${latestInvoice.id}` }
    : { key: 'invoice', label: 'Fatura', detail: 'Não emitida', state: 'pending', href: fichaFat }

  const rail = [customer, charges, ce, invoice]
  // D1 (decisão do dono na revisão da PR #1084): a Invoice de Demurrage passa
  // pela trava do Portal (`portal_billing_gate`, migration 472) mesmo depois da
  // fatura de Taxas Locais. Com o B/L faturado e a trava fechada, a etapa
  // Cliente fica concluída e o aviso vem aqui, com o caminho para o Portal.
  // Não conta como pendência do trilho (DOCUMENTAL_CORE_KEYS).
  const demurrageHeld = portalVisibility?.billingReady === false
    && INVOICED_FINANCIAL_STATUSES.has(bl.financial_status ?? '')
    && bl.cargo_mode !== 'carga_solta'
    && Boolean(bl.customer_id)
    // B/L só com SOC não tem Demurrage a reter (revisão da release #1117).
    && (containers === undefined || containers.some((container) => container.ownership !== 'SOC'))
  if (demurrageHeld) {
    const held = 'Portal não está pronto e sem Liberação de faturamento'
    rail.push({
      key: 'demurrage',
      label: 'Demurrage',
      detail: demurrageInvoices.length > 0 ? `${demurrageInvoices.length} invoice(s) · nova Invoice retida: ${held}` : `Retida: ${held}`,
      state: 'blocked',
      href: `/clientes/portal?cliente=${bl.customer_id}`,
    })
  } else if (demurrageInvoices.length > 0) {
    const allPaid = demurrageInvoices.every((d) => d.status === 'paid')
    rail.push({ key: 'demurrage', label: 'Demurrage', detail: `${demurrageInvoices.length} invoice(s)${allPaid ? ' pagas' : ''}`, state: allPaid ? 'done' : 'pending', href: fichaFat })
  }
  return rail
}

export function summarizeDocumentalRail(documentalRail: RailStage[]): DocumentalSummary {
  const pendingCount = documentalRail.filter((stage) => DOCUMENTAL_CORE_KEYS.has(stage.key) && (stage.state === 'pending' || stage.state === 'blocked')).length
  return {
    pendingCount,
    label: pendingCount === 0 ? 'Sem pendências' : `${pendingCount} pendência${pendingCount === 1 ? '' : 's'}`,
  }
}

export function pickNextAction(documentalRail: RailStage[]): RailStage | null {
  return documentalRail.find((stage) => DOCUMENTAL_CORE_KEYS.has(stage.key) && (stage.state === 'pending' || stage.state === 'blocked')) ?? null
}
