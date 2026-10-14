import { importDateOrNull } from '../../lib/importDate'
import { parseImportNumber } from '../../lib/importNumber'
import { supabase } from '../supabase'
import { assertUploadFile } from '../../lib/fileGuard'
import type { PixTransaction } from '../../types/database'
import { readSheet } from '../importCore'
import { invoiceNetUsd } from './demurragePresentation'
import { saoPauloTodayIso } from '../../lib/dates'

import { DEMURRAGE_ROE_MARKUP, persistExchangeRateReference } from './demurrageRoe'

// A cotação (PTAX/ROE) mora em ./demurrageRoe: o cabeçalho de todas as telas
// a consulta, e este módulo traz o leitor de planilha junto. Reexportada aqui
// para os chamadores de sempre.
export { DEMURRAGE_ROE_MARKUP, fetchROE, persistExchangeRateReference, type FetchROEResult } from './demurrageRoe'

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
 * Informa a PTAX (cotação de venda, sem markup); o markup é aplicado no banco.
 */
export async function recalculateInvoicesManual(ptax: number): Promise<{ updated: number }> {
  const { data, error } = await supabase.rpc('recalculate_demurrage_invoices_manual', { p_ptax: ptax })
  if (error) throw error
  await persistExchangeRateReference({
    ptax,
    roe: parseFloat((ptax * DEMURRAGE_ROE_MARKUP).toFixed(4)),
    effectiveDate: saoPauloTodayIso(),
    source: 'manual',
  })
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

export async function parsePixExtract(arrayBuffer: ArrayBuffer): Promise<PixTransaction[]> {
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
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    const txid = String(row[colId] ?? '').trim()

    let date = ''
    if (colDate >= 0) {
      date = parsePixPaidDate(row[colDate])
    }

    let amount = 0
    if (colValue >= 0) {
      // Célula numérica chega como número; texto do extrato é pt-BR (1.500,50).
      const parsed = parseImportNumber(row[colValue], 'pt-BR')
      amount = parsed.kind === 'value' ? Number(parsed.decimal) : 0
    }
    if (amount <= 0) continue

    const cnpj = colCnpj >= 0 ? String(row[colCnpj] ?? '').trim() : ''
    transactions.push({ txid, cnpj, date, amount, lineNumber: rowNumbers[i] ?? i + 1 })
  }
  return transactions
}

// Data civil única dos imports (src/lib/importDate.ts): a célula de data/hora
// do Excel chega como AAAA-MM-DD HH:MM; o texto do extrato, DD/MM/AAAA HH:MM.
function parsePixPaidDate(raw: unknown): string {
  return importDateOrNull(raw) ?? ''
}

export async function parsePixExtractFile(file: File): Promise<PixTransaction[]> {
  assertUploadFile(file, ['xlsx', 'xls'])
  return parsePixExtract(await file.arrayBuffer())
}
