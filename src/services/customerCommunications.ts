import type {
  CustomerCommunicationNature,
  CustomerContact,
  CustomerContactPreference,
} from '../types/database'
import { canonicalizeDocument } from '../lib/cnpj'
import { sanitizeLikeTerm } from '../lib/utils'
import { operationFrontKindsForCargoMode } from './escalaTerminalAllocation'
import { normalizePortCode } from './portCode'
import { listVoyageEscalaSchedulesByVoyageIds, type VoyageEscalaSchedule } from './voyageRouteSchedules'
import { compareVoyageRailItems, getProximaEscala } from './voyageSummaries'
import { supabase } from './supabase'
import { toError } from '../lib/errors'
import { formatCommunicationDateTime, type CustomerCommunicationKind, type CustomerCommunicationTemplateInput } from './customerCommunicationTemplates'
import {
  type CommunicationBoxCode,
  type CustomerCommunicationAudience,
  type CustomerContactBoxLink,
  type CustomerCommunicationRecipient,
  resolveCustomerCommunicationRecipientsByBoxes,
  buildRecipientSnapshot,
  fetchCommunicationBoxKinds,
  type CommunicationBoxKind,
} from './customerCommunicationBoxes'

export const CUSTOMER_COMMUNICATION_NATURES: readonly CustomerCommunicationNature[] = [
  'avisos_gerais',
  'avisos_operacionais',
  'documentacao',
  'demurrage',
]

export type CustomerCommunicationExcludedReason =
  | 'preferencia_desligada'
  | 'email_ausente'
  | 'suprimido_complaint'
  | 'suprimido_bounce'

export type EmailSuppressionRow = {
  email: string
  reason?: string | null
}

export type RecipientSuppressionChannel = 'portal' | 'comunicados'

type SuppressionLookupInput = {
  channel: RecipientSuppressionChannel
  sharedSuppressions?: readonly EmailSuppressionRow[]
  communicationSuppressions?: readonly EmailSuppressionRow[]
}

export type ExcludedCustomerCommunicationRecipient = {
  contact: CustomerContact
  reason: CustomerCommunicationExcludedReason
}

export type CustomerCommunicationRecipients = {
  eligible: CustomerContact[]
  excluded: ExcludedCustomerCommunicationRecipient[]
  blocked: boolean
}

type Preference = Pick<CustomerContactPreference, 'contact_id' | 'nature' | 'enabled'>

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase()
}

function hasSuppression(
  email: string,
  suppressions: readonly EmailSuppressionRow[] | undefined,
  reason?: string,
): boolean {
  return (suppressions ?? []).some((suppression) =>
    normalizedEmail(suppression.email) === email &&
    (reason === undefined || suppression.reason === reason),
  )
}

export function getEmailSuppressionReason(
  email: string,
  input: SuppressionLookupInput,
): 'bounce_permanente' | 'complaint' | null {
  const normalized = normalizedEmail(email)

  // Bounce is global because the mailbox does not exist. A legacy complaint
  // row in the shared Portal table must not leak into Comunicados: complaints
  // are channel-specific from this foundation onward.
  if (hasSuppression(normalized, input.sharedSuppressions, 'bounce_permanente')) {
    return 'bounce_permanente'
  }

  if (
    input.channel === 'comunicados' &&
    hasSuppression(normalized, input.communicationSuppressions, 'complaint')
  ) {
    return 'complaint'
  }

  if (
    input.channel === 'portal' &&
    hasSuppression(normalized, input.sharedSuppressions, 'complaint')
  ) {
    return 'complaint'
  }

  return null
}

// ponytail: roteador legado por preferences (tabela preservada para rollback);
// produção usa caixas via resolveCustomerCommunicationRecipientsByBoxes.
export function resolveCustomerCommunicationRecipients(input: {
  contacts: readonly CustomerContact[]
  nature: CustomerCommunicationNature
  preferences: readonly Preference[]
  communicationSuppressions?: readonly EmailSuppressionRow[]
  portalSuppressions?: readonly EmailSuppressionRow[]
}): CustomerCommunicationRecipients {
  const preferences = new Map(
    input.preferences
      .filter((preference) => preference.nature === input.nature)
      .map((preference) => [preference.contact_id, preference.enabled]),
  )
  const eligible: CustomerContact[] = []
  const excluded: ExcludedCustomerCommunicationRecipient[] = []

  for (const contact of input.contacts) {
    if (preferences.get(contact.id) === false) {
      excluded.push({ contact, reason: 'preferencia_desligada' })
      continue
    }

    const email = contact.email?.trim()
    if (!email) {
      excluded.push({ contact, reason: 'email_ausente' })
      continue
    }

    const suppression = getEmailSuppressionReason(email, {
      channel: 'comunicados',
      sharedSuppressions: input.portalSuppressions,
      communicationSuppressions: input.communicationSuppressions,
    })
    if (suppression === 'complaint') {
      excluded.push({ contact, reason: 'suprimido_complaint' })
      continue
    }
    if (suppression === 'bounce_permanente') {
      excluded.push({ contact, reason: 'suprimido_bounce' })
      continue
    }

    eligible.push(contact)
  }

  return { eligible, excluded, blocked: eligible.length === 0 }
}

export type DemurrageDunningGroupableCandidate = {
  invoice_id: number
  customer_id: number
  attempt_discriminator: number
}

// D11: agrupa faturas elegíveis por cliente/ciclo (customer_id +
// attempt_discriminator) para uma mensagem por cliente/ciclo/destinatário.
// Preserva cada fatura (sem consolidar valores); dedup por invoice_id.
// Espelha groupDunningCandidatesByCustomerCycle da Edge demurrage-dunning.
export function groupDemurrageDunningByCustomerCycle<T extends DemurrageDunningGroupableCandidate>(
  candidates: readonly T[],
): T[][] {
  const groups = new Map<string, T[]>()
  for (const candidate of candidates) {
    const key = `${candidate.customer_id}:${candidate.attempt_discriminator}`
    const list = groups.get(key) ?? []
    if (!list.some((item) => item.invoice_id === candidate.invoice_id)) list.push(candidate)
    groups.set(key, list)
  }
  return [...groups.values()].map((list) =>
    list.sort((a, b) => a.invoice_id - b.invoice_id),
  )
}

export type CustomerCommunicationDispatchMode = 'carga' | 'institucional'

export type CustomerCommunicationFilters = {
  mode: CustomerCommunicationDispatchMode
  /** Navio e viagem num campo só, como no Line-up. Ver `matchesVesselVoyage`. */
  vesselVoyage: string
  pol: string
  pod: string
  cnpj: string
}

export const DEFAULT_CUSTOMER_COMMUNICATION_FILTERS: CustomerCommunicationFilters = {
  mode: 'carga',
  vesselVoyage: '',
  pol: '',
  pod: '',
  cnpj: '',
}

export const OPERATIONAL_CUSTOMER_COMMUNICATION_FILTERS = ['vesselVoyage', 'pol', 'pod'] as const

/**
 * Modelos que o operador pode disparar manualmente em `/clientes/comunicacao`,
 * agrupados pelo Recorte de Destinatários que cada um usa. `ce_mercante_taxas` e
 * `cobranca_demurrage` ficam de fora: nascem da régua automática, não do disparo.
 */
export const MANUAL_CUSTOMER_COMMUNICATION_KINDS_BY_MODE: Record<
  CustomerCommunicationDispatchMode,
  readonly CustomerCommunicationKind[]
> = {
  carga: ['aviso_chegada_noa', 'aviso_prontidao_nor', 'aviso_atracacao_nob', 'livre'],
  institucional: ['institucional'],
}

/**
 * O modo do disparo é consequência do modelo, nunca uma escolha paralela: só o
 * Comunicado institucional dispensa o recorte de carga. Manter isso derivado
 * impede que Modo e Modelo apontem para universos diferentes.
 */
export function getCustomerCommunicationDispatchMode(
  kind: CustomerCommunicationKind,
): CustomerCommunicationDispatchMode {
  return kind === 'institucional' ? 'institucional' : 'carga'
}

/** Modelos cujo assunto e mensagem são escritos pelo operador no momento do disparo. */
export function isUserWrittenCustomerCommunicationKind(kind: CustomerCommunicationKind): boolean {
  return kind === 'institucional' || kind === 'livre'
}

/** Primeiro modelo manual de um modo; usado quando o operador troca de modo. */
export function getDefaultCustomerCommunicationKind(
  mode: CustomerCommunicationDispatchMode,
): CustomerCommunicationKind {
  return MANUAL_CUSTOMER_COMMUNICATION_KINDS_BY_MODE[mode][0] ?? 'aviso_chegada_noa'
}

export type CustomerCommunicationAudienceRule = {
  /** Só o Comunicado livre deixa o operador escolher o público. */
  editable: boolean
  audience: CustomerCommunicationAudience
  /** Motivo exibido na tela quando o público é imposto pelo modelo. */
  reason: string
}

const DEFAULT_OPERATIONAL_BOX: CommunicationBoxCode = 'documentacao_operacao'

/**
 * Público de cada modelo. Avisos operacionais vão sempre para a caixa
 * Documentação e Operação, o institucional alcança todos os contatos e só o
 * livre é aberto à escolha do operador.
 */
export function getCustomerCommunicationAudienceRule(
  kind: CustomerCommunicationKind,
): CustomerCommunicationAudienceRule {
  if (kind === 'institucional') {
    return { editable: false, audience: { mode: 'todos' }, reason: 'O institucional alcança todos os contatos do Cliente Comunicável.' }
  }
  if (kind === 'livre') {
    return { editable: true, audience: { mode: 'todos' }, reason: 'Escolha entre todos os contatos ou uma Caixa de Comunicação.' }
  }
  return {
    editable: false,
    audience: { mode: 'caixa', boxCode: DEFAULT_OPERATIONAL_BOX },
    reason: 'Avisos operacionais seguem sempre para a caixa Documentação e Operação.',
  }
}

/**
 * Um disparo institucional ou livre carrega `dispatch_id` novo a cada lote, então
 * cada envio é uma mensagem diferente e nunca o reenvio do mesmo Comunicado. Só os
 * modelos ancorados em carga (NOA/NOR/NOB) exigem a confirmação de reenvio.
 */
export function requiresResendConfirmation(kind: CustomerCommunicationKind): boolean {
  return !isUserWrittenCustomerCommunicationKind(kind)
}

export type CustomerCommunicationBlCandidate = {
  id: string
  customerId: number
  customerName: string
  customerCnpj: string
  voyageId: number
  vesselName: string
  voyageNumber: string
  pod: string
  pol: string
  cargoMode: string
  /** Exceção de terminal do B/L (`bls.terminal_id`, ADR 0068): vence a frente no NOB. */
  terminalOverrideId?: string | null
  eta: string | null
  ata: string | null
  terminalId: string | null
  terminalName: string | null
  terminalStateId: string | null
  milestoneAt: string | null
}

export type CustomerCommunicationHistoryMatch = {
  customerId: number
  kind: string
  anchorVoyageId: number | null
  anchorPort: string | null
  anchorAtracacaoId: string | null
  anchorInvoiceId: number | null
  attemptDiscriminator: number
}

export type CustomerCommunicationConferenceRow = {
  key: string
  customerId: number
  customerName: string
  customerCnpj: string
  terminalId: string | null
  terminalName: string | null
  bls: CustomerCommunicationBlCandidate[]
  sourceBls: CustomerCommunicationBlCandidate[]
  eligibleRecipients: (CustomerContact & Partial<CustomerCommunicationRecipient>)[]
  excludedRecipients: ExcludedCustomerCommunicationRecipient[]
  blocked: boolean
  /** Motivo do bloqueio que não vem dos contatos (ex.: NOB com terminal sem sigla). */
  blockedReason?: string | null
  selected: boolean
  nextAttemptDiscriminator: number
  /**
   * Institucional e livre: quantos Comunicados deste modelo o Cliente já tem —
   * no livre, só os da mesma Viagem. É o rótulo "N envio(s) anterior(es)"; o
   * discriminador continua contado por Cliente, como a identidade no servidor.
   */
  previousDispatchCount?: number
  renderInput: CustomerCommunicationTemplateInput
  audience?: CustomerCommunicationAudience
  recipientSnapshot?: string
}

export type CustomerCommunicationConference = {
  kind: CustomerCommunicationKind
  nature: CustomerCommunicationNature
  mode: CustomerCommunicationDispatchMode
  audience?: CustomerCommunicationAudience
  rows: CustomerCommunicationConferenceRow[]
  totalCustomers: number
  totalEligibleEmails: number
  totalExcludedEmails: number
  blockedCustomers: CustomerCommunicationConferenceRow[]
  excludedReasonCounts: Record<CustomerCommunicationExcludedReason, number>
  unassignedOperationFronts?: boolean
}

export type CommunicationFilterValidation = {
  valid: boolean
  message: string | null
}

function cleanFilter(value: string | null | undefined): string {
  return value?.trim() ?? ''
}

function normalizedUpper(value: string | null | undefined): string {
  return cleanFilter(value).toUpperCase()
}

function matchesFilter(value: string | null | undefined, filter: string): boolean {
  const normalizedFilter = normalizedUpper(filter)
  if (!normalizedFilter) return true
  return normalizedUpper(value).includes(normalizedFilter)
}

/**
 * Navio e viagem casam contra "NAVIO VIAGEM" concatenado, e cada termo digitado
 * precisa aparecer. Assim "XING WANG 2401E" acha a viagem 2401E do COSCO SHIPPING XING WANG,
 * "XING WANG" sozinho acha todas as dela e "2401E" sozinho acha a viagem em
 * qualquer navio — que é o que o operador espera de uma busca só.
 */
function matchesVesselVoyage(vessel: string | null | undefined, voyage: string | null | undefined, filter: string): boolean {
  const terms = normalizedUpper(filter)
    .replace(/[/,]/g, ' ')
    .replace(/\s+-\s+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (!terms.length) return true
  const haystack = `${normalizedUpper(vessel)} ${normalizedUpper(voyage)}`
  return terms.every((term) => haystack.includes(term))
}

/**
 * Porto como a régua o compara (`normalize_port_code`): BRVIT e BRVIX são o
 * mesmo porto. Código fora do catálogo fica em maiúsculas, como no banco.
 */
export function communicationPortCode(value: string | null | undefined): string | null {
  return normalizePortCode(value) ?? (normalizedUpper(value) || null)
}

function samePort(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = communicationPortCode(left)
  const b = communicationPortCode(right)
  return Boolean(a && b && a === b)
}

export function validateCustomerCommunicationFilters(filters: CustomerCommunicationFilters): CommunicationFilterValidation {
  if (filters.mode === 'institucional') return { valid: true, message: null }
  const hasOperationalFilter = OPERATIONAL_CUSTOMER_COMMUNICATION_FILTERS.some((key) => Boolean(cleanFilter(filters[key])))
  return hasOperationalFilter
    ? { valid: true, message: null }
    : { valid: false, message: 'No modo carga, informe ao menos um filtro operacional: navio/viagem, POL ou POD.' }
}

export function filterCustomerCommunicationBls(
  rows: readonly CustomerCommunicationBlCandidate[],
  filters: CustomerCommunicationFilters,
): CustomerCommunicationBlCandidate[] {
  return rows.filter((row) => {
    if (filters.mode === 'carga') {
      if (!matchesVesselVoyage(row.vesselName, row.voyageNumber, filters.vesselVoyage)) return false
      if (!matchesFilter(row.pol, filters.pol)) return false
      if (!matchesFilter(row.pod, filters.pod)) return false
    }
    if (cleanFilter(filters.cnpj) && canonicalizeDocument(row.customerCnpj) !== canonicalizeDocument(filters.cnpj)) return false
    return true
  })
}

function subtractMonths(value: Date, months: number): Date {
  const result = new Date(value.getTime())
  result.setUTCMonth(result.getUTCMonth() - months)
  return result
}

/** Cliente comunicável tem carga recente; carga futura também é válida. */
export function isInstitutionalCustomerCommunicable(
  rows: readonly CustomerCommunicationBlCandidate[],
  now = new Date(),
): boolean {
  const lowerBound = subtractMonths(now, 12).getTime()
  return rows.some((row) => {
    if (!row.eta) return false
    const eta = new Date(row.eta).getTime()
    return !Number.isNaN(eta) && eta >= lowerBound
  })
}

function communicationNatureForKind(kind: CustomerCommunicationKind, nature?: CustomerCommunicationNature): CustomerCommunicationNature {
  if (kind === 'aviso_chegada_noa' || kind === 'aviso_prontidao_nor' || kind === 'aviso_atracacao_nob') return 'avisos_operacionais'
  if (kind === 'ce_mercante_taxas') return 'documentacao'
  if (kind === 'cobranca_demurrage') return 'demurrage'
  if (kind === 'institucional') return 'avisos_gerais'
  return nature ?? 'avisos_gerais'
}

export function getCustomerCommunicationNature(kind: CustomerCommunicationKind, nature?: CustomerCommunicationNature): CustomerCommunicationNature {
  return communicationNatureForKind(kind, nature)
}

function candidateIdentity(row: CustomerCommunicationBlCandidate, kind: CustomerCommunicationKind): string {
  if (kind === 'institucional') return String(row.customerId)
  // D15: o livre leva Navio, Viagem e B/Ls, então sai um e-mail por Cliente e
  // Viagem — o Cliente com carga em duas viagens recebe dois.
  if (kind === 'livre') return `${row.customerId}:${row.voyageId}`
  if (kind === 'aviso_atracacao_nob') {
    return `${row.customerId}:${row.voyageId}:${communicationPortCode(row.pod) ?? ''}:${row.terminalStateId ?? 'terminal-state-sem-identidade'}`
  }
  return `${row.customerId}:${row.voyageId}:${communicationPortCode(row.pod) ?? ''}`
}

function historyMatchesRow(
  history: CustomerCommunicationHistoryMatch,
  row: { customerId: number; terminalStateId: string | null; pod: string; voyageId: number },
  kind: CustomerCommunicationKind,
): boolean {
  return history.kind === kind
    && history.customerId === row.customerId
    && history.anchorVoyageId === row.voyageId
    && samePort(history.anchorPort, row.pod)
    && (kind !== 'aviso_atracacao_nob' || history.anchorAtracacaoId === row.terminalStateId)
}

function nextAttemptDiscriminator(
  rows: readonly CustomerCommunicationHistoryMatch[],
  candidate: CustomerCommunicationBlCandidate,
  kind: CustomerCommunicationKind,
): number {
  const matching = rows.filter((history) => historyMatchesRow(history, candidate, kind))
  if (!matching.length) return 0
  return Math.max(...matching.map((history) => history.attemptDiscriminator)) + 1
}

function nextInstitutionalAttemptDiscriminator(
  rows: readonly CustomerCommunicationHistoryMatch[],
  customerId: number,
  kind: CustomerCommunicationKind,
): number {
  const matching = rows.filter((history) => history.kind === kind && history.customerId === customerId)
  if (!matching.length) return 0
  return Math.max(...matching.map((history) => history.attemptDiscriminator)) + 1
}

/** Envios anteriores do institucional (por Cliente) e do livre (por Cliente e Viagem, D15). */
function previousUserWrittenDispatchCount(
  rows: readonly CustomerCommunicationHistoryMatch[],
  candidate: { customerId: number; voyageId: number },
  kind: CustomerCommunicationKind,
): number {
  return rows.filter((history) => history.kind === kind
    && history.customerId === candidate.customerId
    && (kind !== 'livre' || history.anchorVoyageId === candidate.voyageId)).length
}

export function makeCustomerCommunicationRenderInput(
  row: CustomerCommunicationBlCandidate,
  bls: readonly CustomerCommunicationBlCandidate[],
  institutional: boolean,
): CustomerCommunicationTemplateInput {
  return {
    customerId: row.customerId,
    customerName: row.customerName,
    vesselName: row.vesselName,
    voyageNumber: row.voyageNumber,
    port: row.pod,
    terminalName: row.terminalName,
    terminalId: row.terminalId,
    terminalStateId: row.terminalStateId,
    milestoneAt: row.milestoneAt ?? row.eta ?? '',
    bls: institutional
      ? []
      : bls.map((bl) => ({
        id: bl.id,
        customerId: bl.customerId,
        terminalId: bl.terminalId,
        terminalStateId: bl.terminalStateId,
      })),
  }
}

export function buildCustomerCommunicationConference(input: {
  kind: CustomerCommunicationKind
  nature?: CustomerCommunicationNature
  mode: CustomerCommunicationDispatchMode
  audience?: CustomerCommunicationAudience
  candidates: readonly CustomerCommunicationBlCandidate[]
  contactsByCustomer: ReadonlyMap<number, readonly CustomerContact[]>
  preferences?: readonly Preference[]
  boxLinks?: readonly CustomerContactBoxLink[]
  boxKinds?: readonly CommunicationBoxKind[]
  communicationSuppressions?: readonly EmailSuppressionRow[]
  portalSuppressions?: readonly EmailSuppressionRow[]
  history?: readonly CustomerCommunicationHistoryMatch[]
  unassignedOperationFronts?: boolean
  now?: Date
}): CustomerCommunicationConference {
  const nature = communicationNatureForKind(input.kind, input.nature)
  const grouped = new Map<string, CustomerCommunicationBlCandidate[]>()

  for (const candidate of input.candidates) {
    const key = candidateIdentity(candidate, input.kind)
    const current = grouped.get(key) ?? []
    if (!current.some((existing) => existing.id === candidate.id && existing.terminalStateId === candidate.terminalStateId)) current.push(candidate)
    grouped.set(key, current)
  }

  const rows: CustomerCommunicationConferenceRow[] = []
  for (const candidates of grouped.values()) {
    const first = candidates[0]
    if (!first) continue
    const sourceBls = candidates.slice()
    const institutional = input.kind === 'institucional'
    if (institutional && !isInstitutionalCustomerCommunicable(sourceBls, input.now)) continue

    const customerContacts = [...(input.contactsByCustomer.get(first.customerId) ?? [])]
    let recipients: {
      eligible: (CustomerContact & Partial<CustomerCommunicationRecipient>)[]
      excluded: ExcludedCustomerCommunicationRecipient[]
      blocked: boolean
    }

    if (input.boxLinks !== undefined) {
      const boxResult = resolveCustomerCommunicationRecipientsByBoxes({
        contacts: customerContacts,
        boxLinks: input.boxLinks,
        boxKinds: input.boxKinds,
        kind: input.kind,
        audience: input.audience,
        communicationSuppressions: input.communicationSuppressions,
        portalSuppressions: input.portalSuppressions,
      })
      recipients = {
        eligible: boxResult.eligible,
        excluded: boxResult.excluded as ExcludedCustomerCommunicationRecipient[],
        blocked: boxResult.blocked,
      }
    } else {
      recipients = resolveCustomerCommunicationRecipients({
        contacts: customerContacts,
        nature,
        preferences: (input.preferences ?? []).filter((preference) => customerContacts.some((contact) => contact.id === preference.contact_id)),
        communicationSuppressions: input.communicationSuppressions,
        portalSuppressions: input.portalSuppressions,
      })
    }

    const recipientSnapshot = buildRecipientSnapshot({
      customerId: first.customerId,
      kind: input.kind,
      audience: input.audience,
      recipients: recipients.eligible as readonly CustomerCommunicationRecipient[],
    })

    const anchorRow = institutional ? { ...first, milestoneAt: null } : first
    // O NOB sem a sigla do terminal é recusado pela Edge ("O terminal da
    // Atracação está sem sigla cadastrada."): a conferência já o mostra
    // bloqueado, com o motivo, em vez de deixá-lo falhar no disparo.
    const blockedReason = input.kind === 'aviso_atracacao_nob' && !first.terminalName?.trim()
      ? 'Terminal da Atracação sem sigla cadastrada.'
      : null
    const blocked = recipients.blocked || blockedReason !== null
    rows.push({
      key: `${input.kind}:${candidateIdentity(first, input.kind)}`,
      customerId: first.customerId,
      customerName: first.customerName,
      customerCnpj: first.customerCnpj,
      terminalId: input.kind === 'aviso_atracacao_nob' ? first.terminalId : null,
      terminalName: input.kind === 'aviso_atracacao_nob' ? first.terminalName : null,
      bls: institutional ? [] : candidates,
      sourceBls,
      eligibleRecipients: recipients.eligible,
      excludedRecipients: recipients.excluded,
      blocked,
      blockedReason,
      selected: !blocked,
      audience: input.audience,
      recipientSnapshot,
      nextAttemptDiscriminator: input.kind === 'institucional' || input.kind === 'livre'
        ? nextInstitutionalAttemptDiscriminator(input.history ?? [], first.customerId, input.kind)
        : nextAttemptDiscriminator(input.history ?? [], first, input.kind),
      ...(input.kind === 'institucional' || input.kind === 'livre'
        ? { previousDispatchCount: previousUserWrittenDispatchCount(input.history ?? [], first, input.kind) }
        : {}),
      renderInput: makeCustomerCommunicationRenderInput(anchorRow, candidates, institutional),
    })
  }

  const excludedReasonCounts: Record<CustomerCommunicationExcludedReason, number> = {
    preferencia_desligada: 0,
    email_ausente: 0,
    suprimido_complaint: 0,
    suprimido_bounce: 0,
  }
  for (const row of rows) for (const excluded of row.excludedRecipients) excludedReasonCounts[excluded.reason] += 1

  return {
    kind: input.kind,
    nature,
    mode: input.mode,
    rows,
    totalCustomers: new Set(rows.map((row) => row.customerId)).size,
    totalEligibleEmails: rows.reduce((sum, row) => sum + row.eligibleRecipients.length, 0),
    totalExcludedEmails: rows.reduce((sum, row) => sum + row.excludedRecipients.length, 0),
    blockedCustomers: rows.filter((row) => row.blocked),
    excludedReasonCounts,
    unassignedOperationFronts: input.unassignedOperationFronts ?? false,
  }
}

export type RawCommunicationBlRow = {
  id: string
  voyage_id: number
  customer_id: number | null
  pod: string | null
  pol: string | null
  cargo_mode: string
  terminal_id?: string | null
  cancelled_at?: string | null
  financial_status?: string | null
  customer: { id: number; name: string; cnpj_cpf: string; deactivated_at?: string | null } | null
  voyage: { id: number; voyage_number: string; eta: string | null; ata: string | null; status?: string | null; vessel: { name: string } | null } | null
}

/**
 * Elegibilidade igual à da régua automática (plano dos e-mails, 3.4 com 1C.3 e
 * 1C.4): B/L cancelado (`cancelled_at` ou `financial_status`), Cliente
 * desativado e Viagem cancelada não entram na conferência manual.
 */
export function toBaseCandidate(row: RawCommunicationBlRow): CustomerCommunicationBlCandidate | null {
  if (!row.customer_id || !row.customer || !row.voyage) return null
  if (!row.pod?.trim()) return null
  if (row.cancelled_at || row.financial_status === 'cancelled') return null
  if (row.customer.deactivated_at) return null
  if (row.voyage.status === 'cancelled') return null
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer.name,
    customerCnpj: row.customer.cnpj_cpf,
    voyageId: row.voyage_id,
    vesselName: row.voyage.vessel?.name ?? '',
    voyageNumber: row.voyage.voyage_number,
    pod: row.pod,
    pol: row.pol ?? '',
    cargoMode: row.cargo_mode,
    terminalOverrideId: row.terminal_id ?? null,
    eta: row.voyage.eta,
    ata: row.voyage.ata,
    terminalId: null,
    terminalName: null,
    terminalStateId: null,
    milestoneAt: null,
  }
}

function scheduleForCandidate(row: CustomerCommunicationBlCandidate, schedules: readonly VoyageEscalaSchedule[]): VoyageEscalaSchedule | null {
  return schedules.find((schedule) => samePort(schedule.port, row.pod)) ?? null
}

/**
 * Chave de uma Frente de Operação atribuída: identifica que a carga de um dado
 * `cargo_mode` foi descarregada NAQUELE terminal, naquela escala. É o que
 * separa os clientes de uma Atracação dos da Atracação vizinha.
 */
function operationFrontKey(voyageId: number, port: string, terminalId: string, modalidade: string): string {
  return `${voyageId}::${communicationPortCode(port) ?? ''}::${terminalId}::${modalidade}`
}

/**
 * Frentes de importação com terminal atribuído, para as viagens do recorte.
 * Espelha o filtro que `evaluate_and_dispatch_automatic_communications` aplica
 * no NOB automático — conferência manual e régua precisam ver o mesmo público.
 */
export async function fetchAssignedOperationFrontKeys(voyageIds: readonly number[]): Promise<Set<string>> {
  const keys = new Set<string>()
  if (!voyageIds.length) return keys
  for (let from = 0; from < voyageIds.length; from += 25) {
    const { data, error } = await supabase
      .from('voyage_escala_operation_fronts')
      .select('voyage_id, port, terminal_id, sentido, modalidade')
      .in('voyage_id', voyageIds.slice(from, from + 25))
    if (error) throw error
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      if (row.sentido !== 'importacao') continue
      if (typeof row.voyage_id !== 'number' || typeof row.port !== 'string') continue
      if (typeof row.terminal_id !== 'string' || typeof row.modalidade !== 'string') continue
      keys.add(operationFrontKey(row.voyage_id, row.port, row.terminal_id, row.modalidade))
    }
  }
  return keys
}

export function expandCandidatesForKind(
  rows: readonly CustomerCommunicationBlCandidate[],
  schedulesByVoyage: ReadonlyMap<number, readonly VoyageEscalaSchedule[]>,
  kind: CustomerCommunicationKind,
  /**
   * Frentes atribuídas, só consultadas no NOB. `undefined` significa "não
   * consultado" e mantém o comportamento antigo para chamadores que não
   * precisam do recorte por terminal.
   */
  assignedFrontKeys?: ReadonlySet<string>,
): CustomerCommunicationBlCandidate[] {
  const expanded: CustomerCommunicationBlCandidate[] = []
  for (const row of rows) {
    const schedule = scheduleForCandidate(row, schedulesByVoyage.get(row.voyageId) ?? [])
    if (kind === 'livre') {
      if (schedule?.deleted || schedule?.omitted) continue
      expanded.push({
        ...row,
        eta: schedule?.eta ?? row.eta,
        ata: schedule?.ata ?? row.ata,
        milestoneAt: null,
      })
      continue
    }
    // POD excluído com a escala viva por POL ou exportação: a régua também
    // não comunica (customer_communication_scale_schedules, migration 318).
    if (!schedule || schedule.deleted || schedule.podDeleted || schedule.omitted) continue
    if (kind === 'aviso_atracacao_nob') {
      for (const atracacao of schedule.atracacoes) {
        // NOB is anchored by the state row UUID, never by the terminal UUID.
        // A missing state identity is not safe to turn into a dispatch.
        if (!atracacao.terminalId || !atracacao.stateId || !atracacao.atb) continue
        // Regra única do NOB (ADR 0068, item 7), espelho de
        // `bl_belongs_to_atracacao` (migration 243): a exceção de terminal do
        // B/L vence a frente; sem ela, o B/L entra pela Frente de Operação da
        // sua modalidade naquele terminal, e o misto precisa das duas. Quem
        // descarregou no berço vizinho não entra neste NOB.
        const terminalId = atracacao.terminalId
        if (row.terminalOverrideId) {
          if (row.terminalOverrideId !== terminalId) continue
        } else if (assignedFrontKeys) {
          const kinds = operationFrontKindsForCargoMode(row.cargoMode)
          if (kinds.length === 0 || !kinds.every((kind) =>
            assignedFrontKeys.has(operationFrontKey(row.voyageId, row.pod ?? '', terminalId, kind)),
          )) continue
        }
        expanded.push({
          ...row,
          terminalId: atracacao.terminalId,
          // O cliente lê a sigla do terminal (depots.code, obrigatória). Sem
          // ela o NOB fica sem terminal e o envio é recusado com "Terminal
          // ausente para o NOB." — nunca com o UUID do terminal no e-mail.
          terminalName: atracacao.terminalCode?.trim() || null,
          terminalStateId: atracacao.stateId,
          milestoneAt: atracacao.atb,
        })
      }
      continue
    }

    const milestoneAt = kind === 'aviso_prontidao_nor' ? schedule.ata : schedule.eta
    if (!milestoneAt) continue
    expanded.push({
      ...row,
      eta: schedule.eta,
      ata: schedule.ata,
      milestoneAt,
    })
  }
  return expanded
}

const COMMUNICATION_BL_SELECT = 'id, voyage_id, customer_id, pod, pol, cargo_mode, terminal_id, cancelled_at, financial_status, customer:customers!bls_customer_id_fkey(id, name, cnpj_cpf, deactivated_at), voyage:voyages(id, voyage_number, eta, ata, status, vessel:vessels(name))'

/**
 * Viagens cujo "NAVIO VIAGEM" casa com o filtro de navio/viagem. A lista de
 * viagens é muito menor que a de B/Ls; com ela o recorte da carga sai do
 * servidor em vez de ler todos os B/Ls (plano dos e-mails, 3.7).
 */
async function fetchVoyageIdsMatching(filter: string): Promise<number[]> {
  const ids: number[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('voyages')
      .select('id, voyage_number, vessel:vessels(name)')
      .order('id', { ascending: true })
      .range(from, from + 999)
      .overrideTypes<Array<{ id: number; voyage_number: string; vessel: { name: string } | null }>, { merge: false }>()
    if (error) throw error
    for (const voyage of data ?? []) {
      if (matchesVesselVoyage(voyage.vessel?.name, voyage.voyage_number, filter)) ids.push(voyage.id)
    }
    if (!data || data.length < 1000) break
  }
  return ids
}

// ponytail: o recorte por navio/viagem, POL e POD sai do servidor; o CNPJ e a
// regra fina (`filterCustomerCommunicationBls`) continuam no navegador. O modo
// institucional ainda lê todos os B/Ls ativos — o Cliente Comunicável depende
// do ETA da escala; o próximo passo seria uma RPC com essa regra.
export async function fetchCommunicationBlRows(filters?: CustomerCommunicationFilters): Promise<RawCommunicationBlRow[]> {
  const cargo = filters?.mode === 'carga'
  let voyageIds: number[] | null = null
  if (cargo && cleanFilter(filters.vesselVoyage)) {
    voyageIds = await fetchVoyageIdsMatching(filters.vesselVoyage)
    if (!voyageIds.length) return []
  }
  const voyageChunks = voyageIds ? Array.from({ length: Math.ceil(voyageIds.length / 100) }, (_, index) => voyageIds!.slice(index * 100, index * 100 + 100)) : [null]
  const rows: RawCommunicationBlRow[] = []
  for (const chunk of voyageChunks) {
    for (let from = 0; ; from += 500) {
      let query = supabase
        .from('bls')
        .select(COMMUNICATION_BL_SELECT)
        .is('cancelled_at', null)
      if (chunk) query = query.in('voyage_id', chunk)
      if (cargo) {
        const pol = sanitizeLikeTerm(filters.pol)
        const pod = sanitizeLikeTerm(filters.pod)
        if (pol) query = query.ilike('pol', `%${pol}%`)
        if (pod) query = query.ilike('pod', `%${pod}%`)
      }
      const { data, error } = await query
        .order('id', { ascending: true })
        .range(from, from + 499)
        .overrideTypes<RawCommunicationBlRow[], { merge: false }>()
      if (error) throw error
      rows.push(...(data ?? []))
      if (!data || data.length < 500) break
    }
  }
  return rows
}

async function fetchCommunicationContacts(customerIds: readonly number[]): Promise<{
  contactsByCustomer: Map<number, CustomerContact[]>
  boxLinks: CustomerContactBoxLink[]
}> {
  const contactsByCustomer = new Map<number, CustomerContact[]>()
  const boxLinks: CustomerContactBoxLink[] = []
  for (let from = 0; from < customerIds.length; from += 100) {
    const ids = customerIds.slice(from, from + 100)
    const { data: contacts, error: contactsError } = await supabase
      .from('customer_contacts')
      .select('*')
      .in('customer_id', ids)
      .order('id', { ascending: true })
    if (contactsError) throw contactsError
    for (const contact of contacts ?? []) {
      if (contact.customer_id == null) continue
      const list = contactsByCustomer.get(contact.customer_id) ?? []
      list.push(contact)
      contactsByCustomer.set(contact.customer_id, list)
    }
  }
  const contactIds = [...contactsByCustomer.values()].flatMap((contacts) => contacts.map((contact) => contact.id))
  for (let from = 0; from < contactIds.length; from += 100) {
    const ids = contactIds.slice(from, from + 100)
    const { data, error } = await supabase
      .from('customer_contact_box_links')
      .select('contact_id, box_code')
      .in('contact_id', ids)
    if (error) throw error
    boxLinks.push(...((data as CustomerContactBoxLink[]) ?? []))
  }
  return { contactsByCustomer, boxLinks }
}

async function fetchCommunicationHistory(customerIds: readonly number[], kind: CustomerCommunicationKind): Promise<CustomerCommunicationHistoryMatch[]> {
  if (!customerIds.length) return []
  const history: CustomerCommunicationHistoryMatch[] = []
  for (let from = 0; from < customerIds.length; from += 100) {
    const { data, error } = await supabase
      .from('customer_communications')
      .select('customer_id, kind, anchor_voyage_id, anchor_port, anchor_atracacao_id, anchor_invoice_id, attempt_discriminator')
      .eq('kind', kind)
      .in('customer_id', customerIds.slice(from, from + 100))
    if (error) throw error
    history.push(...(data ?? []).map((row) => ({
      customerId: row.customer_id,
      kind: row.kind,
      anchorVoyageId: row.anchor_voyage_id,
      anchorPort: row.anchor_port,
      anchorAtracacaoId: row.anchor_atracacao_id,
      anchorInvoiceId: row.anchor_invoice_id,
      attemptDiscriminator: row.attempt_discriminator,
    })))
  }
  return history
}

export async function fetchCustomerCommunicationConference(input: {
  filters: CustomerCommunicationFilters
  kind: CustomerCommunicationKind
  nature?: CustomerCommunicationNature
  audience?: CustomerCommunicationAudience
  now?: Date
}): Promise<CustomerCommunicationConference> {
  const validation = validateCustomerCommunicationFilters(input.filters)
  if (!validation.valid) throw new Error(validation.message ?? 'Filtros inválidos.')

  const rawRows = await fetchCommunicationBlRows(input.filters)
  const baseRows = rawRows.flatMap((row) => {
    const candidate = toBaseCandidate(row)
    return candidate ? [candidate] : []
  })
  const voyageIds = [...new Set(baseRows.map((row) => row.voyageId))]
  const schedulesByVoyage = input.kind === 'institucional' || input.kind === 'livre' || input.kind === 'aviso_chegada_noa' || input.kind === 'aviso_prontidao_nor' || input.kind === 'aviso_atracacao_nob'
    ? await listVoyageEscalaSchedulesByVoyageIds(voyageIds)
    : new Map<number, VoyageEscalaSchedule[]>()
  const operationalKind = input.filters.mode === 'institucional' ? 'aviso_chegada_noa' : input.kind
  const assignedFrontKeys = operationalKind === 'aviso_atracacao_nob'
    ? await fetchAssignedOperationFrontKeys(voyageIds)
    : undefined
  const expanded = expandCandidatesForKind(baseRows, schedulesByVoyage, operationalKind, assignedFrontKeys)
  const filtered = filterCustomerCommunicationBls(expanded, input.filters)
  let unassignedOperationFronts = false
  if (operationalKind === 'aviso_atracacao_nob' && filtered.length === 0) {
    const unassignedExpanded = expandCandidatesForKind(baseRows, schedulesByVoyage, operationalKind, undefined)
    const unassignedFiltered = filterCustomerCommunicationBls(unassignedExpanded, input.filters)
    if (unassignedFiltered.length > 0) {
      unassignedOperationFronts = true
    }
  }
  const customerIds = [...new Set(filtered.map((row) => row.customerId))]
  const [{ contactsByCustomer, boxLinks }, boxKinds] = await Promise.all([
    fetchCommunicationContacts(customerIds),
    fetchCommunicationBoxKinds(input.kind),
  ])
  // (ponytail: supressoes filtradas por e-mail em vez de full-scan — a tabela
  // estoura max_rows=1000 e truncava; o last-mile filtrado na edge evita envio
  // errado, mas a conferencia mentia. Upgrade seria RPC com filtro server-side.)
  const contactEmails = [...new Set(
    [...contactsByCustomer.values()].flatMap((contacts) =>
      contacts.flatMap((c) => {
        const email = String((c as { email?: unknown }).email ?? '').trim()
        return email ? [email, email.toLowerCase()] : []
      }),
    ),
  )]
  async function fetchSuppressionsFiltered(table: 'portal_suppressed_emails' | 'customer_communication_suppressions') {
    if (!contactEmails.length) return [] as Array<{ email: string; reason: string | null }>
    const rows: Array<{ email: string; reason: string | null }> = []
    for (let from = 0; from < contactEmails.length; from += 100) {
      const { data, error } = await supabase.from(table).select('email, reason').in('email', contactEmails.slice(from, from + 100))
      if (error) throw error
      rows.push(...((data ?? []) as Array<{ email: string; reason: string | null }>))
    }
    return rows
  }
  const [portalSuppressions, communicationSuppressions] = await Promise.all([
    fetchSuppressionsFiltered('portal_suppressed_emails'),
    fetchSuppressionsFiltered('customer_communication_suppressions'),
  ])
  const history = await fetchCommunicationHistory(customerIds, input.kind)

  return buildCustomerCommunicationConference({
    kind: input.kind,
    nature: input.nature,
    mode: input.filters.mode,
    audience: input.audience,
    candidates: filtered,
    contactsByCustomer,
    boxLinks,
    boxKinds,
    portalSuppressions: portalSuppressions ?? [],
    communicationSuppressions: communicationSuppressions ?? [],
    history,
    unassignedOperationFronts,
    now: input.now,
  })
}

export type CustomerCommunicationAttemptHistory = {
  id: number
  recipient_masked: string
  /** E-mail exato do envio (migration 451); nulo nos envios anteriores e depois da retenção de 1 ano. */
  recipient_email?: string | null
  dispatch_mode: 'real' | 'simulado'
  status: string
  retry_count: number
  provider_message_id: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export type CustomerCommunicationAttachmentHistory = {
  id: number
  file_name: string
  mime_type: string
  storage_path: string
  size_bytes: number
  created_at: string
}

export type CustomerCommunicationHistoryItem = {
  id: number
  customer_id: number
  kind: string
  nature: string
  anchor_voyage_id: number | null
  anchor_port: string | null
  anchor_atracacao_id: string | null
  anchor_invoice_id: number | null
  attempt_discriminator: number
  status: string
  dispatch_id: string | null
  vessel_name: string | null
  voyage_number: string | null
  terminal_name: string | null
  created_by: string | null
  origin?: 'manual' | 'automatico'
  created_at: string
  customer: { id: number; name: string; cnpj_cpf: string } | null
  attempts: CustomerCommunicationAttemptHistory[]
  bl_links: Array<{ bl_id: string }>
  attachments: CustomerCommunicationAttachmentHistory[]
}

export type CustomerCommunicationHistoryFilters = {
  id?: number
  customerId?: number
  /** Comunicados vinculados a este B/L (o alerta de reenvio do CE abre por B/L). */
  blId?: string
  voyageId?: number
  vessel?: string
  month?: string
  kind?: string
  status?: string | ''
  origin?: string
}

/**
 * Uma linha da Cobertura: navio/viagem × porto de descarga (POD), porque o
 * envio é por escala. `port` é nulo só na viagem sem B/L com cliente.
 *
 * `finance` (CE e Taxas): `sent` são os Clientes enviados que continuam em
 * dia (prontos agora), `due` os devidos (prontos agora ou já enviados) e
 * `resend` os enviados que deixaram de estar prontos — em geral, B/L novo
 * ainda sem fatura depois do envio, o mesmo caso do alerta
 * `comunicado_ce_reenvio_pendente`. `sent` nunca passa de `due` (o "5 de 4"
 * da sessão de 2026-10-20). `pending` são os Clientes que ainda não podem
 * receber (sem CE ou sem fatura).
 */
export type VoyageCommunicationCoverageSummary = {
  voyageId: number
  vesselName: string
  voyageNumber: string
  port: string | null
  customers: number
  noa: { sent: number; total: number }
  nor: { sent: number; total: number }
  nob: { sent: number; total: number }
  finance: { sent: number; due: number; resend: number; ready: number; total: number; pending: number }
  /** Quantos Clientes a próxima rodada automática vai enviar, por modelo (migration 345). */
  queued: Record<CoverageKind, number>
  /** Drill-down da linha: cada Cliente do porto e a situação de cada modelo. */
  details: CoverageCustomerDetail[]
}

export type CoverageKind = 'ce_mercante_taxas' | 'aviso_chegada_noa' | 'aviso_prontidao_nor' | 'aviso_atracacao_nob'
export const COVERAGE_KINDS: readonly CoverageKind[] = ['ce_mercante_taxas', 'aviso_chegada_noa', 'aviso_prontidao_nor', 'aviso_atracacao_nob']

/** Prontidão do CE e Taxas de um Cliente na viagem (`customer_local_charges_communication_readiness`). */
export type CoverageReadiness = {
  ready: boolean
  bls: ReadonlyArray<{ blocked_reasons?: readonly string[] | null }>
}

/** Linha de `customer_communication_queue_preview` (migration 345). */
export type CoverageQueueRow = {
  kind: string
  customer_id: number
  voyage_id: number
  port: string | null
  anchor_atracacao_id: string | null
  claim_state: 'na_fila' | 'em_envio' | 'recusado' | 'nova_tentativa' | 'sem_destinatario'
  next_attempt_at: string | null
}

/**
 * Situação de um modelo para um Cliente na linha da Cobertura:
 * enviado (com data e o Comunicado), na fila da próxima rodada, em envio,
 * devido e não enviado, bloqueado (com o motivo) ou não devido.
 */
export type CoverageCellState = 'enviado' | 'na_fila' | 'em_envio' | 'devido' | 'bloqueado' | 'nao_devido'

export type CoverageCell = {
  state: CoverageCellState
  /** Último envio, mesmo quando a situação atual é reenvio pendente. */
  sentAt: string | null
  communicationId: number | null
  reason: string | null
}

export type CoverageCustomerDetail = {
  customerId: number
  customerName: string
  cells: Record<CoverageKind, CoverageCell>
}

const READINESS_REASON_TEXT: Record<string, (bls: string) => string> = {
  faturamento_pendente: (bls) => `falta faturar ${bls}`,
  ce_mercante_ausente: (bls) => `falta CE Mercante em ${bls}`,
  revisao_pendente: (bls) => `${bls} em revisão`,
}

/** "falta faturar 4 B/Ls; falta CE Mercante em 1 B/L", a partir dos motivos por B/L. */
export function readinessReasonText(readiness: CoverageReadiness | undefined): string {
  if (!readiness) return 'prontidão não consultada'
  if (!readiness.bls.length) return 'sem B/L na viagem'
  const counts = new Map<string, number>()
  for (const bl of readiness.bls) {
    for (const reason of bl.blocked_reasons ?? []) counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  const parts = Object.keys(READINESS_REASON_TEXT)
    .filter((reason) => counts.has(reason))
    .map((reason) => {
      const count = counts.get(reason) ?? 0
      return READINESS_REASON_TEXT[reason](count === 1 ? '1 B/L' : `${count} B/Ls`)
    })
  return parts.join('; ') || 'prontidão bloqueada'
}

function queueBlockReason(row: CoverageQueueRow): string {
  if (row.claim_state === 'sem_destinatario') return 'sem contato ativo na caixa do modelo'
  if (row.claim_state === 'recusado') return 'recusado na última rodada; volta em até 24 h'
  const next = row.next_attempt_at ? formatCommunicationDateTime(row.next_attempt_at).replace(' (horário de Brasília)', '') : null
  return next ? `falha no envio; nova tentativa a partir de ${next}` : 'falha no envio; nova tentativa na próxima rodada'
}

function coverageCell(state: CoverageCellState, sent: CoverageCommunicationRow | undefined, reason: string | null = null): CoverageCell {
  return { state, sentAt: sent?.created_at ?? null, communicationId: sent?.id ?? null, reason }
}

export type CoverageVoyageRow = { id: number; voyage_number: string; vessel: { name: string } | null }
export type CoverageBlRow = { id: string; voyage_id: number; customer_id: number | null; pod: string | null; ce_mercante: string | null; financial_status: string | null }
export type CoverageCommunicationRow = { id?: number; customer_id: number | null; kind: string; status: string; anchor_voyage_id: number | null; anchor_port: string | null; anchor_atracacao_id: string | null; created_at: string }
export type CoverageTerminalStateRow = { id: string; voyage_id: number; port: string; terminal_atb: string | null }
/** Escala (POD) da viagem para a ordem da Cobertura: ETA, ETB, ATA e omissão. */
export type CoverageEscalaRow = { pod: string; eta: string | null; etb: string | null; ata: string | null; omitted?: boolean }

/**
 * Ordem da Cobertura na ordem da escala (ponto 7 de 2026-10-23), a mesma regra
 * das faixas de Viagens, Veículos e Baplie (`compareVoyageRailItems`): a viagem
 * da escala mais próxima primeiro e a mais distante embaixo, e dentro da viagem
 * os portos pela ETA (sem ETA no fim). A ordem anterior era a de cadastro da
 * viagem, com os portos em ordem alfabética.
 */
export function orderCoverageByEscala<T extends { voyageId: number; vesselName: string; voyageNumber: string; port: string | null }>(
  rows: readonly T[],
  escalas: ReadonlyMap<number, readonly CoverageEscalaRow[]>,
): T[] {
  const proxima = new Map<number, ReturnType<typeof getProximaEscala>>()
  const portEta = (voyageId: number, port: string | null) => {
    const code = communicationPortCode(port)
    const matches = (escalas.get(voyageId) ?? []).filter((escala) => !escala.omitted && communicationPortCode(escala.pod) === code && escala.eta)
    return matches.length ? matches.map((escala) => escala.eta!).sort()[0] : '\uffff'
  }
  const railKey = (row: T) => {
    if (!proxima.has(row.voyageId)) proxima.set(row.voyageId, getProximaEscala([...(escalas.get(row.voyageId) ?? [])]))
    return { proximaEscala: proxima.get(row.voyageId) ?? null, vesselName: row.vesselName, voyageNumber: row.voyageNumber }
  }
  return [...rows].sort((left, right) => compareVoyageRailItems(railKey(left), railKey(right))
    || left.voyageId - right.voyageId
    || portEta(left.voyageId, left.port).localeCompare(portEta(right.voyageId, right.port))
    || (left.port ?? '').localeCompare(right.port ?? ''))
}

/**
 * Monta a Cobertura (uma linha por viagem × POD) a partir das linhas já lidas.
 * `readiness` é a prontidão do CE e Taxas por `<viagem>:<cliente>`
 * (`customer_local_charges_communication_readiness`, que é por viagem): o
 * Cliente pronto conta como pronto em cada porto onde tem B/L.
 */
export function buildVoyageCommunicationCoverage(input: {
  voyages: readonly CoverageVoyageRow[]
  bls: readonly CoverageBlRow[]
  communications: readonly CoverageCommunicationRow[]
  terminalStates: readonly CoverageTerminalStateRow[]
  readiness: ReadonlyMap<string, boolean>
  /** Motivos da prontidão por `<viagem>:<cliente>`, para o drill-down. */
  readinessDetails?: ReadonlyMap<string, CoverageReadiness>
  /** O que a próxima rodada automática vai enviar (migration 345). */
  queue?: readonly CoverageQueueRow[]
  customerNames?: ReadonlyMap<number, string>
}): VoyageCommunicationCoverageSummary[] {
  const noQueue: Record<CoverageKind, number> = { ce_mercante_taxas: 0, aviso_chegada_noa: 0, aviso_prontidao_nor: 0, aviso_atracacao_nob: 0 }
  const result: VoyageCommunicationCoverageSummary[] = []
  for (const voyage of input.voyages) {
    const voyageBls = input.bls.filter((bl) => bl.voyage_id === voyage.id && bl.customer_id != null && bl.financial_status !== 'cancelled')
    const ports = Array.from(new Set(voyageBls.map((bl) => communicationPortCode(bl.pod) ?? ''))).sort()
    const base = { voyageId: voyage.id, vesselName: voyage.vessel?.name ?? '—', voyageNumber: voyage.voyage_number }
    if (!ports.length) {
      const none = { sent: 0, total: 0 }
      result.push({ ...base, port: null, customers: 0, noa: none, nor: none, nob: none, finance: { sent: 0, due: 0, resend: 0, ready: 0, total: 0, pending: 0 }, queued: noQueue, details: [] })
      continue
    }
    const voyageComms = input.communications.filter((comm) => comm.anchor_voyage_id === voyage.id && comm.status === 'enviado' && comm.customer_id != null)
    for (const port of ports) {
      const rows = voyageBls.filter((bl) => (communicationPortCode(bl.pod) ?? '') === port)
      const customers = new Set(rows.map((row) => row.customer_id!))
      const portComms = voyageComms.filter((comm) => customers.has(comm.customer_id!) && (communicationPortCode(comm.anchor_port) ?? '') === port)
      const nobTargetKeys = new Set(input.terminalStates
        .filter((state) => state.voyage_id === voyage.id && (communicationPortCode(state.port) ?? '') === port)
        .flatMap((state) => Array.from(customers).map((customerId) => `${customerId}:${state.id}`)))
      const count = (kind: string) => new Set(portComms
        .filter((comm) => comm.kind === kind)
        .filter((comm) => kind !== 'aviso_atracacao_nob' || nobTargetKeys.has(`${comm.customer_id}:${comm.anchor_atracacao_id}`))
        .map((comm) => `${comm.customer_id}:${comm.anchor_atracacao_id ?? ''}`)).size

      const ready = new Set(Array.from(customers).filter((customerId) => input.readiness.get(`${voyage.id}:${customerId}`) === true))
      // CE e Taxas é por Cliente × Viagem (decisão D3): vale para todas as
      // escalas do Cliente, mesmo o envio antigo que gravou `anchor_port`.
      const financeSent = new Set(voyageComms
        .filter((comm) => comm.kind === 'ce_mercante_taxas' && customers.has(comm.customer_id!))
        .map((comm) => comm.customer_id!))
      const upToDate = Array.from(financeSent).filter((customerId) => ready.has(customerId)).length
      const resend = financeSent.size - upToDate

      // Drill-down: o envio mais recente e a fila de cada Cliente × modelo.
      const portQueue = (input.queue ?? []).filter((row) => row.voyage_id === voyage.id && customers.has(row.customer_id)
        && (row.kind === 'ce_mercante_taxas' || (communicationPortCode(row.port) ?? '') === port))
      const details: CoverageCustomerDetail[] = Array.from(customers).sort((a, b) => a - b).map((customerId) => {
        const cellFor = (kind: CoverageKind): CoverageCell => {
          const lastSent = (kind === 'ce_mercante_taxas'
            ? voyageComms.filter((comm) => comm.kind === kind && comm.customer_id === customerId)
            : portComms.filter((comm) => comm.kind === kind && comm.customer_id === customerId)
              .filter((comm) => kind !== 'aviso_atracacao_nob' || nobTargetKeys.has(`${comm.customer_id}:${comm.anchor_atracacao_id}`)))
            .reduce<CoverageCommunicationRow | undefined>((latest, comm) => (!latest || comm.created_at > latest.created_at ? comm : latest), undefined)
          const queued = portQueue.filter((row) => row.kind === kind && row.customer_id === customerId)
          if (queued.some((row) => row.claim_state === 'em_envio')) return coverageCell('em_envio', lastSent)
          if (queued.some((row) => row.claim_state === 'na_fila')) return coverageCell('na_fila', lastSent)
          if (queued.length) return coverageCell('bloqueado', lastSent, queueBlockReason(queued[0]))
          if (kind !== 'ce_mercante_taxas') return coverageCell(lastSent ? 'enviado' : 'nao_devido', lastSent)
          const key = `${voyage.id}:${customerId}`
          if (ready.has(customerId)) return coverageCell(lastSent ? 'enviado' : 'devido', lastSent)
          const reason = readinessReasonText(input.readinessDetails?.get(key))
          return coverageCell('bloqueado', lastSent, lastSent ? `reenvio pendente: ${reason}` : reason)
        }
        return {
          customerId,
          customerName: input.customerNames?.get(customerId) ?? `Cliente ${customerId}`,
          cells: {
            ce_mercante_taxas: cellFor('ce_mercante_taxas'),
            aviso_chegada_noa: cellFor('aviso_chegada_noa'),
            aviso_prontidao_nor: cellFor('aviso_prontidao_nor'),
            aviso_atracacao_nob: cellFor('aviso_atracacao_nob'),
          },
        }
      }).sort((a, b) => a.customerName.localeCompare(b.customerName, 'pt-BR'))
      const queuedCount = (kind: CoverageKind) => details.filter((detail) => detail.cells[kind].state === 'na_fila').length

      result.push({
        ...base,
        port: port || null,
        customers: customers.size,
        noa: { sent: count('aviso_chegada_noa'), total: customers.size },
        nor: { sent: count('aviso_prontidao_nor'), total: customers.size },
        nob: { sent: count('aviso_atracacao_nob'), total: nobTargetKeys.size },
        finance: { sent: upToDate, due: ready.size + resend, resend, ready: ready.size, total: customers.size, pending: customers.size - ready.size },
        queued: {
          ce_mercante_taxas: queuedCount('ce_mercante_taxas'),
          aviso_chegada_noa: queuedCount('aviso_chegada_noa'),
          aviso_prontidao_nor: queuedCount('aviso_prontidao_nor'),
          aviso_atracacao_nob: queuedCount('aviso_atracacao_nob'),
        },
        details,
      })
    }
  }
  return result
}

export type CustomerCommunicationSavedTemplate = {
  id: number
  name: string
  subject: string
  body: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export async function fetchCustomerCommunicationSavedTemplates(): Promise<CustomerCommunicationSavedTemplate[]> {
  const { data, error } = await supabase.rpc('list_customer_communication_saved_templates' as never)
  if (error) throw toError(error)
  return (data as CustomerCommunicationSavedTemplate[] | null) ?? []
}

export async function saveCustomerCommunicationSavedTemplate(input: { name: string; subject: string; body: string }): Promise<number> {
  const { data, error } = await supabase.rpc('save_customer_communication_saved_template' as never, {
    p_name: input.name,
    p_subject: input.subject,
    p_body: input.body,
  } as never)
  if (error) throw toError(error)
  if (data == null) throw new Error('Não foi possível salvar o modelo.')
  return data as number
}

const COMMUNICATION_HISTORY_SELECT = 'id, customer_id, kind, nature, anchor_voyage_id, anchor_port, anchor_atracacao_id, anchor_invoice_id, attempt_discriminator, status, dispatch_id, vessel_name, voyage_number, terminal_name, created_by, origin, created_at, customer:customers(id, name, cnpj_cpf), attempts:customer_communication_attempts(id, recipient_masked, recipient_email, dispatch_mode, status, retry_count, provider_message_id, last_error, created_at, updated_at), bl_links:customer_communication_bls(bl_id), attachments:customer_communication_attachments(id, file_name, mime_type, storage_path, size_bytes, created_at)'

export async function fetchCustomerCommunicationHistory(input?: number | CustomerCommunicationHistoryFilters): Promise<CustomerCommunicationHistoryItem[]> {
  let filters: CustomerCommunicationHistoryFilters = typeof input === 'number' ? { customerId: input } : (input ?? {})
  // Ponto 8 de 2026-10-23: o link de um Comunicado (Cobertura, ficha, B/L) mostrava
  // só ele, e o Histórico parecia ter um envio só. Agora abre todos os envios do
  // mesmo Cliente na mesma viagem; a tela deixa aberto o Comunicado do link.
  // Sem viagem (institucional, Cobrança de Demurrage agrupada), o recorte fica
  // só no Cliente, e o aviso da tela diz isso.
  if (filters.id != null) {
    const { data: focus, error: focusError } = await supabase
      .from('customer_communications')
      .select('id, customer_id, anchor_voyage_id')
      .eq('id', filters.id)
      .maybeSingle()
    if (focusError) throw focusError
    if (!focus) return []
    const anchor = focus as { customer_id: number | null; anchor_voyage_id: number | null }
    if (anchor.customer_id != null) {
      filters = { ...filters, id: undefined, customerId: filters.customerId ?? anchor.customer_id, voyageId: filters.voyageId ?? anchor.anchor_voyage_id ?? undefined }
    }
  }
  const rows: CustomerCommunicationHistoryItem[] = []
  let blCommunicationIds: number[] | null = null
  if (filters.blId?.trim()) {
    const { data: links, error: linksError } = await supabase
      .from('customer_communication_bls')
      .select('communication_id')
      .eq('bl_id', filters.blId.trim())
    if (linksError) throw linksError
    blCommunicationIds = [...new Set((links ?? []).map((link) => link.communication_id))]
    if (!blCommunicationIds.length) return []
  }
  const pageSize = 200
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from('customer_communications').select(COMMUNICATION_HISTORY_SELECT).order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, from + pageSize - 1)
    if (filters.id != null) query = query.eq('id', filters.id)
    if (filters.customerId != null) query = query.eq('customer_id', filters.customerId)
    if (blCommunicationIds) query = query.in('id', blCommunicationIds)
    if (filters.voyageId != null) query = query.eq('anchor_voyage_id', filters.voyageId)
    const vessel = sanitizeLikeTerm(filters.vessel ?? '')
    if (vessel) query = query.ilike('vessel_name', `%${vessel}%`)
    if (filters.kind) query = query.eq('kind', filters.kind)
    if (filters.status) query = query.eq('status', filters.status)
    if (filters.origin) {
      query = (query as unknown as { eq: (column: string, value: string) => typeof query }).eq('origin', filters.origin)
    }
    // Mês no fuso de Brasília, como a Cobertura: o Comunicado de 31/10 às 22h
    // é de outubro, não de novembro.
    const monthRange = brasiliaMonthRange(filters.month)
    if (monthRange) query = query.gte('created_at', monthRange.start).lt('created_at', monthRange.end)
    const { data, error } = await query.overrideTypes<CustomerCommunicationHistoryItem[], { merge: false }>()
    if (error) throw error
    rows.push(...(data ?? []))
    if (filters.id != null || !data || data.length < pageSize) break
  }
  return rows.map((item) => ({ ...item, attempts: item.attempts ?? [], bl_links: item.bl_links ?? [], attachments: item.attachments ?? [] }))
}

/**
 * Mês da Cobertura (viagens com ETA no mês) e do Histórico (Comunicados criados
 * no mês), no fuso de Brasília. Antes o filtro da Cobertura ia para a consulta
 * e era ignorado (plano dos e-mails, 3.5).
 */
export function brasiliaMonthRange(month: string | null | undefined): { start: string; end: string } | null {
  const match = month?.trim().match(/^(\d{4})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const monthIndex = Number(match[2])
  if (monthIndex < 1 || monthIndex > 12) return null
  const nextYear = monthIndex === 12 ? year + 1 : year
  const nextMonth = monthIndex === 12 ? 1 : monthIndex + 1
  const pad = (value: number) => String(value).padStart(2, '0')
  return {
    start: `${year}-${pad(monthIndex)}-01T00:00:00-03:00`,
    end: `${nextYear}-${pad(nextMonth)}-01T00:00:00-03:00`,
  }
}

type CoveragePage<T> = { data: T[] | null; error: unknown }

async function fetchCoverageRows<T>(fetchPage: (from: number, to: number) => PromiseLike<CoveragePage<T>>): Promise<T[]> {
  const rows: T[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < pageSize) return rows
  }
}

export async function fetchVoyageCommunicationCoverage(filters?: { vessel?: string; voyage?: string; month?: string }): Promise<VoyageCommunicationCoverageSummary[]> {
  const rawVoyages = await fetchCoverageRows((from, to) => {
    let voyageQuery = supabase.from('voyages').select('id, voyage_number, vessel:vessels(name)').order('id', { ascending: false }).range(from, to)
    const voyage = sanitizeLikeTerm(filters?.voyage ?? '')
    if (voyage) voyageQuery = voyageQuery.ilike('voyage_number', `%${voyage}%`)
    const monthRange = brasiliaMonthRange(filters?.month)
    if (monthRange) voyageQuery = voyageQuery.gte('eta', monthRange.start).lt('eta', monthRange.end)
    return voyageQuery.overrideTypes<CoverageVoyageRow[], { merge: false }>()
  })

  let voyages = rawVoyages ?? []
  if (filters?.vessel?.trim()) {
    const vesselFilter = filters.vessel.trim().toUpperCase()
    voyages = voyages.filter((v) => (v.vessel?.name ?? '').toUpperCase().includes(vesselFilter))
  }

  if (!voyages.length) return []
  const voyageIds = voyages.map((v) => v.id)

  const [bls, communications, terminalStates] = await Promise.all([
    fetchCoverageRows((from, to) =>
      supabase
        .from('bls')
        .select('id, voyage_id, customer_id, pod, ce_mercante, financial_status')
        .in('voyage_id', voyageIds)
        .order('id', { ascending: false })
        .range(from, to)
        .overrideTypes<CoverageBlRow[], { merge: false }>(),
    ),
    fetchCoverageRows((from, to) =>
      supabase
        .from('customer_communications')
        .select('id, customer_id, kind, status, anchor_voyage_id, anchor_port, anchor_atracacao_id, created_at')
        .in('anchor_voyage_id', voyageIds)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to)
        .overrideTypes<CoverageCommunicationRow[], { merge: false }>(),
    ),
    fetchCoverageRows((from, to) =>
      supabase
        .from('voyage_escala_terminal_state')
        .select('id, voyage_id, port, terminal_atb')
        .in('voyage_id', voyageIds)
        .not('terminal_atb', 'is', null)
        .order('id', { ascending: false })
        .range(from, to)
        .overrideTypes<CoverageTerminalStateRow[], { merge: false }>(),
    ),
  ])
  const rowsByVoyageCustomer = new Map<string, Promise<CoverageReadiness>>()
  for (const bl of bls) {
    if (bl.customer_id == null || bl.financial_status === 'cancelled') continue
    const key = `${bl.voyage_id}:${bl.customer_id}`
    if (!rowsByVoyageCustomer.has(key)) {
      rowsByVoyageCustomer.set(key, (async () => {
        const { data, error } = await supabase.rpc(
          'customer_local_charges_communication_readiness' as never,
          { p_voyage_id: bl.voyage_id, p_customer_id: bl.customer_id } as never,
        )
        if (error) throw toError(error)
        const result = data as { ready?: boolean; bls?: CoverageReadiness['bls'] } | null
        return { ready: result?.ready === true, bls: result?.bls ?? [] }
      })())
    }
  }
  const customerIds = Array.from(new Set(bls.map((bl) => bl.customer_id).filter((id): id is number => id != null)))
  const [readinessEntries, queue, customerRows] = await Promise.all([
    Promise.all([...rowsByVoyageCustomer.entries()].map(async ([key, value]) => [key, await value] as const)),
    fetchCommunicationQueuePreview(voyageIds),
    customerIds.length
      ? fetchCoverageRows((from, to) => supabase.from('customers').select('id, name').in('id', customerIds).order('id').range(from, to)
        .overrideTypes<Array<{ id: number; name: string }>, { merge: false }>())
      : Promise.resolve([] as Array<{ id: number; name: string }>),
  ])
  const readinessDetails = new Map(readinessEntries)
  const readiness = new Map(readinessEntries.map(([key, value]) => [key, value.ready] as const))
  const customerNames = new Map(customerRows.map((row) => [row.id, row.name] as const))

  // Projeção canônica das escalas, a mesma de Viagens, Veículos e Baplie: une
  // apelidos do mesmo porto (BRVIT/BRVIX) e respeita a exclusão.
  const escalas = new Map<number, CoverageEscalaRow[]>()
  for (const [voyageId, schedules] of await listVoyageEscalaSchedulesByVoyageIds([...voyageIds])) {
    escalas.set(voyageId, schedules.filter((schedule) => !schedule.deleted)
      .map((schedule) => ({ pod: schedule.port, eta: schedule.eta, etb: null, ata: schedule.ata, omitted: schedule.omitted })))
  }
  return orderCoverageByEscala(buildVoyageCommunicationCoverage({ voyages, bls, communications, terminalStates, readiness, readinessDetails, queue, customerNames }), escalas)
}

/**
 * O que a próxima rodada automática vai enviar nas viagens, lido sem efeito
 * colateral (`customer_communication_queue_preview`, migration 345: os mesmos
 * alvos e prontidão da rodada, sem gravar claim nem Comunicado).
 */
export async function fetchCommunicationQueuePreview(voyageIds: readonly number[]): Promise<CoverageQueueRow[]> {
  if (!voyageIds.length) return []
  const { data, error } = await supabase.rpc('customer_communication_queue_preview' as never, { p_voyage_ids: [...voyageIds] } as never)
  if (error) throw toError(error)
  return ((data ?? []) as unknown as CoverageQueueRow[]).map((row) => ({ ...row, anchor_atracacao_id: row.anchor_atracacao_id ?? null, next_attempt_at: row.next_attempt_at ?? null }))
}

export async function fetchBlCommunicationHistory(blId: string): Promise<CustomerCommunicationHistoryItem[]> {
  const { data: links, error: linksError } = await supabase
    .from('customer_communication_bls')
    .select('communication_id')
    .eq('bl_id', blId)
  if (linksError) throw linksError
  const communicationIds = (links ?? []).map((link) => link.communication_id)
  if (!communicationIds.length) return []
  const { data, error } = await supabase
    .from('customer_communications')
    .select(COMMUNICATION_HISTORY_SELECT)
    .in('id', communicationIds)
    .order('created_at', { ascending: false })
    .overrideTypes<CustomerCommunicationHistoryItem[], { merge: false }>()
  if (error) throw error
  return (data ?? []).map((item) => ({
    ...item,
    attempts: item.attempts ?? [],
    bl_links: item.bl_links ?? [],
    attachments: item.attachments ?? [],
  }))
}

export function customerCommunicationStatusLabel(status: string): string {
  if (status === 'pendente') return 'Em envio'
  if (status === 'enviado') return 'Enviado'
  if (status === 'simulado') return 'Simulado'
  if (status === 'parcial') return 'Parcial'
  if (status === 'falha') return 'Falha'
  return status
}

/** Situação de cada tentativa (destinatário) no Histórico. */
export function customerCommunicationAttemptStatusLabel(attempt: Pick<CustomerCommunicationAttemptHistory, 'status' | 'dispatch_mode' | 'provider_message_id'>): string {
  if (attempt.status === 'aceito') {
    if (attempt.dispatch_mode === 'simulado') return 'Registrado em simulação'
    return attempt.provider_message_id ? 'Aceito pelo provedor' : 'Em envio'
  }
  if (attempt.status === 'entregue') return 'Entregue'
  if (attempt.status === 'bounce') return 'Devolvido (endereço inexistente)'
  if (attempt.status === 'complaint') return 'Marcado como spam'
  if (attempt.status === 'falha_transitoria') return 'Falha passageira'
  if (attempt.status === 'falha_permanente') return 'Recusado pelo provedor'
  return attempt.status
}

export function isFailedCustomerCommunicationAttempt(status: string): boolean {
  return status === 'falha_transitoria' || status === 'falha_permanente' || status === 'bounce' || status === 'complaint'
}

/**
 * Traduz o `last_error` gravado pelo envio comum (`_shared/email.ts`) para quem
 * opera a tela. O texto técnico não some: a tela o mantém no `title`.
 */
export function customerCommunicationAttemptReason(lastError: string | null | undefined): string | null {
  const raw = lastError?.trim()
  if (!raw) return null
  if (/^Tempo esgotado/i.test(raw)) return 'O provedor de e-mail não respondeu a tempo; a mensagem pode ser reenviada.'
  if (/^Falha de rede/i.test(raw)) return 'Falha de rede ao falar com o provedor de e-mail; a mensagem pode ser reenviada.'
  if (/RESEND_API_KEY/i.test(raw)) return 'Envio real sem a chave do provedor de e-mail configurada.'
  const http = raw.match(/^HTTP (\d{3})/)
  if (http) {
    const status = Number(http[1])
    if (status === 401 || status === 403) return 'O provedor recusou a credencial do envio (configuração do provedor).'
    if (status === 429) return 'Limite de envios do provedor atingido; a mensagem pode ser reenviada.'
    if (status === 408 || status >= 500) return 'Provedor de e-mail indisponível no momento; a mensagem pode ser reenviada.'
    if (status === 422 || status === 400) return 'O provedor recusou a mensagem (endereço ou conteúdo inválido).'
    if (status === 409) return 'O provedor recusou a mensagem repetida.'
    return `O provedor recusou a mensagem (HTTP ${status}).`
  }
  return raw
}

export function customerCommunicationKindLabel(kind: string): string {
  if (kind === 'aviso_chegada_noa') return 'NOA · Chegada Próxima'
  if (kind === 'aviso_prontidao_nor') return 'NOR · Aviso de Chegada'
  if (kind === 'aviso_atracacao_nob') return 'NOB · Aviso de Atracação'
  if (kind === 'ce_mercante_taxas') return 'CE Mercante · Taxas Locais'
  if (kind === 'cobranca_demurrage') return 'Cobrança de Demurrage'
  if (kind === 'institucional') return 'Institucional'
  if (kind === 'livre') return 'Comunicado livre'
  return kind
}
