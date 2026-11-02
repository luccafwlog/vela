import type { CustomerContact } from '../types/database'
import { renderCeMercanteTaxasTemplate } from './customerCommunicationTemplates'
import {
  customerCommunicationReadinessReasonLabel,
  fetchCustomerLocalChargesCommunicationReadiness,
  type CustomerLocalChargesCommunicationReadiness,
} from './customerCommunicationReadiness'
import {
  dispatchCustomerCommunication,
  type CustomerCommunicationDispatchResult,
} from './customerCommunicationDispatches'
import type { EmailSuppressionRow } from './customerCommunications'
import {
  fetchCommunicationBoxKinds,
  resolveCustomerCommunicationRecipientsByBoxes,
  type CustomerContactBoxLink,
} from './customerCommunicationBoxes'
import {
  buildCeMercanteInput,
  ceMercanteReadinessReason,
  fetchFinanceBls,
  fetchInvoiceBls,
} from './ceMercanteTaxasInput'
import { supabase } from './supabase'

type CommunicationHistoryRow = {
  id: number
  status: string
  attempt_discriminator: number
  created_at: string
}

export type CeMercanteCommunicationDispatchSummary = {
  status: 'enviado' | 'simulado' | 'parcial' | 'falha' | 'bloqueado' | 'ignorado'
  readiness: CustomerLocalChargesCommunicationReadiness
  sentCount: number
  simulatedCount: number
  /** Destinatários que falharam; os demais seguiram (a falha de um não para o reenvio). */
  failedCount: number
  communicationIds: number[]
  attemptDiscriminator: number
  reason: string | null
  /** B/Ls do Cliente na Viagem, para a linha do tempo de cada um ser relida. */
  blIds: string[]
}

type RecipientDispatchResult = Pick<CustomerCommunicationDispatchResult, 'status'> & {
  communicationId?: number
  reason?: string
}

function readinessBlIds(readiness: CustomerLocalChargesCommunicationReadiness): string[] {
  return readiness.bls.map((bl) => bl.bl_id)
}

async function fetchContacts(customerId: number): Promise<{
  contacts: CustomerContact[]
  boxLinks: CustomerContactBoxLink[]
  communicationSuppressions: EmailSuppressionRow[]
  portalSuppressions: EmailSuppressionRow[]
}> {
  const { data: contactData, error: contactError } = await supabase
    .from('customer_contacts')
    .select('*')
    .eq('customer_id', customerId)
  if (contactError) throw contactError
  const contacts = (contactData ?? []) as CustomerContact[]
  const contactIds = contacts.map((contact) => contact.id)
  const contactEmails = [...new Set(contacts.flatMap((contact) => {
    const email = (contact.email ?? '').trim()
    return email ? [email, email.toLowerCase()] : []
  }))]
  const [boxLinksResult, communicationSuppressionsResult, portalSuppressionsResult] = await Promise.all([
    contactIds.length
      ? supabase.from('customer_contact_box_links').select('contact_id, box_code').in('contact_id', contactIds)
      : Promise.resolve({ data: [], error: null }),
    contactEmails.length
      ? supabase.from('customer_communication_suppressions').select('email, reason').in('email', contactEmails)
      : Promise.resolve({ data: [], error: null }),
    contactEmails.length
      ? supabase.from('portal_suppressed_emails').select('email, reason').in('email', contactEmails)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (boxLinksResult.error) throw boxLinksResult.error
  if (communicationSuppressionsResult.error) throw communicationSuppressionsResult.error
  if (portalSuppressionsResult.error) throw portalSuppressionsResult.error
  return {
    contacts,
    boxLinks: (boxLinksResult.data ?? []) as CustomerContactBoxLink[],
    communicationSuppressions: (communicationSuppressionsResult.data ?? []) as EmailSuppressionRow[],
    portalSuppressions: (portalSuppressionsResult.data ?? []) as EmailSuppressionRow[],
  }
}

async function fetchCommunicationHistory(voyageId: number, customerId: number): Promise<CommunicationHistoryRow[]> {
  const { data, error } = await supabase
    .from('customer_communications')
    .select('id, status, attempt_discriminator, created_at')
    .eq('kind', 'ce_mercante_taxas')
    .eq('customer_id', customerId)
    .eq('anchor_voyage_id', voyageId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as CommunicationHistoryRow[]
}

function nextAttempt(history: readonly CommunicationHistoryRow[]): number {
  if (!history.length) return 1
  return Math.max(...history.map((row) => Number(row.attempt_discriminator) || 0)) + 1
}

export async function dispatchCeMercanteTaxasCommunication(
  voyageId: number,
  customerId: number,
  options: { forceRetry?: boolean } = {},
): Promise<CeMercanteCommunicationDispatchSummary> {
  const readiness = await fetchCustomerLocalChargesCommunicationReadiness(voyageId, customerId)
  if (!readiness.ready) {
    return {
      status: 'bloqueado',
      readiness,
      sentCount: 0,
      simulatedCount: 0,
      failedCount: 0,
      communicationIds: [],
      attemptDiscriminator: 0,
      reason: ceMercanteReadinessReason(readiness),
      blIds: readinessBlIds(readiness),
    }
  }

  const history = await fetchCommunicationHistory(voyageId, customerId)
  const hasAutomaticAttempt = history.some((row) => (
    Number(row.attempt_discriminator) === 0
      && (row.status === 'enviado' || row.status === 'simulado')
  ))
  const automaticAttemptFailed = history.some((row) => (
    Number(row.attempt_discriminator) === 0 && row.status === 'falha'
  ))
  if (hasAutomaticAttempt && !options.forceRetry) {
    return {
      status: 'ignorado',
      readiness,
      sentCount: 0,
      simulatedCount: 0,
      failedCount: 0,
      communicationIds: [],
      attemptDiscriminator: 0,
      reason: 'Comunicado automático já registrado; o reenvio deve ser assistido pela tela.',
      blIds: readinessBlIds(readiness),
    }
  }

  const bls = await fetchFinanceBls(voyageId, customerId)
  if (!bls.length) {
    return {
      status: 'bloqueado',
      readiness,
      sentCount: 0,
      simulatedCount: 0,
      failedCount: 0,
      communicationIds: [],
      attemptDiscriminator: 0,
      reason: customerCommunicationReadinessReasonLabel('no_bls'),
      blIds: [],
    }
  }
  const invoiceBls = await fetchInvoiceBls(bls.map((bl) => bl.id))
  const templateInput = buildCeMercanteInput(bls, invoiceBls)
  const [contacts, boxKinds] = await Promise.all([
    fetchContacts(customerId),
    fetchCommunicationBoxKinds('ce_mercante_taxas'),
  ])
  const recipients = resolveCustomerCommunicationRecipientsByBoxes({
    contacts: contacts.contacts,
    boxLinks: contacts.boxLinks,
    boxKinds,
    kind: 'ce_mercante_taxas',
    communicationSuppressions: contacts.communicationSuppressions,
    portalSuppressions: contacts.portalSuppressions,
  })
  if (recipients.blocked) {
    return {
      status: 'bloqueado',
      readiness,
      sentCount: 0,
      simulatedCount: 0,
      failedCount: 0,
      communicationIds: [],
      attemptDiscriminator: options.forceRetry || automaticAttemptFailed ? nextAttempt(history) : 0,
      reason: 'Cliente sem contato válido habilitado para Documentação e Operação ou Financeiro.',
      blIds: bls.map((bl) => bl.id),
    }
  }

  const rendered = renderCeMercanteTaxasTemplate(templateInput)
  const attemptDiscriminator = options.forceRetry || automaticAttemptFailed ? nextAttempt(history) : 0
  const results: RecipientDispatchResult[] = []
  for (const contact of recipients.eligible) {
    if (!contact.email?.trim()) continue
    // A recusa de um destinatário (502 do provedor, 422 de contato) não para os
    // demais: parar aqui deixava parte sem e-mail, e repetir reenviava a quem
    // já tinha recebido.
    try {
      results.push(await dispatchCustomerCommunication({
        customerId,
        kind: 'ce_mercante_taxas',
        nature: 'documentacao',
        audience: { mode: 'caixa', boxCode: contact.matchedBoxCodes[0] ?? 'documentacao_operacao' },
        recipient: contact.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        blIds: rendered.blIds,
        anchorVoyageId: voyageId,
        // A viagem pode ter mais de um POD. O porto não é parte da identidade
        // deste comunicado financeiro agrupado; usar o primeiro B/L tornava a
        // idempotência dependente da ordem arbitrária do SELECT.
        anchorPort: null,
        attemptDiscriminator,
        vesselName: templateInput.vesselName,
        voyageNumber: templateInput.voyageNumber,
        attachments: [],
      }))
    } catch (error) {
      const communicationId = Number((error as { communicationId?: unknown } | null)?.communicationId)
      results.push({
        status: 'falha',
        communicationId: Number.isFinite(communicationId) && communicationId > 0 ? communicationId : undefined,
        reason: error instanceof Error && error.message ? error.message : 'Falha no envio do comunicado.',
      })
    }
  }
  const communicationIds = [...new Set(results.flatMap((result) => (
    result.communicationId != null && Number.isFinite(result.communicationId) ? [result.communicationId] : []
  )))]
  const sentCount = results.filter((result) => result.status === 'enviado').length
  const simulatedCount = results.filter((result) => result.status === 'simulado').length
  const failedCount = results.filter((result) => result.status === 'falha').length
  const firstFailureReason = results.find((result) => result.reason)?.reason ?? null
  const hasFailed = failedCount > 0
  const hasPartial = results.some((result) => result.status === 'parcial')
  const hasSent = sentCount > 0
  const hasSimulated = simulatedCount > 0
  const status = hasSent && !hasSimulated && !hasFailed && !hasPartial
    ? 'enviado'
    : hasSimulated && !hasSent && !hasFailed && !hasPartial
      ? 'simulado'
      : hasSent || hasSimulated || hasPartial
        ? 'parcial'
        : hasFailed
          ? 'falha'
          : 'bloqueado'
  return {
    status,
    readiness,
    sentCount,
    simulatedCount,
    failedCount,
    communicationIds,
    attemptDiscriminator,
    reason: !results.length
      ? 'Nenhum contato válido habilitado para Documentação.'
      : status === 'falha'
        ? firstFailureReason ?? 'Falha no envio de todos os destinatários.'
        : hasFailed ? firstFailureReason : null,
    blIds: [...rendered.blIds],
  }
}
