// Predicados puros para a fila de revisão.
import { canonicalizeValidCnpj, extractCnpjsFromText } from '../lib/cnpj'
import type { ReviewQueueItem } from '../hooks/useReview'
import { isBreakbulkCargoMode } from '../lib/cargoMode'

export function normalizeConsignee(value?: string | null) {
  return value?.trim() || ''
}

const reviewReasonLabels: Record<string, string> = {
  'Cliente nao vinculado': 'Cadastro de cliente pendente',
  'Cliente nao vinculado (Granito)': 'Cadastro de cliente pendente (Granito)',
}

/** Texto operacional exibido na fila, mantendo o motivo bruto para filtros e persistência. */
export function reviewReasonLabel(reason: string) {
  return reviewReasonLabels[reason] ?? reason
}

export function getReviewCargoTypeLabel(item: ReviewQueueItem) {
  if (item.source !== 'bl') return 'Contêiner'
  if (item.cargo_mode === 'misto') return 'Misto'
  if (item.cargo_mode === 'carga_solta') return 'Carga solta'
  return 'Contêiner'
}

// Cliente e consignatário são a mesma entidade, chaveada por CNPJ. Se o CNPJ já
// está cadastrado, vale a razão social do cliente; senão, vale o dado do
// manifesto (que pode ter ruído de leitura). Por isso o CNPJ do cliente
// vinculado tem prioridade sobre o CNPJ lido do manifesto.
export function getReviewItemCnpj(item: ReviewQueueItem): string | null {
  const registered = canonicalizeValidCnpj(item.customer?.cnpj_cpf)
  if (registered) return registered
  return canonicalizeValidCnpj(item.manifest_customer_cnpj_cpf)
}

export function getReviewItemDisplayName(item: ReviewQueueItem): string {
  if (item.customer?.name) return item.customer.name
  return (
    normalizeConsignee(item.consignee) ||
    normalizeConsignee(item.shipper) ||
    (item.source === 'granite' ? item.bl_number : item.id)
  )
}

export type ReviewIdentityKind = 'document' | 'name' | 'conflict'

export type ReviewGroup = {
  key: string
  cnpj: string | null
  displayName: string
  items: ReviewQueueItem[]
  identityKind: ReviewIdentityKind
  candidateCnpjs: string[]
  canBulkOnboard: boolean
}

/** Candidatos documentais deduplicados, na ordem em que aparecem na evidência. */
export function getReviewItemDocumentCandidates(item: ReviewQueueItem): string[] {
  const candidates: string[] = []
  const seen = new Set<string>()

  const add = (cnpj: string | null) => {
    if (cnpj && !seen.has(cnpj)) {
      seen.add(cnpj)
      candidates.push(cnpj)
    }
  }

  add(canonicalizeValidCnpj(item.manifest_customer_cnpj_cpf))
  for (const cnpj of extractCnpjsFromText(item.consignee_block)) add(cnpj)
  for (const cnpj of extractCnpjsFromText(item.cargo_description)) add(cnpj)

  return candidates
}

function getReviewItemIdentityKind(item: ReviewQueueItem, candidates: string[]): ReviewIdentityKind {
  const registered = canonicalizeValidCnpj(item.customer?.cnpj_cpf)
  return candidates.length > 1 || Boolean(registered && candidates.some((candidate) => candidate !== registered))
    ? 'conflict'
    : candidates.length === 1 || getReviewItemCnpj(item) ? 'document' : 'name'
}

type ReviewItemAnalysis = {
  item: ReviewQueueItem
  candidates: string[]
  identityKind: ReviewIdentityKind
  cnpj: string | null
  key: string
}

function analyzeReviewItem(item: ReviewQueueItem): ReviewItemAnalysis {
  const candidates = getReviewItemDocumentCandidates(item)
  const registered = canonicalizeValidCnpj(item.customer?.cnpj_cpf)
  const identityKind = getReviewItemIdentityKind(item, candidates)
  const key = registered && candidates.some((candidate) => candidate !== registered)
    ? `conflict:${item.source}:${item.id}`
    : candidates.length > 1
      ? `conflict:${item.source}:${item.id}`
      : candidates.length === 1 || registered
        ? `document:${registered ?? candidates[0]}`
        : `name:${getReviewItemDisplayName(item).toLowerCase()}:missing`

  return {
    item,
    candidates,
    identityKind,
    cnpj: registered ?? (candidates.length === 1 ? candidates[0] : null),
    key,
  }
}

// Chave de grupo: CNPJ válido quando existe; senão, nome de exibição normalizado.
export function getReviewItemGroupKey(item: ReviewQueueItem): string {
  return analyzeReviewItem(item).key
}

// Agrupa a fila por cliente/consignatário usando o CNPJ como chave. Itens sem
// CNPJ caem em um grupo por nome normalizado. Mantém a ordem alfabética por
// nome de exibição para a fila ficar previsível.
export function groupReviewItems(items: ReviewQueueItem[]): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>()
  // Candidate extraction is the expensive part (two regex scans per B/L).
  // Analyze each queue item once; the queue is capped at 500 rows.
  for (const analysis of items.map(analyzeReviewItem)) {
    const { item, candidates, cnpj, key, identityKind } = analysis
    const displayName = getReviewItemDisplayName(item)
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        cnpj,
        displayName,
        items: [],
        identityKind,
        candidateCnpjs: [],
        canBulkOnboard: identityKind === 'document' && item.source === 'bl',
      }
      groups.set(key, group)
    }
    group.items.push(item)
    if (!group.cnpj && cnpj) group.cnpj = cnpj
    for (const candidate of candidates) {
      if (!group.candidateCnpjs.includes(candidate)) group.candidateCnpjs.push(candidate)
    }
    group.identityKind = identityKind === 'conflict' || group.candidateCnpjs.length > 1
      ? 'conflict'
      : group.candidateCnpjs.length === 1 || Boolean(group.cnpj) ? 'document' : 'name'
    group.canBulkOnboard = group.canBulkOnboard && item.source === 'bl' && group.identityKind === 'document'
    // Prefere a razão social cadastrada como nome do grupo.
    if (item.customer?.name) group.displayName = item.customer.name
  }
  return Array.from(groups.values()).sort((a, b) => a.displayName.localeCompare(b.displayName))
}

export function getConsigneeFilterOptions(items: ReviewQueueItem[]) {
  return Array.from(new Set(items.map((item) => normalizeConsignee(item.consignee)).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  )
}

export function getSelectionConsignee(items: ReviewQueueItem[]) {
  const normalized = items.map((item) => normalizeConsignee(item.consignee))
  if (normalized.some((consignee) => !consignee)) return null
  const consignees = new Set(normalized)
  return consignees.size === 1 ? [...consignees][0] : null
}

export function needsCustomerLink(item: ReviewQueueItem) {
  return item.customer_id == null
}

export function hasCustomerDocumentConflict(item: ReviewQueueItem) {
  const registered = canonicalizeValidCnpj(item.customer?.cnpj_cpf)
  return Boolean(registered && getReviewItemDocumentCandidates(item).some((candidate) => candidate !== registered))
}

export function customerHasEmail(item: ReviewQueueItem) {
  return Boolean(item.customer?.customer_contacts?.some((contact) => (contact.email ?? '').trim()))
}

// O cliente de um grupo: primeiro item ja vinculado (todos compartilham o CNPJ).
export function getGroupLinkedItem(group: ReviewGroup) {
  return group.items.find((item) => item.customer?.id != null) ?? null
}

function groupHasReviewReason(group: ReviewGroup, pattern: RegExp) {
  return group.items.some((item) =>
    (item.review_reasons ?? []).some((reason) => pattern.test(reason)),
  )
}

// As travas de nivel-cliente vêm das pendencias canonicas calculadas pelo banco.
// Isso evita inferir portal pela relacao protegida por RLS e mantem a UI alinhada
// ao mesmo estado que decide review_status e faturamento.
export function groupNeedsEmail(group: ReviewGroup) {
  const linked = getGroupLinkedItem(group)
  return Boolean(linked) && groupHasReviewReason(group, /cliente sem e-mail cadastrado/i)
}

// Mantidos por compatibilidade com consumidores legados; a fila principal nao
// os usa para decidir faturamento ou vinculo.
export function groupNeedsPortal(group: ReviewGroup) {
  const linked = getGroupLinkedItem(group)
  return Boolean(linked) && groupHasReviewReason(group, /acesso ao portal nao provisionado/i)
}

export function needsWeightFix(item: ReviewQueueItem) {
  if (item.source !== 'bl') return false
  if ((item.review_reasons ?? []).some((reason) => /weight ton|peso bb/i.test(reason))) return true
  // Carga solta (BB) sem peso em toneladas: o calculo de taxas exige bb_weight_ton.
  return isBreakbulkCargoMode(item.cargo_mode) && (item.bb_weight_ton == null || Number(item.bb_weight_ton) <= 0)
}
