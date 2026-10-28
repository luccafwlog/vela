import { CUSTOMER_COMMUNICATION_BOXES, type CommunicationBoxCode } from '../services/customerCommunicationBoxes'
import type { PortalContactDraft } from '../services/portalContactConfiguration'

const normalizedEmail = (email: string | null | undefined) => (email ?? '').trim().toLowerCase()

/**
 * A supressão vale só para o e-mail em que foi lida: com o e-mail trocado no
 * rascunho, o contato volta a ser elegível (D14 de 2026-10-27).
 */
function suppressionStillApplies(contact: PortalContactDraft): boolean {
  if (contact.suppressedEmail == null) return true
  return normalizedEmail(contact.suppressedEmail) === normalizedEmail(contact.email)
}

/** Motivo da supressão que ainda vale para o e-mail do rascunho; nulo depois da troca. */
export function currentSuppressionReason(contact: PortalContactDraft): string | null {
  return contact.suppressionReason && suppressionStillApplies(contact) ? contact.suppressionReason : null
}

export function isEligibleContact(contact: PortalContactDraft): boolean {
  if (!contact.active || !contact.email?.trim().includes('@')) return false
  if (!suppressionStillApplies(contact)) return true
  return contact.sendable !== false && !contact.suppressionReason
}

/** Caixa sem nenhum contato ativo com e-mail: a gravação é recusada. */
export function firstBoxWithoutContact(contacts: readonly PortalContactDraft[]) {
  return CUSTOMER_COMMUNICATION_BOXES.find((box) => !contacts.some((contact) =>
    contact.active && contact.email?.trim().includes('@') && contact.boxCodes.includes(box.code)))
}

/**
 * Caixas com contato, mas só e-mail devolvido ou bloqueado: a gravação passa
 * com aviso, e o alerta registra a caixa sem destinatário (D14 de 2026-10-27,
 * a mesma regra do banco em `_apply_customer_contact_configuration`).
 */
export function boxesWithoutRecipient(contacts: readonly PortalContactDraft[]) {
  return CUSTOMER_COMMUNICATION_BOXES.filter((box) => !contacts.some((contact) =>
    isEligibleContact(contact) && contact.boxCodes.includes(box.code)))
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
