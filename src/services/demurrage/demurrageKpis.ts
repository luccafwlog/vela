import { supabase } from '../supabase'
import { assertUploadFile } from '../../lib/fileGuard'
import { reportBestEffortFailure } from '../../lib/telemetry'
import type { PixTransaction, RoeSource } from '../../types/database'
import { readSheet } from '../importCore'

// Spread fixo do armador aplicado sobre a PTAX (ADR 0014). Ponto canônico no
// frontend; o backend replica a mesma constante na RPC de recálculo.
export const DEMURRAGE_ROE_MARKUP = 1.065

export type CustomerDemurrageSummary = {
  customer_id: number
  customer_name: string
  cnpj_cpf: string | null
  invoice_count: number
  total_usd: number
  total_brl: number
}

export type CustomerDemurrageDetailItem = {
  id: number
  doc_number: string
  bl_id: string
  billed_at: string | null
  total_usd: number
  current_total_brl: number | null
  current_roe: number | null
}

/**
 * Agrega as faturas de Demurrage emitidas e não pagas por consignatário (cliente):
 * USD estável + BRL (snapshot do último recálculo). Usado pela aba "Por Cliente".
 */
export async function fetchCustomerDemurrageSummary(): Promise<CustomerDemurrageSummary[]> {
  const { data, error } = await supabase
    .from('demurrage_invoices')
    .select('customer_id, total_usd, current_total_brl, customer:customers(id,name,cnpj_cpf)')
    .eq('status', 'issued')
    .is('paid_at', null)
  if (error) throw error

  const byCustomer = new Map<number, CustomerDemurrageSummary>()
  for (const row of (data ?? []) as unknown as Array<{
    customer_id: number
    total_usd: number | null
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
    existing.total_usd += row.total_usd ?? 0
    existing.total_brl += row.current_total_brl ?? 0
    byCustomer.set(id, existing)
  }
  return Array.from(byCustomer.values()).sort((a, b) => b.total_usd - a.total_usd)
}

/** Faturas emitidas e não pagas de um consignatário, para o accordion/relatório. */
export async function fetchCustomerDemurrageDetail(customerId: number): Promise<CustomerDemurrageDetailItem[]> {
  const { data, error } = await supabase
    .from('demurrage_invoices')
    .select('id, doc_number, bl_id, billed_at, total_usd, current_total_brl, current_roe')
    .eq('status', 'issued')
    .is('paid_at', null)
    .eq('customer_id', customerId)
    .order('billed_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as CustomerDemurrageDetailItem[]
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
    effectiveDate: new Date().toISOString().slice(0, 10),
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
  const { matrix } = await readSheet(arrayBuffer, { dates: 'date' })
  const rows = matrix as (string | Date | number | null)[][]

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
      amount = parseFloat(String(row[colValue] ?? '').trim().replace(/\./g, '').replace(',', '.')) || 0
    }
    if (amount <= 0) continue

    const cnpj = colCnpj >= 0 ? String(row[colCnpj] ?? '').trim() : ''
    transactions.push({ txid, cnpj, date, amount, lineNumber: i + 1 })
  }
  return transactions
}

function parsePixPaidDate(raw: unknown): string {
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return ''
    const y = raw.getUTCFullYear()
    const m = raw.getUTCMonth() + 1
    const d = raw.getUTCDate()
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }

  const str = String(raw ?? '').trim()
  if (!str) return ''

  const num = Number(str)
  if (Number.isFinite(num) && num > 40000 && num < 200000) {
    const epoch = new Date(Date.UTC(1899, 11, 30))
    const date = new Date(epoch.getTime() + num * 86_400_000)
    if (isNaN(date.getTime())) return ''
    const y = date.getUTCFullYear()
    const m = date.getUTCMonth() + 1
    const d = date.getUTCDate()
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }

  const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+.*)?$/)
  if (!match) return ''

  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  const candidate = new Date(Date.UTC(year, month - 1, day))

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return ''
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export async function parsePixExtractFile(file: File): Promise<PixTransaction[]> {
  assertUploadFile(file, ['xlsx', 'xls'])
  return parsePixExtract(await file.arrayBuffer())
}

const ROE_CACHE_KEY = 'demurrage_roe_cache'

type RoeCache = { roe: number; ptax: number; effectiveDate: string; fetchedAt: string }

function isRoeCache(v: unknown): v is RoeCache {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).roe === 'number' &&
    typeof (v as Record<string, unknown>).ptax === 'number' &&
    typeof (v as Record<string, unknown>).effectiveDate === 'string' &&
    typeof (v as Record<string, unknown>).fetchedAt === 'string'
  )
}

function loadCachedROE(): RoeCache | null {
  try {
    const raw = localStorage.getItem(ROE_CACHE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isRoeCache(parsed) ? parsed : null
  } catch {
    return null
  }
}

function saveROECache(roe: number, ptax: number, effectiveDate: string) {
  try {
    const payload: RoeCache = { roe, ptax, effectiveDate, fetchedAt: new Date().toISOString() }
    localStorage.setItem(ROE_CACHE_KEY, JSON.stringify(payload))
  } catch {
    // localStorage unavailable — ignore
  }
}

export async function persistExchangeRateReference(
  input: { ptax: number | null; roe: number; effectiveDate: string; source: RoeSource },
  options: { required?: boolean } = {},
) {
  try {
    const { error } = await supabase.rpc('save_exchange_rate_reference_v2', {
      p_ptax: input.ptax,
      p_roe: input.roe,
      p_effective_date: input.effectiveDate,
      p_source: input.source,
      p_quote_date: input.effectiveDate,
    })
    if (error) throw error
  } catch (error) {
    reportBestEffortFailure('exchange rate reference persistence failed', error)
    if (options.required) throw error
  }
}

async function loadDbExchangeRateReference(): Promise<RoeCache | null> {
  try {
    if (typeof supabase?.from !== 'function') return null
    const { data, error } = await supabase
      .from('exchange_rate_reference')
      .select('ptax, roe, effective_date, updated_at')
      .eq('id', 1)
      .maybeSingle()
    if (error || !data) return null
    const roeNum = Number(data.roe)
    const ptaxNum = Number(data.ptax)
    if (Number.isFinite(roeNum) && Number.isFinite(ptaxNum) && data.effective_date) {
      return {
        roe: roeNum,
        ptax: ptaxNum,
        effectiveDate: String(data.effective_date),
        fetchedAt: String(data.updated_at ?? new Date().toISOString()),
      }
    }
    return null
  } catch {
    return null
  }
}

export type FetchROEResult = {
  roe: number
  ptax: number
  effectiveDate: string
  offline: boolean
  cachedAt: string | null
  source: RoeSource
}

export async function fetchROE(options: { ensurePersistence?: boolean } = {}): Promise<FetchROEResult> {
  const today = new Date()
  const from = new Date(today)
  from.setDate(from.getDate() - 10)
  const fmt = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`
  const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial=%27${fmt(from)}%27&@dataFinalCotacao=%27${fmt(today)}%27&$top=1&$orderby=dataHoraCotacao%20desc&$format=json&$select=cotacaoVenda,dataHoraCotacao`

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!resp.ok) throw new Error(`BCB HTTP ${resp.status}`)
    const json = await resp.json()
    if (!json.value?.length || !json.value[0].cotacaoVenda) throw new Error('Sem cotações no BCB')
    const ptax = parseFloat(parseFloat(json.value[0].cotacaoVenda).toFixed(4))
    const roe = parseFloat((ptax * DEMURRAGE_ROE_MARKUP).toFixed(4))
    const effectiveDate = String(json.value[0].dataHoraCotacao).slice(0, 10)
    saveROECache(roe, ptax, effectiveDate)
    // The header is a read-only, best-effort indicator. Do not make every
    // authenticated page wait for the audit persistence RPC to finish.
    const persist = persistExchangeRateReference({ ptax, roe, effectiveDate, source: 'bcb_live' }, { required: options.ensurePersistence })
    if (!options.ensurePersistence) void persist
    else await persist
    return { roe, ptax, effectiveDate, offline: false, cachedAt: null, source: 'bcb_live' }
  } catch (error) {
    // 1. Tenta recuperar a última cotação registrada no banco pelo backend (recalc-demurrage-ptax)
    const dbRef = await loadDbExchangeRateReference()
    if (dbRef) {
      saveROECache(dbRef.roe, dbRef.ptax, dbRef.effectiveDate)
      return {
        roe: dbRef.roe,
        ptax: dbRef.ptax,
        effectiveDate: dbRef.effectiveDate,
        offline: true,
        cachedAt: dbRef.fetchedAt,
        source: 'cached',
      }
    }

    // 2. Se o banco não respondeu ou não tem cotação, tenta o cache local do navegador
    const cached = loadCachedROE()
    if (cached) {
      const persist = persistExchangeRateReference(
        { ptax: cached.ptax, roe: cached.roe, effectiveDate: cached.effectiveDate, source: 'cached' },
        { required: options.ensurePersistence },
      )
      if (!options.ensurePersistence) void persist
      else await persist
      return { roe: cached.roe, ptax: cached.ptax, effectiveDate: cached.effectiveDate, offline: true, cachedAt: cached.fetchedAt, source: 'cached' }
    }

    // 3. Falha total (sem BCB, sem banco e sem cache local) -> reporta e interrompe
    reportBestEffortFailure('fetchROE: BCB PTAX indisponivel e sem cache', error, {
      fellBackToCache: false,
    })
    throw new Error('BCB offline e sem cache de PTAX disponivel. Informe a taxa manualmente.', { cause: error })
  }
}
