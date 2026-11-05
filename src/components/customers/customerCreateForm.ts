import {
  CUSTOMER_COMMUNICATION_BOXES,
  type CommunicationBoxCode,
} from '../../services/customerCommunicationBoxes'
import type { CustomerContact } from '../../types/database'

export type CustomerCreateErrors = Partial<{
  cnpjCpf: string
  name: string
  /** Regra dos contatos (nome, principal com e-mail), mostrada no bloco de contatos. */
  contacts: string
  /** Falha ao gravar, mostrada junto dos botões. */
  submit: string
}>

export type CustomerContactForm = {
  _id: string
  name: string
  email: string
  phone: string
  purpose?: NonNullable<CustomerContact['purpose']>
  is_primary: boolean
  box_codes: CommunicationBoxCode[]
}

export type CreateCustomerForm = {
  cnpjCpf: string
  name: string
  tradeName: string
  address: string
  city: string
  state: string
  zip: string
  /**
   * Envia o convite do Portal ao contato principal logo depois do cadastro.
   * Notas ficam na ficha do Cliente, não no cadastro (pedido do dono de 2026-11-05).
   */
  sendPortalInvite: boolean
  contacts: CustomerContactForm[]
}

export function newCustomerContact(isPrimary = false): CustomerContactForm {
  return {
    _id: crypto.randomUUID(),
    name: '',
    email: '',
    phone: '',
    purpose: 'geral',
    is_primary: isPrimary,
    box_codes: isPrimary
      ? CUSTOMER_COMMUNICATION_BOXES.map((b) => b.code)
      : ['documentacao_operacao'],
  }
}

export const emptyCreateCustomerForm: CreateCustomerForm = {
  cnpjCpf: '',
  name: '',
  tradeName: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  sendPortalInvite: false,
  contacts: [newCustomerContact(true)],
}
