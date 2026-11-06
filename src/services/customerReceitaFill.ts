import { canonicalizeValidCnpj } from '../lib/cnpj'
import type { Customer } from '../types/database'
import type { CnpjLookupData } from './cnpjLookup'
import { supabase } from './supabase'

// Completar pela Receita (pedido do dono de 2026-11-06): Clientes cadastrados
// antes da consulta de CNPJ (ADR 0127) ficaram sem nome fantasia ou endereço.
// A tela consulta a Receita pela mesma Edge Function do Novo cliente e grava
// só o campo vazio, pela RPC auditada da ficha (`update_customer_with_audit`).
// Razão social e CNPJ nunca mudam por aqui.

export const RECEITA_FILL_FIELDS = ['trade_name', 'address', 'city', 'state', 'zip'] as const
export type ReceitaFillField = (typeof RECEITA_FILL_FIELDS)[number]
export type ReceitaFill = Partial<Record<ReceitaFillField, string>>

export const RECEITA_FILL_LABELS: Record<ReceitaFillField, string> = {
  trade_name: 'Nome fantasia',
  address: 'Endereço',
  city: 'Cidade',
  state: 'UF',
  zip: 'CEP',
}

/** Justificativa gravada no Histórico do Cliente, campo a campo. */
export const RECEITA_FILL_JUSTIFICATION = 'Completar pela Receita: dado público da Receita Federal (BrasilAPI) num campo vazio.'

export type ReceitaFillCustomer = Pick<Customer, 'id' | 'cnpj_cpf' | 'name' | ReceitaFillField>

function isBlank(value: string | null | undefined) {
  return !(value ?? '').trim()
}

/** Campos do endereço que o Cliente ainda não tem. */
export function missingReceitaFields(customer: Pick<Customer, ReceitaFillField>): ReceitaFillField[] {
  return RECEITA_FILL_FIELDS.filter((field) => isBlank(customer[field]))
}

/**
 * O que a Receita completa: só os campos vazios do Cliente, com o formato do
 * Novo cliente (UF de 2 letras, CEP de 8 dígitos; fora disso, fica de fora).
 */
export function planReceitaFill(customer: Pick<Customer, ReceitaFillField>, data: CnpjLookupData): ReceitaFill {
  const state = data.uf.trim().toUpperCase()
  const zip = data.cep.replace(/\D/g, '')
  const values: Record<ReceitaFillField, string> = {
    trade_name: data.nome_fantasia.trim(),
    address: data.endereco.trim(),
    city: data.cidade.trim(),
    state: /^[A-Z]{2}$/.test(state) ? state : '',
    zip: /^\d{8}$/.test(zip) ? zip : '',
  }
  const fill: ReceitaFill = {}
  for (const field of missingReceitaFields(customer)) {
    if (values[field]) fill[field] = values[field]
  }
  return fill
}

const PAGE_SIZE = 1000

/**
 * Clientes ativos, com CNPJ válido de 14 caracteres (o CPF não está na
 * Receita de empresas), a que falta algum campo do endereço.
 */
export async function listCustomersMissingReceitaData(): Promise<ReceitaFillCustomer[]> {
  const rows: ReceitaFillCustomer[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('customers')
      .select('id, cnpj_cpf, name, trade_name, address, city, state, zip')
      .is('deactivated_at', null)
      .order('name')
      .order('id')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const page = (data ?? []) as ReceitaFillCustomer[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return rows.filter((customer) => canonicalizeValidCnpj(customer.cnpj_cpf) && missingReceitaFields(customer).length > 0)
}

/**
 * Grava o que a Receita completa. Relê o Cliente antes: campo preenchido por
 * alguém depois da consulta fica como está. Devolve os campos gravados.
 */
export async function applyReceitaFill(customerId: number, fill: ReceitaFill, changedBy: string): Promise<ReceitaFillField[]> {
  const { data: current, error: readError } = await supabase
    .from('customers')
    .select('trade_name, address, city, state, zip')
    .eq('id', customerId)
    .single()
  if (readError) throw readError
  const updates: ReceitaFill = {}
  for (const field of RECEITA_FILL_FIELDS) {
    const value = fill[field]
    if (value && isBlank((current as Pick<Customer, ReceitaFillField>)[field])) updates[field] = value
  }
  const fields = Object.keys(updates) as ReceitaFillField[]
  if (!fields.length) return []
  const { error } = await supabase.rpc('update_customer_with_audit', {
    p_customer_id: customerId,
    p_updates: updates,
    p_changed_by: changedBy,
    p_justification: RECEITA_FILL_JUSTIFICATION,
  })
  if (error) throw error
  return fields
}
