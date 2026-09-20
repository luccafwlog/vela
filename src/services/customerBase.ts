import { asString, onlyDigits } from '../lib/utils'
import { canonicalizeValidCnpj } from '../lib/cnpj'
import { assertUploadFile } from '../lib/fileGuard'
import { supabase } from './supabase'
import { matchHeaders, readSheet, type HeaderSpec } from './importCore'

const headerMap = {
  cnpj_cpf: ['cnpj', 'cnpj/cpf'],
  name: ['razao social'],
  trade_name: ['nome fantasia', 'trade name', 'fantasia'],
  email: ['email', 'e-mail', 'mail'],
  address: ['endereco', 'address'],
  city: ['cidade', 'city'],
  state: ['uf', 'estado', 'state'],
  zip: ['cep', 'zip', 'zip code', 'zipcode'],
} as const

const requiredHeaders = {
  cnpj_cpf: 'CNPJ',
  name: 'Razao Social',
} as const

type DestinationField = keyof typeof headerMap
const SPEC: HeaderSpec<DestinationField> = {
  aliases: headerMap,
  required: ['cnpj_cpf', 'name'],
}

export type CustomerBaseRow = {
  cnpj_cpf: string
  name: string
  trade_name: string | null
  emails: string[]
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  existingCustomerId?: number
  changedFields?: string[]
}

export type ParsedCustomerBase = {
  rows: CustomerBaseRow[]
  rowErrors: { row: number; message: string; raw: unknown }[]
}

export async function parseCustomerBaseFile(file: File): Promise<ParsedCustomerBase> {
  assertUploadFile(file, ['xlsx', 'xls', 'csv'])
  const buffer = await file.arrayBuffer()
  const { headers, rows } = await readSheet(buffer)
  validateRequiredHeaders(headers)
  return parseCustomerBaseRows(rows)
}

export async function compareCustomerBaseWithExisting(parsed: ParsedCustomerBase): Promise<ParsedCustomerBase> {
  const existing: Array<Record<string, unknown>> = []
  for (let from = 0; from < parsed.rows.length; from += 500) {
    const documents = parsed.rows.slice(from, from + 500).map((row) => row.cnpj_cpf)
    const { data, error } = await supabase
      .from('customers')
      .select('id, cnpj_cpf, name, trade_name, address, city, state, zip')
      .in('cnpj_cpf', documents)
    if (error) throw error
    existing.push(...(data ?? []))
  }
  const byDocument = new Map(existing.map((row) => [String(row.cnpj_cpf), row]))
  const labels: Record<string, string> = { name: 'Razão Social', trade_name: 'Nome Fantasia', address: 'Endereço', city: 'Cidade', state: 'UF', zip: 'CEP' }
  return {
    ...parsed,
    rows: parsed.rows.map((row) => {
      const current = byDocument.get(row.cnpj_cpf)
      if (!current) return row
      const changedFields = Object.keys(labels).filter((field) => String(current[field] ?? '').trim() !== String(row[field as keyof CustomerBaseRow] ?? '').trim()).map((field) => labels[field])
      return { ...row, existingCustomerId: Number(current.id), changedFields }
    }),
  }
}

export async function importCustomerBaseRows(rows: CustomerBaseRow[], options: { changedBy: string | null } = { changedBy: null }) {
  const uniqueRows = Array.from(new Map(rows.map((row) => [row.cnpj_cpf, row])).values())
  if (!uniqueRows.length) {
    return { imported: 0, updated: 0, contactsCreated: 0, blsLinked: 0 }
  }
  if (!options.changedBy) throw new Error('Usuário ativo obrigatório para importar a base de clientes.')

  let imported = 0
  let updated = 0
  let contactsCreated = 0
  let blsLinked = 0
  const errors: Array<{ cnpj_cpf: string; message: string }> = []

  // Cada linha e uma unidade: falha de unicidade/contato em um cliente nao
  // desfaz os clientes anteriores nem deixa upsert parcial no navegador.
  for (const row of uniqueRows) {
    const { data, error } = await supabase.rpc('apply_customer_base_row_atomic', {
      p_cnpj: row.cnpj_cpf,
      p_name: row.name,
      p_trade_name: row.trade_name,
      p_address: row.address,
      p_city: row.city,
      p_state: row.state,
      p_zip: row.zip,
      p_emails: row.emails,
      p_changed_by: options.changedBy,
    })
    if (error) {
      errors.push({ cnpj_cpf: row.cnpj_cpf, message: error.message || 'Falha ao importar cliente.' })
      continue
    }
    const result = data as { created?: boolean; contacts_created?: number; bls_linked?: number } | null
    if (result?.created) imported += 1
    else updated += 1
    contactsCreated += Number(result?.contacts_created ?? 0)
    blsLinked += Number(result?.bls_linked ?? 0)
  }

  return { imported, updated, contactsCreated, blsLinked, errors }
}

function validateRequiredHeaders(rawHeaders: string[]) {
  const { missing: missingFields } = matchHeaders(rawHeaders, SPEC)
  const missing = missingFields.map((field) => requiredHeaders[field as keyof typeof requiredHeaders])

  if (missing.length) {
    throw new Error(`Base invalida. Colunas obrigatorias: ${missing.join(', ')}.`)
  }
}

export function parseCustomerBaseRows(rows: Record<string, unknown>[]): ParsedCustomerBase {
  const parsedRows: CustomerBaseRow[] = []
  const rowErrors: ParsedCustomerBase['rowErrors'] = []

  rows.forEach((row, index) => {
    const rowNumber = typeof row.rowNumber === 'number' ? row.rowNumber : index + 2
    const mapped = mapRow(row)
    const cnpjCpf = normalizeDocument(asString(mapped.cnpj_cpf))
    const name = asString(mapped.name)

    if (!cnpjCpf) {
      rowErrors.push({ row: rowNumber, message: 'Linha sem CNPJ válido.', raw: row })
      return
    }

    if (!name) {
      rowErrors.push({ row: rowNumber, message: 'Linha sem Razao Social.', raw: row })
      return
    }

    const emails = extractEmails(asString(mapped.email))
    if (!emails.length) {
      rowErrors.push({ row: rowNumber, message: 'Linha sem e-mail válido.', raw: row })
      return
    }

    parsedRows.push({
      cnpj_cpf: cnpjCpf,
      name,
      trade_name: asNullableText(mapped.trade_name),
      emails,
      address: asNullableText(mapped.address),
      city: asNullableText(mapped.city),
      state: normalizeState(asNullableText(mapped.state)),
      zip: normalizeZip(asNullableText(mapped.zip)),
    })
  })

  const dedupedRows = Array.from(new Set(parsedRows.map((row) => row.cnpj_cpf))).map((document) =>
    mergeBestRow(parsedRows.filter((candidate) => candidate.cnpj_cpf === document)),
  )

  return { rows: dedupedRows, rowErrors }
}

function mapRow(row: Record<string, unknown>) {
  const mapped: Partial<Record<DestinationField, unknown>> = {}
  const { columnByField } = matchHeaders(Object.keys(row), SPEC)
  for (const [field, column] of Object.entries(columnByField) as [DestinationField, string][]) mapped[field] = row[column]
  return mapped
}

function normalizeDocument(value: string) {
  return canonicalizeValidCnpj(value) ?? ''
}

function extractEmails(value: string) {
  const matches = asString(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
  return Array.from(new Set(matches.map((email) => normalizeEmail(email)).filter((email): email is string => Boolean(email))))
}

function normalizeEmail(value?: string | null) {
  const text = asString(value).trim().toLowerCase()
  return text || ''
}

function chooseText(primary?: string | null, fallback?: string | null) {
  const left = asNullableText(primary)
  const right = asNullableText(fallback)
  if (!left) return right ?? null
  if (!right) return left
  return left.length >= right.length ? left : right
}

function chooseState(primary?: string | null, fallback?: string | null) {
  return normalizeState(primary) || normalizeState(fallback)
}

function normalizeState(value?: string | null) {
  const text = asNullableText(value)?.toUpperCase() ?? ''
  if (!text) return null
  return text.slice(0, 2)
}

function normalizeZip(value?: string | null) {
  const digits = onlyDigits(value)
  return digits ? digits : null
}

function asNullableText(value: unknown) {
  const text = asString(value)
  return text || null
}

function mergeBestRow(rows: CustomerBaseRow[]) {
  return rows.reduce<CustomerBaseRow>(
    (best, current) => ({
      cnpj_cpf: current.cnpj_cpf,
      name: chooseBestName(best.name, current.name),
      trade_name: chooseText(current.trade_name, best.trade_name),
      emails: mergeEmails(current.emails, best.emails),
      address: chooseText(current.address, best.address),
      city: chooseText(current.city, best.city),
      state: chooseState(current.state, best.state),
      zip: chooseText(current.zip, best.zip),
    }),
    rows[0],
  )
}

function mergeEmails(current: string[], candidate: string[]) {
  return Array.from(new Set([...candidate, ...current].map((email) => normalizeEmail(email)).filter(Boolean)))
}

function chooseBestName(current: string, candidate: string) {
  const currentText = asString(current)
  const candidateText = asString(candidate)
  if (!currentText) return candidateText
  if (!candidateText) return currentText
  return candidateText.length >= currentText.length ? candidateText : currentText
}
