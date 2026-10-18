// Rodada da Régua de Cobrança de Demurrage sem dependência remota, para o teste
// com banco e fetch falsos rodar no Vitest (plano dos e-mails, 1E.5). O
// index.ts da Edge só autentica, lê o ambiente e injeta o acesso ao banco
// (DunningStore) feito com o cliente Supabase.
import { renderDemurrageGroupTemplate, renderDemurrageTemplate, type DemurrageGroupLine } from './customerCommunicationTemplates.ts'
import { maskEmail, sendEmail, type EmailAttemptRecord, type EmailAttemptUpdate, type EmailSuppression } from './email.ts'
import { invoiceNetUsd } from './demurrageNetUsd.ts'
import { resolveDispatchStatus, statusToPersist, type ResolvedDispatchStatus } from './communicationDispatchStatus.ts'

export type DunningCandidate = {
  invoice_id: number
  customer_id: number
  bl_id: string
  doc_number: string
  total_usd: number
  current_total_brl: number | null
  current_roe: number | null
  roe_source: string | null
  first_billed_at: string
  claimed_at: string
  roe_reference_date: string
  attempt_discriminator: number
  /** Retomadas depois de recusa definitiva (migration 303); muda a chave do e-mail. */
  resume_generation: number
}

export type DunningContact = { id: number; email: string }

export type DunningInvoiceContext = {
  id: number
  customer_id: number
  bl_id: string
  doc_number: string
  total_usd: number
  discount_mode: string | null
  discount_value: number | null
  current_total_brl: number | null
  current_roe: number | null
  first_billed_at: string | null
  updated_at: string | null
  customer: { id: number; name: string } | null
  bl: {
    id: string
    pod: string | null
    voyage: { id: number; voyage_number: string; vessel: { name: string } | null } | null
  } | null
}

/** Desfecho de cada fatura na rodada (settle_demurrage_dunning_claim, migration 303). */
export type DunningClaimOutcome = 'sent' | 'partial' | 'failed' | 'refused' | 'paused'

export type DunningCommunicationInput = {
  mode: 'single' | 'group'
  candidates: DunningCandidate[]
  anchor: DunningInvoiceContext
  vesselName: string
  voyageNumber: string
}

export type DunningAttemptInput = {
  communicationId: number
  contactId: number
  communicationsEnabled: boolean
  attemptKey: string
  to: string
  keyPrefix: string
}

/** Acesso ao banco da Régua. A implementação real fica no index.ts da Edge. */
export interface DunningStore {
  loadCommunicationsEnabled(): Promise<boolean>
  claimCandidates(asOf: string, limit: number): Promise<unknown>
  /** Contatos ativos do Cliente autorizados para cobranca_demurrage (customer_communication_recipient_allowed). */
  loadRecipients(customerId: number): Promise<DunningContact[]>
  loadInvoice(invoiceId: number): Promise<DunningInvoiceContext>
  /** demurrage_dunning_candidate_sendable. */
  isSendable(invoiceId: number): Promise<boolean>
  /** O contato ainda autorizado e o e-mail atual dele, ou null. */
  currentEligibleRecipient(customerId: number, contactId: number): Promise<string | null>
  createCommunication(input: DunningCommunicationInput): Promise<number>
  checkSuppression(email: string): Promise<EmailSuppression>
  recordAttempt(input: DunningAttemptInput): Promise<EmailAttemptRecord>
  updateAttempt(attemptId: string | number, update: EmailAttemptUpdate): Promise<void>
  refreshStatus(communicationId: number): Promise<unknown>
  persistStatus(communicationId: number, status: 'parcial' | 'falha'): Promise<void>
  settleClaim(candidate: DunningCandidate, outcome: DunningClaimOutcome, reason?: string | null): Promise<void>
}

export type DunningRunnerConfig = {
  resendApiKey?: string | null
  from?: string | null
  replyTo?: string | null
  portalUrl: string
}

export type DunningRunnerDeps = {
  store: DunningStore
  config: DunningRunnerConfig
  fetcher?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  asOf?: Date
  log?: Pick<Console, 'warn' | 'error'>
}

export type DunningRunResult = {
  status: number
  body: {
    error?: string
    claimed?: number
    sent?: number
    simulated?: number
    partial?: number
    /** Grupos que não saíram (falha ou recusa); o heartbeat fica vermelho com > 0. */
    failed?: number
    /** Grupos recusados em definitivo pelo provedor (contados também em failed). */
    refused?: number
    paused?: number
    releaseFailures?: number
  }
}

export const CLAIM_BATCH_SIZE = 50
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
export const MISSING_SENDER_MESSAGE = 'PORTAL_FROM_EMAIL e DEMURRAGE_REPLY_TO (ou COMMUNICATIONS_REPLY_TO) são obrigatórios para envio real'
const LOG_PREFIX = '[demurrage-dunning]'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function asCandidates(value: unknown): DunningCandidate[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => {
    if (!isRecord(item)) return false
    return Number.isFinite(Number(item.invoice_id))
      && Number.isFinite(Number(item.customer_id))
      && typeof item.bl_id === 'string'
      && typeof item.doc_number === 'string'
      && Number.isFinite(Number(item.total_usd))
      && typeof item.claimed_at === 'string'
      && Number.isFinite(Number(item.attempt_discriminator))
  }).map((item) => ({
    invoice_id: Number(item.invoice_id),
    customer_id: Number(item.customer_id),
    bl_id: String(item.bl_id),
    doc_number: String(item.doc_number),
    total_usd: Number(item.total_usd),
    current_total_brl: item.current_total_brl == null ? null : Number(item.current_total_brl),
    current_roe: item.current_roe == null ? null : Number(item.current_roe),
    roe_source: item.roe_source == null ? null : String(item.roe_source),
    first_billed_at: String(item.first_billed_at ?? ''),
    claimed_at: String(item.claimed_at),
    roe_reference_date: String(item.roe_reference_date ?? ''),
    attempt_discriminator: Number(item.attempt_discriminator),
    resume_generation: Number.isFinite(Number(item.resume_generation)) ? Number(item.resume_generation) : 0,
  }))
}

export function groupDunningCandidatesByCustomerCycle(candidates: DunningCandidate[]): DunningCandidate[][] {
  // D11: uma mensagem por cliente/ciclo (customer_id + attempt_discriminator).
  // Preserva cada fatura (sem consolidar valores); o grupo congela a composição
  // da tentativa e deduplica por cliente/ciclo/destinatário no envio.
  const groups = new Map<string, DunningCandidate[]>()
  for (const candidate of candidates) {
    const key = `${candidate.customer_id}:${candidate.attempt_discriminator}`
    const list = groups.get(key) ?? []
    if (!list.some((item) => item.invoice_id === candidate.invoice_id)) list.push(candidate)
    groups.set(key, list)
  }
  return [...groups.values()].map((list) => list.sort((a, b) => a.invoice_id - b.invoice_id))
}

async function recipientVersion(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase())
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Chave de idempotência do e-mail. A retomada depois de uma recusa definitiva
 * (resume_generation > 0) ganha sufixo próprio: a tentativa recusada não é
 * reaproveitada e o provedor é chamado de novo com o contato corrigido.
 */
export async function dunningIdempotencyKey(mode: 'single' | 'group', communicationId: number, contactId: number, recipient: string, resumeGeneration: number): Promise<string> {
  const prefix = mode === 'group' ? `demurrage:group:${communicationId}:` : `demurrage:${communicationId}:`
  const base = `${prefix}${contactId}:${await recipientVersion(recipient)}`
  return resumeGeneration > 0 ? `${base}:r${resumeGeneration}` : base
}

// Envio real sem configuração não cria o Comunicado (plano dos e-mails, 1B).
export function assertRealSendConfigured(communicationsEnabled: boolean, config: DunningRunnerConfig): void {
  if (!communicationsEnabled) return
  if (!config.resendApiKey) throw new Error('RESEND_API_KEY não está configurada para envio real.')
  if (!config.from || !config.replyTo) throw new Error(MISSING_SENDER_MESSAGE)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (isRecord(error) && typeof error.message === 'string') return error.message
  return String(error)
}

type Line = { candidate: DunningCandidate; context: DunningInvoiceContext; line: DemurrageGroupLine }

function buildLine(candidate: DunningCandidate, context: DunningInvoiceContext): Line {
  // A13 (ADR 0083, item 13): o e-mail mostra o USD líquido, coerente com o BRL informativo e a tela.
  const netUsd = invoiceNetUsd(context).netUsd
  const roe = Number(candidate.current_roe ?? context.current_roe ?? 0)
  const totalBrl = Number(candidate.current_total_brl ?? context.current_total_brl ?? (netUsd * roe))
  return {
    candidate,
    context,
    line: {
      docNumber: candidate.doc_number,
      blId: candidate.bl_id,
      vesselName: context.bl?.voyage?.vessel?.name ?? '',
      voyageNumber: context.bl?.voyage?.voyage_number ?? '',
      totalUsd: netUsd,
      totalBrl,
      roe,
      // 4.3: data da cotação vinda de demurrage_invoice_history (migration 303).
      roeReferenceDate: candidate.roe_reference_date || (context.updated_at || context.first_billed_at || '').slice(0, 10),
    },
  }
}

function render(mode: 'single' | 'group', lines: Line[], customerName: string, portalUrl: string) {
  if (mode === 'single') {
    const { candidate, context, line } = lines[0]!
    return renderDemurrageTemplate({
      customerId: candidate.customer_id,
      customerName,
      vesselName: line.vesselName,
      voyageNumber: line.voyageNumber,
      port: context.bl?.pod ?? '—',
      milestoneAt: candidate.first_billed_at,
      bls: [{ id: candidate.bl_id, customerId: candidate.customer_id }],
      portalUrl,
      demurrage: {
        docNumber: candidate.doc_number,
        totalUsd: line.totalUsd,
        totalBrl: line.totalBrl,
        roe: line.roe,
        roeReferenceDate: line.roeReferenceDate,
      },
    })
  }
  return renderDemurrageGroupTemplate({
    customerId: lines[0]!.candidate.customer_id,
    customerName,
    lines: lines.map((item) => item.line),
    portalUrl,
  })
}

type GroupOutcome = 'enviado' | 'simulado' | 'parcial' | 'falha' | 'recusado' | 'pausado'

type GroupContext = {
  store: DunningStore
  config: DunningRunnerConfig
  communicationsEnabled: boolean
  fetcher?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  log: Pick<Console, 'warn' | 'error'>
}

function invoiceLog(candidate: DunningCandidate) {
  return { invoiceId: candidate.invoice_id, docNumber: candidate.doc_number, customerId: candidate.customer_id, attempt: candidate.attempt_discriminator }
}

async function settle(ctx: GroupContext, candidate: DunningCandidate, outcome: DunningClaimOutcome, reason: string | null): Promise<void> {
  if (outcome === 'paused' || outcome === 'failed' || outcome === 'refused') {
    ctx.log.warn(`${LOG_PREFIX} cobrança ${outcome === 'paused' ? 'pausada' : outcome === 'refused' ? 'recusada em definitivo' : 'com falha'}`, { ...invoiceLog(candidate), reason })
  }
  await ctx.store.settleClaim(candidate, outcome, reason)
}

/**
 * Uma mensagem para um Cliente e etapa. Devolve o desfecho do grupo; cada
 * fatura é fechada (settleClaim) aqui dentro, inclusive na exceção.
 */
async function sendGroup(ctx: GroupContext, group: DunningCandidate[]): Promise<GroupOutcome> {
  const { store, config, communicationsEnabled } = ctx
  const mode: 'single' | 'group' = group.length === 1 ? 'single' : 'group'
  const customerId = group[0]!.customer_id
  // Faturas da mensagem ainda sem desfecho gravado.
  const open = new Set<DunningCandidate>(group)
  const settleAll = async (outcome: DunningClaimOutcome, reason: string | null, only?: Iterable<DunningCandidate>) => {
    for (const candidate of only ?? [...open]) {
      open.delete(candidate)
      await settle(ctx, candidate, outcome, reason)
    }
  }

  try {
    // Revalida quitação, disputa, desconto integral, Portal, Cliente ativo e
    // destinatário por fatura antes de compor a mensagem.
    const sendable: DunningCandidate[] = []
    for (const candidate of group) {
      if (await store.isSendable(candidate.invoice_id)) sendable.push(candidate)
      else await settleAll('paused', 'A Invoice deixou de ser cobrável antes do envio.', [candidate])
    }
    if (!sendable.length) return 'pausado'

    const contacts = await store.loadRecipients(customerId)
    if (!contacts.length) {
      await settleAll('paused', 'Cliente sem contato autorizado para a cobrança de Demurrage.')
      return 'pausado'
    }

    let lines: Line[] = []
    for (const candidate of sendable) lines.push(buildLine(candidate, await store.loadInvoice(candidate.invoice_id)))
    const anchor = lines[0]!.context
    const customerName = anchor.customer?.name ?? ''
    // Valida antes de criar o Comunicado: dado incompleto não deixa registro vazio.
    let template = render(mode, lines, customerName, config.portalUrl)
    assertRealSendConfigured(communicationsEnabled, config)

    const communicationId = await store.createCommunication({
      mode,
      candidates: sendable,
      anchor,
      vesselName: lines[0]!.line.vesselName,
      voyageNumber: lines[0]!.line.voyageNumber,
    })

    let succeeded = 0
    let failed = 0
    let permanentFailures = 0
    let unrecordedFailures = 0
    let eligibleRecipients = 0
    let lastError: string | null = null
    // Faturas já entregues a alguém: a posição delas fica consumida.
    const billed = new Set<DunningCandidate>()

    for (const contact of contacts) {
      // 1E.4: a fatura que deixou de ser cobrável sai da mensagem dos próximos
      // destinatários, sem abortar as demais nem reenviar a quem já recebeu.
      const stillSendable: Line[] = []
      for (const item of lines) {
        if (await store.isSendable(item.candidate.invoice_id)) stillSendable.push(item)
        else if (succeeded === 0) await settleAll('paused', 'A Invoice deixou de ser cobrável durante o envio.', [item.candidate])
        else ctx.log.warn(`${LOG_PREFIX} fatura saiu da mensagem durante o envio`, invoiceLog(item.candidate))
      }
      if (!stillSendable.length) break
      if (stillSendable.length !== lines.length) {
        lines = stillSendable
        template = render(mode, lines, customerName, config.portalUrl)
      }

      const recipient = await store.currentEligibleRecipient(customerId, contact.id)
      if (!recipient || !EMAIL_PATTERN.test(recipient)) continue
      eligibleRecipients += 1
      const resumeGeneration = Math.max(0, ...group.map((candidate) => candidate.resume_generation))
      const idempotencyKey = await dunningIdempotencyKey(mode, communicationId, contact.id, recipient, resumeGeneration)
      // Último estado gravado da tentativa: distingue recusa definitiva de falha passageira.
      const tracked: { status: EmailAttemptRecord['status'] | null; error: string | null } = { status: null, error: null }
      try {
        const sent = await sendEmail({
          kind: 'cobranca_demurrage',
          to: recipient,
          subject: template.subject,
          html: template.html,
          text: template.text,
          idempotencyKey,
          resendApiKey: communicationsEnabled ? config.resendApiKey : null,
          simulate: !communicationsEnabled,
          from: config.from,
          replyTo: config.replyTo,
          missingConfigurationMessage: MISSING_SENDER_MESSAGE,
          fetchImpl: ctx.fetcher,
          sleep: ctx.sleep,
          checkSuppression: (to) => store.checkSuppression(to),
          recordAttempt: async ({ idempotencyKey: attemptKey, to }) => {
            const record = await store.recordAttempt({
              communicationId,
              contactId: contact.id,
              communicationsEnabled,
              attemptKey,
              to,
              keyPrefix: mode === 'group' ? `demurrage:group:${communicationId}:` : `demurrage:${communicationId}:`,
            })
            tracked.status = record.status
            return record
          },
          updateAttempt: async (attemptId, update) => {
            tracked.status = update.status
            tracked.error = update.lastError ?? null
            await store.updateAttempt(attemptId, update)
          },
        })
        if (sent.ok) {
          succeeded += 1
          for (const item of lines) billed.add(item.candidate)
        } else {
          failed += 1
          const permanent = tracked.status === 'falha_permanente' || tracked.status === 'bounce' || tracked.status === 'complaint'
          if (permanent) permanentFailures += 1
          lastError = tracked.error ?? (tracked.status ? `Tentativa anterior em ${tracked.status}` : 'Destinatário suprimido')
          ctx.log.warn(`${LOG_PREFIX} envio não aceito`, {
            communicationId, customerId, attempt: group[0]!.attempt_discriminator, to: maskEmail(recipient),
            status: tracked.status, permanent, reason: lastError,
          })
        }
      } catch (error) {
        unrecordedFailures += 1
        lastError = errorMessage(error)
        ctx.log.error(`${LOG_PREFIX} falha no envio`, {
          communicationId, customerId, attempt: group[0]!.attempt_discriminator, to: maskEmail(recipient), reason: lastError,
        })
      }
    }

    // Sem decisão do banco, o Comunicado não fica "Em envio" para sempre (1B).
    const settleCommunicationStatus = async (): Promise<ResolvedDispatchStatus> => {
      const refreshed = await store.refreshStatus(communicationId)
      const resolved = resolveDispatchStatus({ refreshed, communicationsEnabled, succeeded, failed, unrecordedFailures })
      const persist = statusToPersist(refreshed, resolved)
      if (persist) await store.persistStatus(communicationId, persist)
      return resolved
    }

    if (succeeded === 0 && eligibleRecipients === 0) await settleAll('paused', 'Nenhum destinatário autorizado no momento do envio.')
    if (open.size === 0) {
      // Todas as faturas saíram da mensagem antes de qualquer entrega.
      await settleCommunicationStatus()
      return 'pausado'
    }

    const resolved = await settleCommunicationStatus()

    if (resolved === 'enviado' || resolved === 'simulado') {
      await settleAll('sent', null)
      return resolved
    }
    if (resolved === 'parcial') {
      // Não solta a posição: quem já recebeu não deve receber de novo.
      await settleAll('partial', permanentFailures > 0 ? lastError : null)
      return 'parcial'
    }
    // Falha: nada saiu nesta mensagem.
    if (billed.size === 0 && failed > 0 && permanentFailures === failed && unrecordedFailures === 0) {
      await settleAll('refused', lastError)
      return 'recusado'
    }
    await settleAll('failed', lastError ?? 'O envio não foi concluído.')
    return 'falha'
  } catch (error) {
    const reason = errorMessage(error)
    ctx.log.error(`${LOG_PREFIX} cobrança com erro`, { customerId, attempt: group[0]!.attempt_discriminator, invoices: group.map((item) => item.invoice_id), reason })
    if (open.size) await settleAll('failed', reason)
    return 'falha'
  }
}

export async function runDemurrageDunning(deps: DunningRunnerDeps): Promise<DunningRunResult> {
  const log = deps.log ?? console
  let communicationsEnabled: boolean
  let claimed: unknown
  try {
    [communicationsEnabled, claimed] = await Promise.all([
      deps.store.loadCommunicationsEnabled(),
      deps.store.claimCandidates((deps.asOf ?? new Date()).toISOString(), CLAIM_BATCH_SIZE),
    ])
  } catch (error) {
    log.error(`${LOG_PREFIX} falha ao preparar o ciclo`, errorMessage(error))
    return { status: 500, body: { error: 'Falha ao preparar a régua de Demurrage.' } }
  }

  const candidates = asCandidates(claimed)
  const body = { claimed: candidates.length, sent: 0, simulated: 0, partial: 0, failed: 0, refused: 0, paused: 0, releaseFailures: 0 }
  // Uma falha ao gravar o desfecho não pode virar "enviado"; conta à parte.
  const store: DunningStore = {
    ...deps.store,
    settleClaim: async (candidate, outcome, reason) => {
      try {
        await deps.store.settleClaim(candidate, outcome, reason)
      } catch (error) {
        body.releaseFailures += 1
        log.error(`${LOG_PREFIX} falha ao gravar o desfecho da cobrança`, { ...invoiceLog(candidate), outcome, reason: errorMessage(error) })
      }
    },
  }
  const ctx: GroupContext = { store, config: deps.config, communicationsEnabled, fetcher: deps.fetcher, sleep: deps.sleep, log }

  for (const group of groupDunningCandidatesByCustomerCycle(candidates)) {
    const outcome = await sendGroup(ctx, group)
    if (outcome === 'enviado') body.sent += 1
    else if (outcome === 'simulado') body.simulated += 1
    else if (outcome === 'parcial') body.partial += 1
    else if (outcome === 'pausado') body.paused += 1
    else if (outcome === 'recusado') {
      body.refused += 1
      body.failed += 1
    } else body.failed += 1
  }
  return { status: body.releaseFailures ? 500 : 200, body }
}
