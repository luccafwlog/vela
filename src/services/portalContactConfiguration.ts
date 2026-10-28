import { callPortalRpc, clientPortalScope, type PortalScope } from './portalScope'

export type PortalContactBox = {
  code: string
  label: string
  description: string
  sort_order: number
  active: boolean
}

export type PortalContactDraft = {
  id: number | null
  name: string | null
  email: string | null
  phone: string | null
  isPrimary: boolean
  active: boolean
  origin?: string
  boxCodes: string[]
  suppressionReason?: string | null
  sendable?: boolean
  /**
   * E-mail ao qual a supressão se refere, como veio do banco. Trocar o e-mail
   * no rascunho libera o contato (D14 de 2026-10-27).
   */
  suppressedEmail?: string | null
}

export type PortalContactItem = {
  id: number
  customer_id?: number
  name: string | null
  email: string
  email_normalized?: string
  phone: string | null
  is_primary: boolean
  active: boolean
  origin: string
  box_codes: string[]
  suppression_reason: string | null
  sendable: boolean
}

export type PortalContactConfiguration = {
  boxes: PortalContactBox[]
  contacts: PortalContactItem[]
}

export async function portalGetContactConfiguration(
  scope: PortalScope = clientPortalScope,
): Promise<PortalContactConfiguration> {
  const data = await callPortalRpc<PortalContactConfiguration>(
    scope,
    'portal_get_contact_configuration',
  )
  return data ?? { boxes: [], contacts: [] }
}

export async function portalSaveContactConfiguration(
  contacts: readonly PortalContactDraft[],
  scope: PortalScope = clientPortalScope,
): Promise<PortalContactConfiguration> {
  const data = await callPortalRpc<PortalContactConfiguration>(
    scope,
    'portal_save_contact_configuration',
    {
      p_contacts: contacts.map(({ id, name, email, phone, isPrimary, active, boxCodes }) => ({
        id,
        name: name ? name.trim() : null,
        email: email ? email.trim() : null,
        phone: phone ? phone.trim() : null,
        is_primary: isPrimary,
        active,
        box_codes: boxCodes,
      })),
    },
  )
  return data ?? { boxes: [], contacts: [] }
}
