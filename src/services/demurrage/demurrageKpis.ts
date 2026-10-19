import { importDateOrNull } from '../../lib/importDate'
import { parseImportNumber } from '../../lib/importNumber'
import { supabase } from '../supabase'
import { assertUploadFile } from '../../lib/fileGuard'
import type { PixTransaction } from '../../types/database'
import { readSheet } from '../importCore'
import { invoiceNetUsd } from './demurragePresentation'

// A cotação (PTAX/ROE) mora em ./demurrageRoe: o cabeçalho de todas as telas
// a consulta, e este módulo traz o leitor de planilha junto. Reexportada aqui
// para os chamadores de sempre.
export { DEMURRAGE_ROE_MARKUP, fetchROE, type FetchROEResult } from './demurrageRoe'

export type CustomerDemurrageSummary = {
  customer_id: number
  customer_name: string
  cnpj_cpf: string | null
  invoice_count: number
  /** USD a cobrar: itens menos o desconto (o BRL já é líquido). */
  total_usd: number
  total_brl: number
}

export type CustomerDemurrageDetailItem = {
  id: number
  doc_number: string
  bl_id: string
  billed_at: string | null
  /** USD a cobrar, líquido do desconto, como na aba Faturas. */
  total_usd: number
  current_total_brl: number | null
  current_roe: number | null
}

/**
 * Agrega as faturas de Demurrage emitidas e não pagas por consignatário (cliente):
 * USD a cobrar (líquido do desconto, como em Faturas) + BRL (snapshot do último
 * recálculo, que o banco já calcula sem o desconto). Usado pela aba "Por Cliente".
 */
export async function fetchCustomerDemurrageSummary(): Promise<CustomerDemurrageSummary[]> {
  const { data, error } = await supabase
    .from('demurrage_invoices')
    .select('customer_id, total_usd, discount_mode, discount_value, current_total_brl, customer:customers(id,name,cnpj_cpf)')
    .eq('status', 'issued')
    .is('paid_at', null)
  if (error) throw error

  const byCustomer = new Map<number, CustomerDemurrageSummary>()
  for (const row of (data ?? []) as unknown as Array<{
    customer_id: number
    total_usd: number | null
    discount_mode: string | null
    discount_value: number | null
    current_total_brl: number | null
    customer: { id: number; name: string; cnpj_cpf: string | null } | null
  }>) {
    const id = row.customer_id
    const existing = byCustomer.get(id) ?? {
      customer_id: id,
      customer_name: row.customer?.name ?? '—',
      cnpj_cpf: row.customer?.cnpj_cpf ?? null,
      invoice_count: 0,
      total_usd: 0,
      total_brl: 0,
    }
    existing.invoice_count += 1
    existing.total_usd += invoiceNetUsd(row).netUsd
    existing.total_brl += row.current_total_brl ?? 0
    byCustomer.set(id, existing)
  }
  return Array.from(byCustomer.values()).sort((a, b) => b.total_usd - a.total_usd)
}

/** Faturas emitidas e não pagas de um consignatário, para o accordion/relatório. */
export async function fetchCustomerDemurrageDetail(customerId: number): Promise<CustomerDemurrageDetailItem[]> {
  const { data, error } = await supabase
    .from('demurrage_invoices')
    .select('id, doc_number, bl_id, billed_at, total_usd, discount_mode, discount_value, current_total_brl, current_roe')
    .eq('status', 'issued')
    .is('paid_at', null)
    .eq('customer_id', customerId)
    .order('billed_at', { ascending: false })
  if (error) throw error
  type Row = CustomerDemurrageDetailItem & { discount_mode: string | null; discount_value: number | null }
  return ((data ?? []) as unknown as Row[]).map(({ discount_mode, discount_value, ...row }) => ({
    ...row,
    total_usd: invoiceNetUsd({ total_usd: row.total_usd, discount_mode, discount_value }).netUsd,
  }))
}

export type DemurrageKPIs = {
  overdueContainers: number
  draftInvoicesTotalUsd: number
  issuedInvoicesTotalBrl: number
}

/**
 * Data (event_date) do último recálculo registrado em demurrage_invoice_history,
 * ou null se não houver histórico. Usada pelo banner de staleness em /demurrage.
 */
export async function fetchLatestRecalcDate(): Promise<string | null> {
  const { data, error } = await supabase
    .from('demurrage_invoice_history')
    .select('event_date')
    .order('event_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.event_date ?? null
}

/**
 * Recálculo manual disparado pelo operador quando o BCB está fora ou o job falhou.
 * Informa a PTAX (cotação de venda, sem markup); o markup é aplicado no banco,
 * que também grava a referência cambial (`recalculate_demurrage_invoices`).
 */
export async function recalculateInvoicesManual(ptax: number): Promise<{ updated: number }> {
  const { data, error } = await supabase.rpc('recalculate_demurrage_invoices_manual', { p_ptax: ptax })
  if (error) throw error
  const updated = Number((data as { updated?: number } | null)?.updated ?? 0)
  return { updated }
}

export async function fetchDemurrageKPIs(): Promise<DemurrageKPIs> {
  const [contRes, draftRes, issuedRes] = await Promise.all([
    supabase.from('bl_containers').select('id', { count: 'exact', head: true }).eq('demurrage_status', 'overdue'),
    supabase.from('demurrage_invoices').select('total_usd').eq('status', 'draft'),
    supabase.from('demurrage_invoices').select('current_total_brl').eq('status', 'issued'),
  ])
  for (const res of [contRes, draftRes, issuedRes]) {
    if (res.error) throw res.error
  }
  return {
    overdueContainers: contRes.count ?? 0,
    draftInvoicesTotalUsd: (draftRes.data ?? []).reduce((s, r) => s + (r.total_usd ?? 0), 0),
    issuedInvoicesTotalBrl: (issuedRes.data ?? []).reduce((s, r) => s + (r.current_total_brl ?? 0), 0),
  }
}

/**
 * Leitura do extrato "QR Codes recebidos" (regra de 2026-10-19, D3):
 * lançamento zerado ou negativo (tarifas e saídas) ou sem valor é ignorado e
 * contado em `ignored`; valor ilegível é erro (`errors`) e recusa o extrato
 * inteiro antes de qualquer gravação.
 */
export type PixExtractRead = {
  transactions: PixTransaction[]
  /** Linhas ignoradas por valor zerado, negativo ou vazio. */
  ignored: number
  errors: Array<{ row: number; message: string }>
}

export async function readPixExtract(arrayBuffer: ArrayBuffer): Promise<PixExtractRead> {
  // `rowNumbers`: linha física de cada linha da matriz. Com linhas ocultas
  // fora da matriz, o índice não é mais a linha da planilha.
  const { matrix, rowNumbers } = await readSheet(arrayBuffer)
  const rows = matrix

  let headerRowIdx = -1
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some((cell) => String(cell).toLowerCase().trim() === 'identificador')) {
      headerRowIdx = i
      break
    }
  }
  if (headerRowIdx === -1) throw new Error('Formato não reconhecido. Coluna "identificador" não encontrada.')

  const headers = rows[headerRowIdx].map((h) => String(h).toLowerCase().trim())
  const colId = headers.indexOf('identificador')
  const colCnpj = headers.findIndex((h) => h.includes('cpf') || h.includes('cnpj'))
  const colDate = headers.findIndex((h) => h.includes('pago em'))
  const colValue = headers.findIndex((h) => h.includes('valor pago'))

  if (colId === -1) throw new Error('Coluna "identificador" não encontrada.')
  if (colValue === -1) throw new Error('Coluna "valor pago" não encontrada.')
  // Duas colunas para o mesmo campo bloqueiam (ADR 0078, item 22): ler a
  // primeira em silêncio poderia baixar o valor da coluna errada.
  const repeated = [
    ['identificador', headers.filter((h) => h === 'identificador').length],
    ['CPF/CNPJ', headers.filter((h) => h.includes('cpf') || h.includes('cnpj')).length],
    ['pago em', headers.filter((h) => h.includes('pago em')).length],
    ['valor pago', headers.filter((h) => h.includes('valor pago')).length],
  ].filter(([, count]) => Number(count) > 1).map(([label]) => `"${label}"`)
  if (repeated.length) {
    throw new Error(`A coluna ${repeated.join(', ')} aparece mais de uma vez no cabeçalho do extrato. Deixe só uma e importe de novo.`)
  }

  const transactions: PixTransaction[] = []
  const errors: PixExtractRead['errors'] = []
  let ignored = 0
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    const txid = String(row[colId] ?? '').trim()
    const lineNumber = rowNumbers[i] ?? i + 1

    let date = ''
    if (colDate >= 0) {
      date = parsePixPaidDate(row[colDate])
    }

    // Célula numérica chega como número; texto do extrato é pt-BR (1.500,50),
    // às vezes com o símbolo da moeda ("R$ 1.500,50"), que continua legível.
    const rawValue = row[colValue]
    const parsed = parseImportNumber(typeof rawValue === 'string' ? rawValue.trim().replace(/^(-?)\s*R\$\s*/i, '$1') : rawValue, 'pt-BR')
    if (parsed.kind === 'invalid') {
      errors.push({ row: lineNumber, message: `Valor pago "${String(rawValue).trim()}" ilegível${txid ? ` (identificador ${txid})` : ''}.` })
      continue
    }
    const amount = parsed.kind === 'value' ? Number(parsed.decimal) : 0
    if (amount <= 0) {
      // Linha totalmente vazia não é lançamento; não entra na contagem.
      if (txid || parsed.kind === 'value') ignored += 1
      continue
    }

    const cnpj = colCnpj >= 0 ? String(row[colCnpj] ?? '').trim() : ''
    transactions.push({ txid, cnpj, date, amount, lineNumber })
  }
  return { transactions, ignored, errors }
}

/** Só as transações; valor ilegível recusa o extrato (lança). */
export async function parsePixExtract(arrayBuffer: ArrayBuffer): Promise<PixTransaction[]> {
  const read = await readPixExtract(arrayBuffer)
  if (read.errors.length) throw new Error(read.errors.map((error) => `Linha ${error.row}: ${error.message}`).join(' '))
  return read.transactions
}

// Data civil única dos imports (src/lib/importDate.ts): a célula de data/hora
// do Excel chega como AAAA-MM-DD HH:MM; o texto do extrato, DD/MM/AAAA HH:MM.
function parsePixPaidDate(raw: unknown): string {
  return importDateOrNull(raw) ?? ''
}

export async function parsePixExtractFile(file: File): Promise<PixExtractRead> {
  assertUploadFile(file, ['xlsx', 'xls'])
  return readPixExtract(await file.arrayBuffer())
}
