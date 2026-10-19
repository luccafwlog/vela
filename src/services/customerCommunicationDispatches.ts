import {
  assertValidCommunicationAttachments,
  type CommunicationAttachment,
  type CustomerCommunicationKind,
} from './customerCommunicationTemplates'
import { customerCommunicationAttemptReason, getCustomerCommunicationNature } from './customerCommunications'
import type { CustomerCommunicationAudience } from './customerCommunicationBoxes'
import { supabase } from './supabase'

export type CustomerCommunicationDispatchAttachment = CommunicationAttachment & {
  contentBase64: string
}

export type CustomerCommunicationDispatchInput = {
  customerId: number
  kind: CustomerCommunicationKind
  nature?: string
  audience?: CustomerCommunicationAudience
  recipient: string
  subject: string
  html: string
  /** Texto escrito pela equipe em `livre`/`institucional`; o servidor renderiza a partir dele. */
  messageBody?: string
  text: string
  blIds?: readonly string[]
  anchorVoyageId?: number | null
  anchorPort?: string | null
  anchorAtracacaoId?: string | null
  anchorInvoiceId?: number | null
  attemptDiscriminator?: number
  dispatchId?: string | null
  vesselName?: string | null
  voyageNumber?: string | null
  terminalName?: string | null
  attachments?: readonly CustomerCommunicationDispatchAttachment[]
}

export type CustomerCommunicationDispatchResult = {
  communicationId: number
  attemptId?: number
  status: 'pendente' | 'enviado' | 'simulado' | 'parcial' | 'falha'
  /** Modo deste destinatário; `status` é o agregado do Comunicado. */
  dispatchMode?: 'real' | 'simulado'
  suppressed?: boolean
  message?: string
}

/**
 * Recusa da Edge com o que o corpo dela diz: o motivo e se repetir adianta.
 * `permanent` vem do 422 de payload e do 502 com recusa definitiva do provedor;
 * endereço suprimido (`suppressed`) também não muda com outra tentativa.
 */
export class CustomerCommunicationDispatchError extends Error {
  readonly permanent: boolean
  readonly communicationId?: number

  constructor(message: string, options: { permanent?: boolean; communicationId?: number } = {}) {
    super(message)
    this.name = 'CustomerCommunicationDispatchError'
    this.permanent = options.permanent ?? false
    this.communicationId = options.communicationId
  }
}

async function readFunctionErrorBody(error: unknown): Promise<Record<string, unknown> | null> {
  const context = error && typeof error === 'object'
    ? (error as { context?: unknown }).context
    : null
  if (!context || typeof context !== 'object' || typeof (context as { json?: unknown }).json !== 'function') return null

  try {
    const body = await (context as { json: () => Promise<unknown> }).json()
    return body && typeof body === 'object' ? body as Record<string, unknown> : null
  } catch {
    return null
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * O 502 do envio comum traz `reason` com o `last_error` da tentativa; ele vem
 * traduzido antes da mensagem genérica, para o resumo dizer por que falhou.
 */
function functionErrorFromBody(body: Record<string, unknown>): CustomerCommunicationDispatchError | null {
  const technicalReason = nonEmptyString(body.reason)
  const message = nonEmptyString(body.error)
    ?? (technicalReason ? customerCommunicationAttemptReason(technicalReason) : null)
    ?? nonEmptyString(body.message)
  if (!message) return null
  const communicationId = Number(body.communicationId)
  return new CustomerCommunicationDispatchError(message, {
    permanent: body.permanent === true || body.suppressed === true,
    communicationId: Number.isFinite(communicationId) && communicationId > 0 ? communicationId : undefined,
  })
}

function makeIdempotencyKey(input: CustomerCommunicationDispatchInput): string {
  const anchor = [
    input.anchorVoyageId ?? '',
    input.anchorPort?.trim().toUpperCase() ?? '',
    input.anchorAtracacaoId ?? '',
    input.anchorInvoiceId ?? '',
  ].join(':')
  const audienceKey = input.audience
    ? input.audience.mode === 'caixa'
      ? `caixa:${input.audience.boxCode}`
      : 'todos'
    : ''
  return `comunicado:${input.kind}:${audienceKey}:${input.customerId}:${anchor}:${input.dispatchId ?? ''}:${input.attemptDiscriminator ?? 0}:${input.recipient.trim().toLowerCase()}`
}

export function customerCommunicationDispatchPayload(input: CustomerCommunicationDispatchInput) {
  const nature = input.nature ?? getCustomerCommunicationNature(input.kind)
  assertValidCommunicationAttachments(input.kind, input.attachments)
  const audienceMode = input.audience?.mode ?? (input.kind === 'institucional' ? 'todos' : 'caixa')
  const recipientBoxCode = input.audience?.mode === 'caixa' ? input.audience.boxCode : null
  return {
    customer_id: input.customerId,
    kind: input.kind,
    nature,
    audience_mode: audienceMode,
    recipient_box_code: recipientBoxCode,
    recipient: input.recipient.trim().toLowerCase(),
    subject: input.subject,
    html: input.html,
    text: input.text,
    message_body: input.messageBody ?? null,
    bl_ids: [...(input.blIds ?? [])],
    anchor_voyage_id: input.anchorVoyageId ?? null,
    anchor_port: input.anchorPort?.trim().toUpperCase() || null,
    anchor_atracacao_id: input.anchorAtracacaoId ?? null,
    anchor_invoice_id: input.anchorInvoiceId ?? null,
    attempt_discriminator: input.attemptDiscriminator ?? 0,
    dispatch_id: input.dispatchId ?? null,
    vessel_name: input.vesselName ?? null,
    voyage_number: input.voyageNumber ?? null,
    terminal_name: input.terminalName ?? null,
    idempotency_key: makeIdempotencyKey(input),
    attachments: (input.attachments ?? []).map((attachment) => ({
      filename: attachment.filename,
      content_type: attachment.contentType,
      size: attachment.size,
      content_base64: attachment.contentBase64,
    })),
  }
}

export async function dispatchCustomerCommunication(input: CustomerCommunicationDispatchInput): Promise<CustomerCommunicationDispatchResult> {
  const { data, error } = await supabase.functions.invoke('send-customer-communication', {
    body: customerCommunicationDispatchPayload(input),
  })
  if (error) {
    const body = await readFunctionErrorBody(error)
    const functionError = body ? functionErrorFromBody(body) : null
    if (functionError) throw functionError
    throw error
  }
  const result = data as CustomerCommunicationDispatchResult & { error?: string }
  if (result?.error) throw new Error(result.error)
  return result
}

export async function dispatchCustomerCommunications(
  inputs: readonly CustomerCommunicationDispatchInput[],
): Promise<CustomerCommunicationDispatchResult[]> {
  const results: CustomerCommunicationDispatchResult[] = []
  // Mantém uma tentativa por cliente e evita rajadas paralelas no provider.
  for (const input of inputs) results.push(await dispatchCustomerCommunication(input))
  return results
}

/** Um destinatário de um disparo em lote, com o rótulo que a tela mostra no resumo. */
export type CustomerCommunicationBatchItem = {
  key: string
  customerName: string
  input: CustomerCommunicationDispatchInput
}

export type CustomerCommunicationBatchOutcome = CustomerCommunicationBatchItem & {
  result: 'enviado' | 'simulado' | 'falha'
  communicationId?: number
  reason?: string
  /** Falha que outra tentativa não resolve: fica fora de "Repetir só as falhas". */
  permanent?: boolean
}

export type CustomerCommunicationBatchSummary = {
  outcomes: CustomerCommunicationBatchOutcome[]
  sent: number
  simulated: number
  failed: CustomerCommunicationBatchOutcome[]
  /** As falhas que "Repetir só as falhas" reenvia; as definitivas ficam de fora. */
  retryable: CustomerCommunicationBatchOutcome[]
}

export function summarizeCustomerCommunicationBatch(outcomes: readonly CustomerCommunicationBatchOutcome[]): CustomerCommunicationBatchSummary {
  const failed = outcomes.filter((outcome) => outcome.result === 'falha')
  return {
    outcomes: [...outcomes],
    sent: outcomes.filter((outcome) => outcome.result === 'enviado').length,
    simulated: outcomes.filter((outcome) => outcome.result === 'simulado').length,
    failed,
    retryable: failed.filter((outcome) => !outcome.permanent),
  }
}

/**
 * Disparo em lote da tela (plano dos e-mails, 3.2): um destinatário por vez, para
 * não fazer rajada no provedor; a falha de um não interrompe os seguintes, e cada
 * um volta com o motivo. Repetir um item reenvia o mesmo `input` — mesmo
 * `dispatchId`, discriminador e chave —, então cai no mesmo Comunicado e o
 * servidor não duplica quem já recebeu.
 */
export async function runCustomerCommunicationBatch(
  items: readonly CustomerCommunicationBatchItem[],
  dispatch: (input: CustomerCommunicationDispatchInput) => Promise<CustomerCommunicationDispatchResult> = dispatchCustomerCommunication,
): Promise<CustomerCommunicationBatchOutcome[]> {
  const outcomes: CustomerCommunicationBatchOutcome[] = []
  for (const item of items) {
    try {
      const response = await dispatch(item.input)
      if (response.status === 'falha') {
        outcomes.push({ ...item, result: 'falha', communicationId: response.communicationId, reason: response.message ?? 'Falha no envio do comunicado.' })
      } else {
        // O agregado pode ser "parcial" por outro destinatário: o modo da resposta diz se este saiu simulado.
        const simulated = response.dispatchMode ? response.dispatchMode === 'simulado' : response.status === 'simulado'
        outcomes.push({ ...item, result: simulated ? 'simulado' : 'enviado', communicationId: response.communicationId })
      }
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message : 'Falha no envio do comunicado.'
      if (error instanceof CustomerCommunicationDispatchError) {
        outcomes.push({ ...item, result: 'falha', reason, communicationId: error.communicationId, permanent: error.permanent })
      } else {
        outcomes.push({ ...item, result: 'falha', reason })
      }
    }
  }
  return outcomes
}

/** Junta o resultado de "Repetir só as falhas" ao lote original, item a item. */
export function mergeCustomerCommunicationBatchRetry(
  previous: readonly CustomerCommunicationBatchOutcome[],
  retried: readonly CustomerCommunicationBatchOutcome[],
): CustomerCommunicationBatchOutcome[] {
  const byKey = new Map(retried.map((outcome) => [outcome.key, outcome]))
  return previous.map((outcome) => byKey.get(outcome.key) ?? outcome)
}
