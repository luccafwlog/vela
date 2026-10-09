// Predicados puros para a fila de revisão.
import { canonicalizeValidCnpj, extractCnpjsFromText, formatCnpj } from '../lib/cnpj'
import type { ReviewCustomer, ReviewQueueItem } from '../hooks/useReview'
import { isBreakbulkCargoMode } from '../lib/cargoMode'

export function normalizeConsignee(value?: string | null) {
  return value?.trim() || ''
}

// Rótulos no vocabulário do Motivo de Bloqueio de Faturamento (CONTEXT.md). O
// texto bruto continua sendo o que o gate grava em `bls.notes` e o que vai para
// filtros e persistência.
const reviewReasonLabels: Record<string, string> = {
  'Cliente nao vinculado': 'Sem cliente vinculado',
  'Cliente nao vinculado (Granito)': 'Granito sem cliente vinculado',
  'Acesso ao portal nao provisionado': 'Portal não provisionado',
  'Peso BB ausente': 'Peso da carga solta ausente',
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

// ---------------------------------------------------------------------------
// Triagem: causa, próxima ação e prioridade
// ---------------------------------------------------------------------------

/**
 * Causa de uma pendência na fila, na ordem em que o operador deve atacá-la:
 * primeiro o que se resolve aqui e trava a fatura (cliente, peso), depois o que
 * depende de outra tela (Portal) e por fim o Granito, que não gera fatura.
 */
export type ReviewCause = 'cliente' | 'peso' | 'portal' | 'granito' | 'outros'

export const REVIEW_CAUSE_ORDER: readonly ReviewCause[] = ['cliente', 'peso', 'portal', 'granito', 'outros']

export const REVIEW_CAUSE_LABELS: Record<ReviewCause, string> = {
  cliente: 'Sem cliente vinculado',
  peso: 'Peso da carga solta ausente',
  portal: 'Portal não provisionado',
  granito: 'Granito sem cliente',
  outros: 'Outras pendências',
}

export function isReviewCause(value: string | null | undefined): value is ReviewCause {
  return Boolean(value) && (REVIEW_CAUSE_ORDER as readonly string[]).includes(value as string)
}

/** Causa de um motivo bruto do gate; `null` quando o texto é só informativo (sugestão). */
export function reviewReasonCause(reason: string): ReviewCause | null {
  if (/^sugerido:/i.test(reason.trim())) return null
  if (/\(granito\)/i.test(reason)) return 'granito'
  if (/cliente n[aã]o vinculado/i.test(reason)) return 'cliente'
  if (/acesso ao portal/i.test(reason)) return 'portal'
  if (/peso bb|weight ton/i.test(reason)) return 'peso'
  return 'outros'
}

/** Causas de um item, sem repetição e na ordem de ataque. */
export function getReviewItemCauses(item: ReviewQueueItem): ReviewCause[] {
  const causes = new Set<ReviewCause>()
  for (const reason of item.review_reasons ?? []) {
    const cause = reviewReasonCause(reason)
    if (cause) causes.add(cause)
  }
  // Os mesmos predicados que liberam as ações da tela: o gate trava B/L sem
  // cliente e carga solta sem peso mesmo quando a nota técnica ainda não foi
  // regravada.
  if (item.source === 'bl' && needsCustomerLink(item)) causes.add('cliente')
  if (item.source === 'granite' && needsCustomerLink(item)) causes.add('granito')
  if (needsWeightFix(item)) causes.add('peso')
  if (!causes.size) causes.add('outros')
  return REVIEW_CAUSE_ORDER.filter((cause) => causes.has(cause))
}

/** Contagem de registros por causa (um registro conta uma vez por causa). */
export function countReviewCauses(items: ReviewQueueItem[]): Record<ReviewCause, number> {
  const counts: Record<ReviewCause, number> = { cliente: 0, peso: 0, portal: 0, granito: 0, outros: 0 }
  for (const item of items) for (const cause of getReviewItemCauses(item)) counts[cause] += 1
  return counts
}

/**
 * Lê o filtro de causa da URL. Aceita o parâmetro novo `causa` e, por
 * compatibilidade, o motivo bruto antigo em `motivo`/`reason`.
 */
export function readReviewCauseParam(params: URLSearchParams): ReviewCause | null {
  const cause = params.get('causa')
  if (isReviewCause(cause)) return cause
  const legacy = params.get('motivo') || params.get('reason')
  return legacy ? reviewReasonCause(legacy) : null
}

export type ReviewNextActionKind = 'conflict' | 'customer' | 'customer-name' | 'email' | 'weight' | 'portal' | 'granite' | 'check'

export type ReviewNextAction = {
  kind: ReviewNextActionKind
  title: string
  detail: string
}

export type ReviewGroupSummary = {
  causeCounts: Record<ReviewCause, number>
  blCount: number
  graniteCount: number
  /** B/Ls do grupo: todo B/L em revisão está impedido de virar fatura. */
  blockedBlCount: number
  unlinkedBlCount: number
  weightCount: number
  linkedCustomer: ReviewCustomer | null
  nextAction: ReviewNextAction
  /** 0 resolve aqui e trava fatura; 1 depende de outra tela; 2 não gera fatura. */
  priority: 0 | 1 | 2
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

export function summarizeReviewGroup(group: ReviewGroup): ReviewGroupSummary {
  const causeCounts = countReviewCauses(group.items)
  const blItems = group.items.filter((item) => item.source === 'bl')
  const graniteCount = group.items.length - blItems.length
  const unlinkedBlCount = blItems.filter(needsCustomerLink).length
  const weightCount = blItems.filter(needsWeightFix).length
  const linkedCustomer = getGroupLinkedItem(group)?.customer ?? null

  let nextAction: ReviewNextAction
  if (unlinkedBlCount > 0 && group.identityKind === 'conflict') {
    nextAction = {
      kind: 'conflict',
      title: 'Confirmar o CNPJ do cliente',
      detail: 'O B/L cita CNPJs diferentes. Escolha nas evidências o que pertence ao consignatário antes de cadastrar ou vincular.',
    }
  } else if (unlinkedBlCount > 0 && group.identityKind === 'name') {
    nextAction = {
      kind: 'customer-name',
      title: 'Identificar o cliente',
      detail: 'Nenhum CNPJ foi lido no B/L. Confira o texto original e informe o CNPJ do consignatário.',
    }
  } else if (unlinkedBlCount > 0) {
    nextAction = {
      kind: 'customer',
      title: 'Cadastrar ou vincular o cliente',
      detail: `${plural(unlinkedBlCount, 'B/L está', 'B/Ls estão')} sem cliente. O CNPJ lido no B/L é ${formatCnpj(group.cnpj)}.`,
    }
  } else if (groupNeedsEmail(group)) {
    // Motivo anterior à migration 085, que tirou o e-mail do gate: gravar o
    // contato pelo cadastro do grupo faz o servidor reavaliar o B/L.
    nextAction = {
      kind: 'email',
      title: 'Completar o e-mail do cliente',
      detail: 'O B/L foi avaliado quando o e-mail ainda era exigido. Informe o e-mail no cadastro do grupo para o sistema reavaliar.',
    }
  } else if (weightCount > 0) {
    nextAction = {
      kind: 'weight',
      title: 'Informar o peso da carga solta',
      detail: `${plural(weightCount, 'B/L está', 'B/Ls estão')} sem peso em toneladas; o cálculo das taxas depende dele.`,
    }
  } else if (causeCounts.portal > 0) {
    nextAction = {
      kind: 'portal',
      title: 'Ativar o Portal do Cliente',
      // O servidor reavalia os B/Ls do Cliente quando o Portal fica ativo e
      // quando a Liberação é concedida ou revogada (migration 167).
      detail: 'A fatura só é emitida com o Portal ativo ou com a Liberação de faturamento sem Portal. Os B/Ls saem da fila sozinhos quando um dos dois acontecer.',
    }
  } else if (blItems.length === 0) {
    nextAction = {
      kind: 'granite',
      title: 'Vincular o cliente ao Granito',
      detail: 'Granito não gera fatura: o vínculo libera o cálculo de apoio no módulo Granito.',
    }
  } else {
    nextAction = {
      kind: 'check',
      title: 'Conferir os dados do B/L',
      detail: 'A pendência não tem motivo canônico registrado. Abra a revisão do B/L e salve para o sistema recalcular.',
    }
  }

  const priority: 0 | 1 | 2 = nextAction.kind === 'granite' ? 2 : nextAction.kind === 'portal' ? 1 : 0
  return {
    causeCounts,
    blCount: blItems.length,
    graniteCount,
    blockedBlCount: blItems.length,
    unlinkedBlCount,
    weightCount,
    linkedCustomer,
    nextAction,
    priority,
  }
}

/**
 * Ordem de trabalho: primeiro o que se resolve nesta tela e trava fatura, com
 * mais B/Ls na frente; depois o que depende do Portal; por último o Granito.
 * Empate fica em ordem alfabética para a fila continuar previsível.
 */
export function sortReviewGroupsByPriority(groups: ReviewGroup[]): ReviewGroup[] {
  const summaries = new Map(groups.map((group) => [group.key, summarizeReviewGroup(group)]))
  return [...groups].sort((a, b) => {
    const sa = summaries.get(a.key)!
    const sb = summaries.get(b.key)!
    return sa.priority - sb.priority
      || sb.blockedBlCount - sa.blockedBlCount
      || a.displayName.localeCompare(b.displayName)
  })
}

/** Ordem de navegação do drawer: a mesma ordem visual dos grupos. */
export function flattenReviewGroupIds(groups: ReviewGroup[]): string[] {
  return groups.flatMap((group) => group.items.map((item) => item.id))
}

// ---------------------------------------------------------------------------
// Evidências e notas
// ---------------------------------------------------------------------------

export type ReviewEvidenceSource = 'manifesto' | 'consignatario' | 'descricao'

export const REVIEW_EVIDENCE_SOURCE_LABELS: Record<ReviewEvidenceSource, string> = {
  manifesto: 'no manifesto',
  consignatario: 'no campo consignatário',
  descricao: 'na descrição da carga',
}

export type ReviewCnpjEvidence = {
  cnpj: string
  /** B/Ls e campos onde o CNPJ aparece, para a pessoa não comparar textos soltos. */
  occurrences: Array<{ blId: string; source: ReviewEvidenceSource }>
}

/**
 * CNPJs candidatos do grupo com a origem de cada um. Usa as mesmas fontes de
 * `getReviewItemDocumentCandidates`, então não muda o agrupamento nem o gate.
 */
export function getReviewGroupCnpjEvidence(group: ReviewGroup): ReviewCnpjEvidence[] {
  const byCnpj = new Map<string, ReviewCnpjEvidence>()
  const add = (cnpj: string | null, blId: string, source: ReviewEvidenceSource) => {
    if (!cnpj) return
    const entry = byCnpj.get(cnpj) ?? { cnpj, occurrences: [] }
    if (!entry.occurrences.some((o) => o.blId === blId && o.source === source)) entry.occurrences.push({ blId, source })
    byCnpj.set(cnpj, entry)
  }
  for (const item of group.items) {
    if (item.source !== 'bl') continue
    add(canonicalizeValidCnpj(item.manifest_customer_cnpj_cpf), item.id, 'manifesto')
    for (const cnpj of extractCnpjsFromText(item.consignee_block)) add(cnpj, item.id, 'consignatario')
    for (const cnpj of extractCnpjsFromText(item.cargo_description)) add(cnpj, item.id, 'descricao')
  }
  return [...byCnpj.values()]
}

const MANAGED_NOTES_LINE = /(^|\n)Pendencias de importacao:[^\n]*$/i

/**
 * Separa as notas humanas da linha técnica que o gate regrava a cada
 * avaliação (`Pendencias de importacao: ...`). A RPC `save_bl_review` remove
 * essa linha do que recebe e a acrescenta de novo, então a tela edita só a
 * parte humana.
 */
export function splitReviewNotes(notes?: string | null): string {
  return (notes ?? '').replace(MANAGED_NOTES_LINE, '').trim()
}

/**
 * Resume as pendências que sobraram depois de uma gravação, agrupadas por
 * causa: "Portal não provisionado (3) · Peso da carga solta ausente (1)".
 */
export function summarizeRemainingPendencies(pendencias: string[][]): string | null {
  const counts = new Map<string, number>()
  for (const list of pendencias) {
    const labels = new Set(list.map(reviewReasonLabel))
    for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  if (!counts.size) return null
  return [...counts.entries()].map(([label, count]) => `${label} (${count})`).join(' · ')
}

/** Peso da carga solta em toneladas: número positivo, aceita vírgula decimal. */
export function parseWeightTon(value: string): number | null {
  const parsed = Number(value.trim().replace(',', '.'))
  return value.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function validateWeightTon(value: string): string | null {
  return parseWeightTon(value) == null ? 'Informe o peso em toneladas, maior que zero.' : null
}
