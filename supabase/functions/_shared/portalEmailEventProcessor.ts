import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { maskEmail, sendPortalEmail } from './portalEmail.ts'
import { bounceNotificationTemplate } from './portalEmailTemplates.ts'
import { resolveBounceCascade, type BounceContact } from './portalBounceCascade.ts'
import { canonicalPortalOrigin, portalSupportEmail } from './portalUrls.ts'
import { logPortalEmailEvent } from './logger.ts'

const BOUNCE_NOTIFICATION_KIND = 'contato_bounced_notificacao'

type AdminClient = ReturnType<typeof createClient>

type PortalEmailEventResult = {
  event_id?: number
  status?: string
  processed?: boolean
  ignored_unknown_event?: boolean
  should_cascade?: boolean
  portal_recovery_attempt?: boolean
  permanent_bounce?: boolean
  email?: string | null
  customer_ids?: number[]
  [key: string]: unknown
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

async function isCommunicationsEnabled(admin: AdminClient): Promise<boolean> {
  // D04: o aviso de bounce ao cliente respeita a chave global de Comunicados.
  // Supressão, reparo e alertas internos não dependem desta chave.
  try {
    const { data, error } = await admin
      .from('app_settings')
      .select('communications_enabled')
      .eq('id', 1)
      .maybeSingle()
    if (error) return false
    return Boolean((data as { communications_enabled?: boolean } | null)?.communications_enabled)
  } catch {
    return false
  }
}

async function sendBounceNotification(
  admin: AdminClient,
  customerId: number,
  bouncedEmail: string,
  recipient: BounceContact,
): Promise<boolean> {
  if (!recipient.email || !await isCommunicationsEnabled(admin)) return true

  const normalizedBouncedEmail = normalizeEmail(bouncedEmail)
  const template = bounceNotificationTemplate({
    bouncedEmailMasked: maskEmail(normalizedBouncedEmail),
    portalUrl: canonicalPortalOrigin(),
    supportEmail: portalSupportEmail(),
  })

  try {
    const sent = await sendPortalEmail({
      admin,
      kind: BOUNCE_NOTIFICATION_KIND,
      to: recipient.email,
      subject: template.subject,
      html: template.html,
      text: template.text,
      idempotencyKey: `${BOUNCE_NOTIFICATION_KIND}:${customerId}:${normalizedBouncedEmail}:${recipient.id}`,
    })
    if (!sent.ok) logPortalEmailEvent({ job: 'bounce_notification', status: 'error', errorCode: 'email_send_failed' })
    return true
  } catch {
    logPortalEmailEvent({ job: 'bounce_notification', status: 'error', errorCode: 'email_send_exception' })
    return false
  }
}

async function openNoAlternativeAlert(admin: AdminClient, customerId: number): Promise<boolean> {
  try {
    const { data: customer, error: customerError } = await admin
      .from('customers')
      .select('cnpj_cpf')
      .eq('id', customerId)
      .maybeSingle()
    if (customerError) throw customerError

    const { error } = await admin.rpc('upsert_alert_item', {
      p_type: 'cliente_contato_bounced_sem_alternativa',
      p_entity_type: 'customer',
      p_entity_id: String(customerId),
      p_message: 'Cliente sem contato alternativo válido após bounce permanente; atualize o cadastro.',
      p_source: 'portal_email_events_runner',
      p_department: 'documentacao',
      p_metadata: {
        customer_id: customerId,
        customer_cnpj: customer?.cnpj_cpf ?? null,
        reason: 'all_contacts_bounced_or_suppressed',
      },
      p_destination: '/clientes',
    })
    if (error) throw error
    return true
  } catch {
    logPortalEmailEvent({ job: 'contact_alert', status: 'error', errorCode: 'alert_upsert_failed' })
    return false
  }
}

async function loadPortalSuppressionSets(
  admin: AdminClient,
  contacts: readonly BounceContact[],
): Promise<{ portalSuppressedEmails: string[]; sharedBounceEmails: string[] }> {
  const emails = [...new Set(contacts
    .map((contact) => contact.email)
    .filter((email): email is string => Boolean(email))
    .map(normalizeEmail))]
  if (!emails.length) return { portalSuppressedEmails: [], sharedBounceEmails: [] }

  const { data, error } = await admin
    .from('portal_suppressed_emails')
    .select('email, reason')
    .in('email', emails)
  if (error) throw error

  const suppressions = (data ?? []) as Array<{ email: string; reason: string }>
  return {
    portalSuppressedEmails: suppressions.map((suppression) => normalizeEmail(suppression.email)),
    sharedBounceEmails: suppressions
      .filter((suppression) => suppression.reason === 'bounce_permanente')
      .map((suppression) => normalizeEmail(suppression.email)),
  }
}

async function handleBounceCascade(
  admin: AdminClient,
  customerIds: readonly number[],
  bouncedEmail: string,
): Promise<number> {
  let failures = 0
  for (const customerId of [...new Set(customerIds)]) {
    const { data: contacts, error: contactsError } = await admin
      .from('customer_contacts')
      .select('id, email, is_primary, deactivated_at')
      .eq('customer_id', customerId)
    if (contactsError) {
      logPortalEmailEvent({ job: 'contact_lookup', status: 'error', errorCode: 'contact_lookup_failed' })
      failures += 1
      continue
    }

    const bounceContacts = (contacts ?? []) as BounceContact[]
    let suppressionSets: { portalSuppressedEmails: string[]; sharedBounceEmails: string[] }
    try {
      suppressionSets = await loadPortalSuppressionSets(admin, bounceContacts)
    } catch {
      logPortalEmailEvent({ job: 'suppression_lookup', status: 'error', errorCode: 'suppression_lookup_failed' })
      failures += 1
      continue
    }

    const decision = resolveBounceCascade({
      contacts: bounceContacts,
      bouncedEmail,
      ...suppressionSets,
    })

    if (decision.notificationRecipient && !await sendBounceNotification(admin, customerId, bouncedEmail, decision.notificationRecipient)) {
      failures += 1
    }
    if (decision.shouldOpenAlert && !await openNoAlternativeAlert(admin, customerId)) failures += 1
  }
  return failures
}

export async function processPortalEmailEvent(
  admin: AdminClient,
  eventId: number,
  workerId: string,
): Promise<PortalEmailEventResult> {
  const { data, error } = await admin.rpc('process_portal_email_event', {
    p_event_id: eventId,
    p_worker_id: workerId,
  })
  if (error) throw error

  const result = (data ?? {}) as PortalEmailEventResult
  if (result.status !== 'processing' || result.processed !== true) return result

  if (result.should_cascade && result.email) {
    const failures = await handleBounceCascade(admin, result.customer_ids ?? [], result.email)
    if (failures > 0) throw new Error(`bounce_secondary_effects_failed:${failures}`)
  }

  const { data: completion, error: completionError } = await admin.rpc('complete_portal_email_event', {
    p_event_id: eventId,
    p_worker_id: workerId,
    p_status: 'processed',
  })
  if (completionError) throw completionError

  return { ...result, status: 'processed', completion }
}
