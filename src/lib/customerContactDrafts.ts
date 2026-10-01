import { CUSTOMER_COMMUNICATION_BOXES, type CommunicationBoxCode } from '../services/customerCommunicationBoxes'
import type { PortalContactDraft } from '../services/portalContactConfiguration'

export function isEligibleContact(contact: PortalContactDraft): boolean {
  return contact.active && Boolean(contact.email?.trim().includes('@')) &&
    contact.sendable !== false && !contact.suppressionReason
}

export function hasEligibleContactReplacement(
  contacts: readonly PortalContactDraft[],
  index: number,
  boxCode: CommunicationBoxCode,
): boolean {
  return contacts.some((contact, otherIndex) =>
    otherIndex !== index && isEligibleContact(contact) && contact.boxCodes.includes(boxCode),
  )
}

export function normalizePrimaryContactBoxes(contacts: readonly PortalContactDraft[]): PortalContactDraft[] {
  return contacts.map((contact, index) => {
    if (!contact.isPrimary || !contact.active) return contact
    // Preserva delegações salvas e repõe somente caixas sem substituto.
    const requiredBoxes = CUSTOMER_COMMUNICATION_BOXES.filter((box) =>
      contact.boxCodes.length === 0 || !hasEligibleContactReplacement(contacts, index, box.code),
    ).map((box) => box.code)
    return { ...contact, boxCodes: Array.from(new Set([...contact.boxCodes, ...requiredBoxes])) }
  })
}
