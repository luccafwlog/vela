import { asString, onlyDigits } from '../lib/utils'
import { canonicalizeValidCnpj } from '../lib/cnpj'
import { assertUploadFile } from '../lib/fileGuard'
import { classifyDbError } from '../lib/errors'
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
  name: 'Razão Social',
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
  /** Primeira linha da planilha com este CNPJ; a prévia aponta os avisos por ela. */
  row_number?: number
  existingCustomerId?: number
  changedFields?: string[]
  /** razão social gravada, quando a planilha traz outra (pede confirmação) */
  currentName?: string | null
  /** B/Ls pendentes de Cliente que este CNPJ vincula (ADR 0078, item 24) */
  pendingBlIds?: string[]
  /** B/Ls rejeitados na Revisão com este CNPJ: nunca vinculados pela Base */
  rejectedBlIds?: string[]
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
  const pending = new Map<string, string[]>()
  const rejected = new Map<string, string[]>()
  for (let from = 0; from < parsed.rows.length; from += 200) {
    const documents = parsed.rows.slice(from, from + 200).map((row) => row.cnpj_cpf)
    // Mesmo filtro do vínculo (migration 192): B/L de Viagem cancelada é
    // somente leitura e a Base não o vincula.
    const { data, error } = await supabase
      .from('bls')
      .select('id, manifest_customer_cnpj_cpf, customer_reconciliation_status, voyage:voyages!inner(status)')
      .in('manifest_customer_cnpj_cpf', documents)
      .is('customer_id', null)
      .is('cancelled_at', null)
      .neq('voyage.status', 'cancelled')
    if (error) throw error
    for (const bl of (data ?? []) as Array<{ id: string; manifest_customer_cnpj_cpf: string; customer_reconciliation_status: string | null }>) {
      const target = bl.customer_reconciliation_status === 'rejected' ? rejected : pending
      target.set(bl.manifest_customer_cnpj_cpf, [...(target.get(bl.manifest_customer_cnpj_cpf) ?? []), bl.id])
    }
  }
  const labels: Record<string, string> = { name: 'Razão Social', trade_name: 'Nome Fantasia', address: 'Endereço', city: 'Cidade', state: 'UF', zip: 'CEP' }
  return {
    ...parsed,
    rows: parsed.rows.map((row) => {
      const current = byDocument.get(row.cnpj_cpf)
      const links = { pendingBlIds: pending.get(row.cnpj_cpf) ?? [], rejectedBlIds: rejected.get(row.cnpj_cpf) ?? [] }
      if (!current) return { ...row, ...links }
      const changedFields = Object.keys(labels).filter((field) => String(current[field] ?? '').trim() !== String(row[field as keyof CustomerBaseRow] ?? '').trim()).map((field) => labels[field])
      const currentName = String(current.name ?? '').trim()
      return {
        ...row,
        ...links,
        existingCustomerId: Number(current.id),
        changedFields,
        currentName: sameName(currentName, row.name) ? null : currentName,
      }
    }),
  }
}

/** Razão social comparada sem caixa, espaços extras e pontuação. */
export function sameName(left: string | null | undefined, right: string | null | undefined) {
  const key = (value: string | null | undefined) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9À-Ú]+/g, ' ').trim()
  return key(left) === key(right)
}

/** Clientes cuja razão social muda: a importação pede confirmação antes. */
export function customerNameChanges(rows: CustomerBaseRow[]) {
  return rows.filter((row) => row.existingCustomerId && row.currentName)
}

export type CustomerBaseImportResult = {
  /** `false`: o banco recusou algum Cliente e NADA foi gravado (migration 334). */
  ok: boolean
  imported: number
  updated: number
  contactsCreated: number
  blsLinked: number
  errors: Array<{ cnpj_cpf: string; message: string }>
}

/**
 * Grava a base inteira numa chamada (`apply_customer_base_batch_atomic`,
 * migration 334): se o banco recusa qualquer Cliente, nenhum é gravado e a
 * resposta lista o que foi recusado. O aceite da troca de razão social vale
 * para o nome de antes que a prévia mostrou: o banco confere esse nome com o
 * Cliente travado e recusa se ele mudou depois da prévia.
 */
export async function importCustomerBaseRows(
  rows: CustomerBaseRow[],
  options: { changedBy: string | null; confirmNameChange?: boolean } = { changedBy: null },
): Promise<CustomerBaseImportResult> {
  const uniqueRows = Array.from(new Map(rows.map((row) => [row.cnpj_cpf, row])).values())
  if (!uniqueRows.length) {
    return { ok: true, imported: 0, updated: 0, contactsCreated: 0, blsLinked: 0, errors: [] }
  }
  if (!options.changedBy) throw new Error('Usuário ativo obrigatório para importar a base de clientes.')

  const { data, error } = await supabase.rpc('apply_customer_base_batch_atomic' as never, {
    p_rows: uniqueRows.map((row) => {
      const confirmsNameChange = Boolean(options.confirmNameChange && row.existingCustomerId && row.currentName)
      return {
        cnpj: row.cnpj_cpf,
        name: row.name,
        trade_name: row.trade_name,
        address: row.address,
        city: row.city,
        state: row.state,
        zip: row.zip,
        emails: row.emails,
        confirm_name_change: confirmsNameChange,
        expected_current_name: confirmsNameChange ? row.currentName!.trim() : null,
      }
    }),
    p_changed_by: options.changedBy,
  } as never)
  if (error) throw error

  const result = (data ?? {}) as {
    ok?: boolean
    imported?: number
    updated?: number
    contacts_created?: number
    bls_linked?: number
    errors?: Array<{ cnpj?: string; code?: string; message?: string }>
  }
  if (result.ok === false) {
    return {
      ok: false,
      imported: 0,
      updated: 0,
      contactsCreated: 0,
      blsLinked: 0,
      errors: (result.errors ?? []).map((item) => ({
        cnpj_cpf: String(item.cnpj ?? ''),
        message: classifyDbError({ code: item.code, message: item.message ?? '' }).message || 'Falha ao importar cliente.',
      })),
    }
  }
  return {
    ok: true,
    imported: Number(result.imported ?? 0),
    updated: Number(result.updated ?? 0),
    contactsCreated: Number(result.contacts_created ?? 0),
    blsLinked: Number(result.bls_linked ?? 0),
    errors: [],
  }
}

function validateRequiredHeaders(rawHeaders: string[]) {
  const { missing: missingFields } = matchHeaders(rawHeaders, SPEC)
  const missing = missingFields.map((field) => requiredHeaders[field as keyof typeof requiredHeaders])

  if (missing.length) {
    throw new Error(`Base inválida. Colunas obrigatórias: ${missing.join(', ')}.`)
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
      // CNPJ em célula numérica sem máscara perde os zeros à esquerda.
      const numericCause = typeof mapped.cnpj_cpf === 'number' && String(mapped.cnpj_cpf).length < 14
        ? ' A célula é numérica e perdeu os zeros à esquerda: formate a coluna CNPJ como texto.'
        : ''
      rowErrors.push({ row: rowNumber, message: `Linha sem CNPJ válido.${numericCause}`, raw: row })
      return
    }

    if (typeof mapped.zip === 'number' && String(mapped.zip).length < 8) {
      rowErrors.push({ row: rowNumber, message: 'CEP em célula numérica perdeu os zeros à esquerda: formate a coluna CEP como texto.', raw: row })
      return
    }

    if (!name) {
      rowErrors.push({ row: rowNumber, message: 'Linha sem Razão Social.', raw: row })
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
      row_number: rowNumber,
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
      row_number: rows[0].row_number,
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
