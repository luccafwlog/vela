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

/** Campos do cadastro que a consulta de CNPJ preenche (ADR 0127). */
export type CnpjFillField = 'name' | 'tradeName' | 'zip' | 'address' | 'city' | 'state'
/** Valor que a consulta pôs em cada campo, para saber se o operador mexeu depois. */
export type CnpjAutofill = Partial<Record<CnpjFillField, string>>

export type CnpjFillSource = {
  razao_social: string
  nome_fantasia: string
  cep: string
  endereco: string
  cidade: string
  uf: string
}

/**
 * Preenche com os dados da Receita só o campo vazio ou que ainda guarda o
 * valor de uma consulta anterior: o que o operador digitou nunca é trocado.
 * Sem dados (CNPJ não achado ou consulta indisponível), limpa o que a consulta
 * anterior pôs e ninguém mexeu, para o cadastro não herdar o endereço de outro
 * CNPJ.
 */
export function applyCnpjLookup(
  form: CreateCustomerForm,
  source: CnpjFillSource | null,
  previous: CnpjAutofill,
): { form: CreateCustomerForm; filled: CnpjAutofill } {
  const values: Record<CnpjFillField, string> = {
    name: source?.razao_social ?? '',
    tradeName: source?.nome_fantasia ?? '',
    zip: source?.cep ?? '',
    address: source?.endereco ?? '',
    city: source?.cidade ?? '',
    state: source?.uf ?? '',
  }
  const next = { ...form }
  const filled: CnpjAutofill = {}
  for (const field of Object.keys(values) as CnpjFillField[]) {
    const current = form[field]
    const untouched = !current.trim() || (previous[field] !== undefined && current === previous[field])
    if (!untouched) continue
    next[field] = values[field]
    if (values[field]) filled[field] = values[field]
  }
  return { form: next, filled }
}
