import { supabase } from './supabase'
import {
  CUSTOMER_COMMUNICATION_BOXES,
} from './customerCommunicationBoxes'
import type {
  PortalContactBox,
  PortalContactDraft,
  PortalContactItem,
  PortalContactConfiguration,
} from './portalContactConfiguration'

export type {
  PortalContactBox,
  PortalContactDraft,
  PortalContactItem,
  PortalContactConfiguration,
}

export type CustomerContactConfiguration = PortalContactConfiguration

export async function fetchCustomerContactConfiguration(
  customerId: number,
): Promise<CustomerContactConfiguration> {
  const [{ data: boxes, error: boxesError }, { data: contacts, error: contactsError }] =
    await Promise.all([
      supabase
        .from('customer_communication_boxes')
        .select('code, label, description, sort_order, active')
        .eq('active', true)
        .order('sort_order', { ascending: true }),
      supabase
        .from('customer_contacts')
        .select('*')
        .eq('customer_id', customerId)
        .order('is_primary', { ascending: false })
        .order('id', { ascending: true }),
    ])

  if (boxesError) throw boxesError
  if (contactsError) throw contactsError

  const contactList = contacts ?? []
  const contactIds = contactList.map((c) => c.id)
  // (ponytail: supressoes filtradas por e-mail como em finance/dunning; full-scan
  // truncava em max_rows=1000. Upgrade seria RPC server-side.)
  const contactEmails = [...new Set(
    contactList.flatMap((c) => {
      const email = String((c as { email?: unknown }).email ?? '').trim()
      return email ? [email, email.toLowerCase()] : []
    }),
  )]

  const [{ data: links, error: linksError }, { data: portalSuppressions }, { data: commSuppressions }] =
    await Promise.all([
      contactIds.length > 0
        ? supabase
            .from('customer_contact_box_links')
            .select('contact_id, box_code')
            .in('contact_id', contactIds)
        : Promise.resolve({ data: [], error: null }),
      contactEmails.length > 0
        ? supabase.from('portal_suppressed_emails').select('email, reason').in('email', contactEmails)
        : Promise.resolve({ data: [], error: null }),
      contactEmails.length > 0
        ? supabase.from('customer_communication_suppressions').select('email, reason').in('email', contactEmails)
        : Promise.resolve({ data: [], error: null }),
    ])

  if (linksError) throw linksError

  const linksByContact = new Map<number, string[]>()
  for (const link of links ?? []) {
    const list = linksByContact.get(link.contact_id) ?? []
    list.push(link.box_code)
    linksByContact.set(link.contact_id, list)
  }

  const bounceEmails = new Set(
    (portalSuppressions ?? [])
      .filter((s) => s.reason === 'bounce_permanente')
      .map((s) => (s.email || '').trim().toLowerCase()),
  )
  const complaintEmails = new Set(
    (commSuppressions ?? []).map((s) => (s.email || '').trim().toLowerCase()),
  )

  const formattedContacts: PortalContactItem[] = contactList.map((c) => {
    const emailNorm = (c.email || '').trim().toLowerCase()
    const isBounce = bounceEmails.has(emailNorm)
    const isComplaint = complaintEmails.has(emailNorm)
    const suppressionReason = isBounce
      ? 'suprimido_bounce'
      : isComplaint
      ? 'suprimido_complaint'
      : null

    const isActive = c.deactivated_at == null
    const boxCodes = linksByContact.get(c.id) ?? []
    const isSendable =
      isActive && Boolean(emailNorm) && !isBounce && !isComplaint

    return {
      id: c.id,
      customer_id: c.customer_id ?? customerId,
      name: c.name,
      email: c.email ?? '',
      email_normalized: emailNorm,
      phone: c.phone,
      is_primary: Boolean(c.is_primary),
      active: isActive,
      origin: (c as { origin?: string }).origin ?? 'interno',
      box_codes: boxCodes,
      suppression_reason: suppressionReason,
      sendable: isSendable,
    }
  })

  return {
    boxes: (boxes as PortalContactBox[]) ?? (CUSTOMER_COMMUNICATION_BOXES as unknown as PortalContactBox[]),
    contacts: formattedContacts,
  }
}

export async function internalSaveCustomerContactConfiguration(
  customerId: number,
  contacts: readonly PortalContactDraft[],
  justification?: string,
): Promise<CustomerContactConfiguration> {
  const { data, error } = await supabase.rpc(
    'internal_save_customer_contact_configuration' as never,
    {
      p_customer_id: customerId,
      p_contacts: contacts.map(({ id, name, email, phone, isPrimary, active, boxCodes }) => ({
        id,
        name: name ? name.trim() : null,
        email: email ? email.trim() : null,
        phone: phone ? phone.trim() : null,
        is_primary: isPrimary,
        active,
        box_codes: boxCodes,
      })),
      p_justification: justification ?? null,
    } as never,
  )

  if (error) throw error
  return (data ?? { boxes: [], contacts: [] }) as CustomerContactConfiguration
}

export async function deactivateCustomerContact(
  customerId: number,
  contactId: number,
  currentContacts: readonly PortalContactDraft[],
  justification?: string,
): Promise<CustomerContactConfiguration> {
  const updated = currentContacts.map((c) =>
    c.id === contactId ? { ...c, active: false } : c,
  )
  return internalSaveCustomerContactConfiguration(customerId, updated, justification)
}

export async function reactivateCustomerContact(
  customerId: number,
  contactId: number,
  currentContacts: readonly PortalContactDraft[],
  justification?: string,
): Promise<CustomerContactConfiguration> {
  const updated = currentContacts.map((c) =>
    c.id === contactId ? { ...c, active: true } : c,
  )
  return internalSaveCustomerContactConfiguration(customerId, updated, justification)
}

/**
 * Caixa sem destinatário recebe o contato principal, gravado pelo sistema
 * (migration 223): o servidor calcula as caixas e registra o evento com
 * origem "sistema". Devolve as caixas completadas (vazio quando nada mudou).
 */
export async function fillEmptyContactBoxes(customerId: number): Promise<string[]> {
  // ponytail: RPC só da migration 223; cast local até database.ts ser regenerado.
  const { data, error } = await supabase.rpc('internal_fill_empty_contact_boxes' as never, { p_customer_id: customerId } as never)
  if (error) throw error
  const filled = (data as { filled?: unknown } | null)?.filled
  return Array.isArray(filled) ? filled.map(String) : []
}
