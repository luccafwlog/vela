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
  notes: string
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
  notes: '',
  contacts: [newCustomerContact(true)],
}
