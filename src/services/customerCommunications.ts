import type {
  CustomerCommunicationNature,
  CustomerContact,
  CustomerContactPreference,
} from '../types/database'
import { canonicalizeDocument } from '../lib/cnpj'
import { operationFrontKindsForCargoMode } from './escalaTerminalAllocation'
import { listVoyageEscalaSchedulesByVoyageIds, type VoyageEscalaSchedule } from './voyageRouteSchedules'
import { supabase } from './supabase'
import type { CustomerCommunicationKind, CustomerCommunicationTemplateInput } from './customerCommunicationTemplates'
import {
  type CommunicationBoxCode,
  type CustomerCommunicationAudience,
  type CustomerContactBoxLink,
  type CustomerCommunicationRecipient,
  resolveCustomerCommunicationRecipientsByBoxes,
  buildRecipientSnapshot,
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
  selected: boolean
  nextAttemptDiscriminator: number
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

function samePort(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = normalizedUpper(left)
  const b = normalizedUpper(right)
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
  if (kind === 'institucional' || kind === 'livre') return String(row.customerId)
  if (kind === 'aviso_atracacao_nob') {
    return `${row.customerId}:${row.voyageId}:${normalizedUpper(row.pod)}:${row.terminalStateId ?? 'terminal-state-sem-identidade'}`
  }
  return `${row.customerId}:${row.voyageId}:${normalizedUpper(row.pod)}`
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
      blocked: recipients.blocked,
      selected: !recipients.blocked,
      audience: input.audience,
      recipientSnapshot,
      nextAttemptDiscriminator: input.kind === 'institucional' || input.kind === 'livre'
        ? nextInstitutionalAttemptDiscriminator(input.history ?? [], first.customerId, input.kind)
        : nextAttemptDiscriminator(input.history ?? [], first, input.kind),
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

type RawCommunicationBlRow = {
  id: string
  voyage_id: number
  customer_id: number | null
  pod: string | null
  pol: string | null
  cargo_mode: string
  customer: { id: number; name: string; cnpj_cpf: string } | null
  voyage: { id: number; voyage_number: string; eta: string | null; ata: string | null; vessel: { name: string } | null } | null
}

function toBaseCandidate(row: RawCommunicationBlRow): CustomerCommunicationBlCandidate | null {
  if (!row.customer_id || !row.customer || !row.voyage) return null
  if (!row.pod?.trim()) return null
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
  return `${voyageId}::${normalizedUpper(port)}::${terminalId}::${modalidade}`
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

function expandCandidatesForKind(
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
    if (!schedule || schedule.deleted || schedule.omitted) continue
    if (kind === 'aviso_atracacao_nob') {
      for (const atracacao of schedule.atracacoes) {
        // NOB is anchored by the state row UUID, never by the terminal UUID.
        // A missing state identity is not safe to turn into a dispatch.
        if (!atracacao.terminalId || !atracacao.stateId || !atracacao.atb) continue
        // A Atracação só comunica a carga da Frente de Operação que ela hospeda:
        // quem descarregou no berço vizinho não entra neste NOB.
        const terminalId = atracacao.terminalId
        if (assignedFrontKeys && !operationFrontKindsForCargoMode(row.cargoMode).some((kind) =>
          assignedFrontKeys.has(operationFrontKey(row.voyageId, row.pod ?? '', terminalId, kind)),
        )) continue
        expanded.push({
          ...row,
          terminalId: atracacao.terminalId,
          terminalName: atracacao.terminalCode ?? atracacao.terminalId,
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

async function fetchCommunicationBlRows(): Promise<RawCommunicationBlRow[]> {
  const rows: RawCommunicationBlRow[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase
      .from('bls')
      .select('id, voyage_id, customer_id, pod, pol, cargo_mode, customer:customers!bls_customer_id_fkey(id, name, cnpj_cpf), voyage:voyages(id, voyage_number, eta, ata, vessel:vessels(name))')
      .order('id', { ascending: true })
      .range(from, from + 499)
      .overrideTypes<RawCommunicationBlRow[], { merge: false }>()
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 500) break
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

  const rawRows = await fetchCommunicationBlRows()
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
  const { contactsByCustomer, boxLinks } = await fetchCommunicationContacts(customerIds)
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
  voyageId?: number
  vessel?: string
  month?: string
  kind?: string
  status?: string | ''
  origin?: string
}

export type VoyageCommunicationCoverageSummary = {
  voyageId: number
  vesselName: string
  voyageNumber: string
  customers: number
  noa: { sent: number; total: number }
  nor: { sent: number; total: number }
  nob: { sent: number; total: number }
  finance: { sent: number; ready: number; total: number; pending: number }
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
  const result = await (supabase.rpc as unknown as (name: string, args?: Record<string, unknown>) => Promise<{ data: CustomerCommunicationSavedTemplate[] | null; error: unknown }>)(
    'list_customer_communication_saved_templates',
  )
  if (result.error) throw result.error
  return result.data ?? []
}

export async function saveCustomerCommunicationSavedTemplate(input: { name: string; subject: string; body: string }): Promise<number> {
  const result = await (supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: number | null; error: unknown }>)(
    'save_customer_communication_saved_template',
    { p_name: input.name, p_subject: input.subject, p_body: input.body },
  )
  if (result.error) throw result.error
  if (result.data == null) throw new Error('Não foi possível salvar o modelo.')
  return result.data
}

const COMMUNICATION_HISTORY_SELECT = 'id, customer_id, kind, nature, anchor_voyage_id, anchor_port, anchor_atracacao_id, anchor_invoice_id, attempt_discriminator, status, dispatch_id, vessel_name, voyage_number, terminal_name, created_by, origin, created_at, customer:customers(id, name, cnpj_cpf), attempts:customer_communication_attempts(id, recipient_masked, dispatch_mode, status, retry_count, provider_message_id, last_error, created_at, updated_at), bl_links:customer_communication_bls(bl_id), attachments:customer_communication_attachments(id, file_name, mime_type, storage_path, size_bytes, created_at)'

export async function fetchCustomerCommunicationHistory(input?: number | CustomerCommunicationHistoryFilters): Promise<CustomerCommunicationHistoryItem[]> {
  const filters = typeof input === 'number' ? { customerId: input } : (input ?? {})
  const rows: CustomerCommunicationHistoryItem[] = []
  const pageSize = 200
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from('customer_communications').select(COMMUNICATION_HISTORY_SELECT).order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, from + pageSize - 1)
    if (filters.id != null) query = query.eq('id', filters.id)
    if (filters.customerId != null) query = query.eq('customer_id', filters.customerId)
    if (filters.voyageId != null) query = query.eq('anchor_voyage_id', filters.voyageId)
    if (filters.vessel?.trim()) query = query.ilike('vessel_name', `%${filters.vessel.trim()}%`)
    if (filters.kind) query = query.eq('kind', filters.kind)
    if (filters.status) query = query.eq('status', filters.status)
    if (filters.origin) {
      query = (query as unknown as { eq: (column: string, value: string) => typeof query }).eq('origin', filters.origin)
    }
    if (filters.month && /^\d{4}-\d{2}$/.test(filters.month)) {
      const start = new Date(`${filters.month}-01T00:00:00.000Z`)
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
      query = query.gte('created_at', start.toISOString()).lt('created_at', end.toISOString())
    }
    const { data, error } = await query.overrideTypes<CustomerCommunicationHistoryItem[], { merge: false }>()
    if (error) throw error
    rows.push(...(data ?? []))
    if (filters.id != null || !data || data.length < pageSize) break
  }
  return rows.map((item) => ({ ...item, attempts: item.attempts ?? [], bl_links: item.bl_links ?? [], attachments: item.attachments ?? [] }))
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
    if (filters?.voyage?.trim()) voyageQuery = voyageQuery.ilike('voyage_number', `%${filters.voyage.trim()}%`)
    return voyageQuery.overrideTypes<Array<{ id: number; voyage_number: string; vessel: { name: string } | null }>, { merge: false }>()
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
        .overrideTypes<Array<{ id: string; voyage_id: number; customer_id: number | null; pod: string | null; ce_mercante: string | null; financial_status: string | null }>, { merge: false }>(),
    ),
    fetchCoverageRows((from, to) =>
      supabase
        .from('customer_communications')
        .select('id, customer_id, kind, status, anchor_voyage_id, anchor_port, anchor_atracacao_id, created_at')
        .in('anchor_voyage_id', voyageIds)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to)
        .overrideTypes<Array<{ customer_id: number | null; kind: string; status: string; anchor_voyage_id: number | null; anchor_port: string | null; anchor_atracacao_id: string | null; created_at: string }>, { merge: false }>(),
    ),
    fetchCoverageRows((from, to) =>
      supabase
        .from('voyage_escala_terminal_state')
        .select('id, voyage_id, port, terminal_atb')
        .in('voyage_id', voyageIds)
        .not('terminal_atb', 'is', null)
        .order('id', { ascending: false })
        .range(from, to)
        .overrideTypes<Array<{ id: string; voyage_id: number; port: string; terminal_atb: string | null }>, { merge: false }>(),
    ),
  ])
  const rowsByVoyageCustomer = new Map<string, Promise<boolean>>()
  for (const bl of bls) {
    if (bl.customer_id == null || bl.financial_status === 'cancelled') continue
    const key = `${bl.voyage_id}:${bl.customer_id}`
    if (!rowsByVoyageCustomer.has(key)) {
      rowsByVoyageCustomer.set(key, (async () => {
        const result = await (supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: { ready?: boolean } | null; error: unknown }>)(
          'customer_local_charges_communication_readiness',
          { p_voyage_id: bl.voyage_id, p_customer_id: bl.customer_id },
        )
        if (result.error) throw result.error
        return result.data?.ready === true
      })())
    }
  }
  const readiness = new Map<string, boolean>()
  await Promise.all([...rowsByVoyageCustomer.entries()].map(async ([key, value]) => readiness.set(key, await value)))

  return voyages.map((voyage) => {
    const rows = bls.filter((bl) => bl.voyage_id === voyage.id && bl.customer_id != null && bl.financial_status !== 'cancelled')
    const customers = new Set(rows.map((row) => row.customer_id!))
    const comms = communications
    const terminalTargets = terminalStates.filter((state) => state.voyage_id === voyage.id)
    const nobTargetKeys = new Set(rows.flatMap((row) => terminalTargets
      .filter((state) => state.port.toUpperCase() === row.pod?.toUpperCase())
      .map((state) => `${row.customer_id}:${state.id}`)))
    const count = (kind: string, customerId?: number) => new Set(comms
      .filter((comm) => comm.kind === kind && comm.status === 'enviado' && comm.anchor_voyage_id === voyage.id)
      .filter((comm) => customerId == null || comm.customer_id === customerId)
      .filter((comm) => customerId == null || rows.some((row) => row.customer_id === customerId && row.pod?.toUpperCase() === comm.anchor_port?.toUpperCase()))
      .filter((comm) => kind !== 'aviso_atracacao_nob' || nobTargetKeys.has(`${comm.customer_id}:${comm.anchor_atracacao_id}`))
      .map((comm) => `${comm.customer_id}:${comm.anchor_voyage_id}:${comm.anchor_port?.toUpperCase() ?? ''}:${comm.anchor_atracacao_id ?? ''}`)).size
    const total = (kind: string) => kind === 'aviso_atracacao_nob' ? nobTargetKeys.size : new Set(rows.map((row) => `${row.customer_id}:${row.pod?.toUpperCase()}`)).size

    const customerBlMap = new Map<number, typeof rows>()
    for (const bl of rows) {
      if (bl.customer_id == null) continue
      const list = customerBlMap.get(bl.customer_id) ?? []
      list.push(bl)
      customerBlMap.set(bl.customer_id, list)
    }
    const financeCustomers = new Set<number>()
    for (const [cid, cBls] of customerBlMap.entries()) {
      if (cBls.length > 0 && readiness.get(`${voyage.id}:${cid}`) === true) {
        financeCustomers.add(cid)
      }
    }
    const financeSent = new Set(Array.from(customers)
      .filter((cid) => comms.some((comm) => comm.kind === 'ce_mercante_taxas' && comm.status === 'enviado' && comm.anchor_voyage_id === voyage.id && comm.customer_id === cid))).size
    return { voyageId: voyage.id, vesselName: voyage.vessel?.name ?? '—', voyageNumber: voyage.voyage_number, customers: customers.size, noa: { sent: count('aviso_chegada_noa'), total: total('aviso_chegada_noa') }, nor: { sent: count('aviso_prontidao_nor'), total: total('aviso_prontidao_nor') }, nob: { sent: count('aviso_atracacao_nob'), total: total('aviso_atracacao_nob') }, finance: { sent: financeSent, ready: financeCustomers.size, total: customers.size, pending: customers.size - financeCustomers.size } }
  })
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
  if (status === 'enviado') return 'Enviado'
  if (status === 'simulado') return 'Simulado'
  if (status === 'parcial') return 'Parcial'
  if (status === 'falha') return 'Falha'
  return status
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
