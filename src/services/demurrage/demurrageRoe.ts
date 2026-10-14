// Cotação do dólar para Demurrage (PTAX do BCB × spread do armador = ROE).
// Separada de demurrageKpis para o cabeçalho, que aparece em toda tela, não
// carregar o leitor de planilha e o resto dos indicadores.
import { supabase } from '../supabase'
import { reportBestEffortFailure } from '../../lib/telemetry'
import type { RoeSource } from '../../types/database'

// Spread fixo do armador aplicado sobre a PTAX (ADR 0014). Ponto canônico no
// frontend; o backend replica a mesma constante na RPC de recálculo.
export const DEMURRAGE_ROE_MARKUP = 1.065

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

function saveROECache(roe: number, ptax: number, effectiveDate: string, fetchedAt = new Date().toISOString()) {
  try {
    const payload: RoeCache = { roe, ptax, effectiveDate, fetchedAt }
    localStorage.setItem(ROE_CACHE_KEY, JSON.stringify(payload))
  } catch {
    // localStorage unavailable — ignore
  }
}

async function loadDbExchangeRateReference(): Promise<RoeCache | null> {
  try {
    if (typeof supabase?.from !== 'function') return null
    const { data, error } = await supabase
      .from('exchange_rate_reference')
      .select('ptax, roe, effective_date, updated_at, source')
      .eq('id', 1)
      .maybeSingle()
    if (error || !data || !['bcb_live', 'cached'].includes(data.source) || data.ptax == null) return null
    const roeNum = Number(data.roe)
    const ptaxNum = Number(data.ptax)
    if (
      Number.isFinite(roeNum) && roeNum > 0 && roeNum <= 1000 &&
      Number.isFinite(ptaxNum) && ptaxNum > 0 && ptaxNum <= 1000 &&
      // numeric do Postgres e float do JS podem arredondar empates diferentemente.
      Math.abs(roeNum - ptaxNum * DEMURRAGE_ROE_MARKUP) <= 0.00005 + Number.EPSILON * 1000 &&
      data.effective_date
    ) {
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

// O cabeçalho só lê: a referência cambial usada na emissão é gravada pelo job
// do BCB e pelo Informar PTAX, no servidor (ADR 0083, item 14; migration 236).
export async function fetchROE(): Promise<FetchROEResult> {
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
    return { roe, ptax, effectiveDate, offline: false, cachedAt: null, source: 'bcb_live' }
  } catch (error) {
    // 1. Tenta recuperar a última cotação registrada no banco pelo backend (recalc-demurrage-ptax)
    const dbRef = await loadDbExchangeRateReference()
    if (dbRef) {
      saveROECache(dbRef.roe, dbRef.ptax, dbRef.effectiveDate, dbRef.fetchedAt)
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
      return { roe: cached.roe, ptax: cached.ptax, effectiveDate: cached.effectiveDate, offline: true, cachedAt: cached.fetchedAt, source: 'cached' }
    }

    // 3. Falha total (sem BCB, sem banco e sem cache local) -> reporta e interrompe
    reportBestEffortFailure('fetchROE: BCB PTAX indisponivel e sem cache', error, {
      fellBackToCache: false,
    })
    throw new Error('BCB offline e sem cache de PTAX disponivel. Informe a taxa manualmente.', { cause: error })
  }
}
