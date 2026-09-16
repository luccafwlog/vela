import {
  assertValidCommunicationAttachments,
  type CommunicationAttachment,
  type CustomerCommunicationKind,
} from './customerCommunicationTemplates'
import { getCustomerCommunicationNature } from './customerCommunications'
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
  status: 'enviado' | 'simulado' | 'parcial' | 'falha'
  suppressed?: boolean
  message?: string
}

async function readFunctionErrorMessage(error: unknown): Promise<string | null> {
  const context = error && typeof error === 'object'
    ? (error as { context?: unknown }).context
    : null
  if (!context || typeof context !== 'object' || typeof (context as { json?: unknown }).json !== 'function') return null

  try {
    const body = await (context as { json: () => Promise<unknown> }).json()
    if (!body || typeof body !== 'object') return null
    const message = (body as { error?: unknown; message?: unknown }).error
      ?? (body as { error?: unknown; message?: unknown }).message
    return typeof message === 'string' && message.trim() ? message.trim() : null
  } catch {
    return null
  }
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
    const functionMessage = await readFunctionErrorMessage(error)
    if (functionMessage) throw new Error(functionMessage)
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
