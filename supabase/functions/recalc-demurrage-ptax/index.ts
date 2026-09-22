// Edge Function: recalc-demurrage-ptax
//
// Recalcula diariamente o valor em BRL de todas as faturas de Demurrage emitidas e
// não pagas, usando a PTAX mais recente do BCB (ver ADR 0014). Deve ser agendada em
// dias úteis, após ~14h (BRT), quando a PTAX de fechamento já foi divulgada.
//
// Política de busca da PTAX (igual ao sistema antigo demurrage-manager):
//   CotacaoDolarPeriodo dos últimos ~10 dias, $top=1 & $orderby=dataHoraCotacao desc,
//   selecionando cotacaoVenda + dataHoraCotacao. Nunca pede "a de hoje" — pega a
//   cotação mais recente disponível. Fim de semana / feriado / "ainda não divulgada"
//   NÃO causam falha (retornam a última cotação). "Indisponível" só em erro HTTP/rede
//   ou período vazio → aborta e loga (o caminho manual em /demurrage cobre esse caso).
//
// A PTAX bruta (cotacaoVenda) é passada à RPC; o markup 1,065 é aplicado no banco.
//
// Configuração no Supabase:
//   Schedule (cron) → dias úteis ~14h BRT (ex.: "0 17 * * 1-5" em UTC)
//   Endpoint: https://<project>.supabase.co/functions/v1/recalc-demurrage-ptax
//   Header: Authorization: Bearer <RECALC_CRON_SECRET>
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RECALC_CRON_SECRET

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { instrumentEdgeHandler } from '../_shared/telemetry.ts'

// Comparação em tempo constante para evitar timing attacks no bearer secret.
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ba = enc.encode(a)
  const bb = enc.encode(b)
  if (ba.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i]
  return diff === 0
}

function fmtBcbDate(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`
}

type BcbQuote = { cotacaoVenda: number; dataHoraCotacao: string }

const PTAX_FAILURE_TYPE = 'demurrage_ptax_recalc_failed'
const PTAX_FAILURE_ENTITY_TYPE = 'exchange_rate_reference'
const PTAX_FAILURE_ENTITY_ID = 'global'
const PTAX_FAILURE_SOURCE = 'recalc-demurrage-ptax'

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

async function waitBeforeRetry(attempt: number): Promise<void> {
  const baseMs = Math.min(2_000, 250 * 2 ** attempt)
  const jitterMs = Math.floor(Math.random() * 100)
  await new Promise((resolve) => setTimeout(resolve, baseMs + jitterMs))
}

async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
  let lastError: unknown = new Error('request failed')
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(12_000) })
      if (response.ok || !isRetryableStatus(response.status) || attempt === attempts - 1) return response
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
      if (attempt === attempts - 1) throw error
    }
    await waitBeforeRetry(attempt)
  }
  throw lastError
}

async function fetchLatestPtax(): Promise<BcbQuote> {
  const today = new Date()
  const from = new Date(today)
  from.setDate(from.getDate() - 10)
  const url =
    `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/` +
    `CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)` +
    `?@dataInicial=%27${fmtBcbDate(from)}%27&@dataFinalCotacao=%27${fmtBcbDate(today)}%27` +
    `&$top=1&$orderby=dataHoraCotacao%20desc&$format=json&$select=cotacaoVenda,dataHoraCotacao`

  const resp = await fetchWithRetry(url)
  if (!resp.ok) throw new Error(`BCB HTTP ${resp.status}`)
  const json = await resp.json()
  const row = json?.value?.[0]
  if (!row || !row.cotacaoVenda) throw new Error('Periodo vazio no BCB (API com problema).')
  const cotacaoVenda = Number(row.cotacaoVenda)
  const dataHoraCotacao = String(row.dataHoraCotacao ?? '')
  if (!Number.isFinite(cotacaoVenda) || cotacaoVenda <= 0 || cotacaoVenda > 1000) {
    throw new Error('PTAX invalida retornada pelo BCB.')
  }
  const quoteDate = dataHoraCotacao.slice(0, 10)
  const parsedQuoteDate = new Date(`${quoteDate}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(quoteDate) || Number.isNaN(parsedQuoteDate.getTime())) {
    throw new Error('Data de cotacao invalida retornada pelo BCB.')
  }
  return { cotacaoVenda: Number(cotacaoVenda.toFixed(4)), dataHoraCotacao }
}

function errorDetail(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return Array.from(detail, (character) => {
    const code = character.charCodeAt(0)
    return code < 0x20 || code === 0x7f ? ' ' : character
  }).join('').slice(0, 500)
}

async function recordPtaxFailure(
  supabase: ReturnType<typeof createClient>,
  errorCode: string,
  error: unknown,
): Promise<void> {
  try {
    const { error: alertError } = await supabase.rpc('upsert_alert_item', {
      p_type: PTAX_FAILURE_TYPE,
      p_entity_type: PTAX_FAILURE_ENTITY_TYPE,
      p_entity_id: PTAX_FAILURE_ENTITY_ID,
      p_message: 'A atualização automática da PTAX da Demurrage falhou; o último valor válido foi preservado.',
      p_source: PTAX_FAILURE_SOURCE,
      p_metadata: {
        error_code: errorCode,
        detail: errorDetail(error),
        observed_at: new Date().toISOString(),
      },
      p_destination: '/demurrage',
    })
    if (alertError) console.error('recalc-demurrage-ptax: alerta de falha não persistido', alertError)
  } catch (alertError) {
    console.error('recalc-demurrage-ptax: canal de alerta indisponível', alertError)
  }
}

async function resolvePtaxFailure(
  supabase: ReturnType<typeof createClient>,
  quoteDate: string,
): Promise<void> {
  const { error } = await supabase.rpc('resolve_alert_item', {
    p_type: PTAX_FAILURE_TYPE,
    p_entity_type: PTAX_FAILURE_ENTITY_TYPE,
    p_entity_id: PTAX_FAILURE_ENTITY_ID,
    p_source: PTAX_FAILURE_SOURCE,
    p_metadata: { recovered_at: new Date().toISOString(), quote_date: quoteDate },
  })
  if (error) throw error
}

Deno.serve(instrumentEdgeHandler('recalc-demurrage-ptax', async (req: Request) => {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const cronSecret = Deno.env.get('RECALC_CRON_SECRET') ?? ''
  const auth = req.headers.get('authorization') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!cronSecret || !timingSafeEqual(bearer, cronSecret)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  if (!serviceRoleKey || !supabaseUrl) {
    return new Response(JSON.stringify({ error: 'internal_configuration_error' }), { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  let quote: BcbQuote
  try {
    quote = await fetchLatestPtax()
  } catch (error) {
    console.error('recalc-demurrage-ptax: PTAX indisponivel', error)
    await recordPtaxFailure(supabase, 'ptax_unavailable', error)
    return new Response(JSON.stringify({ error: 'ptax_unavailable' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    })
  }

  const quoteDate = quote.dataHoraCotacao.slice(0, 10) // dataHoraCotacao = "YYYY-MM-DD HH:mm:ss.SSS"
  const roe = Number((quote.cotacaoVenda * 1.065).toFixed(4))

  const { error: referenceError } = await supabase.rpc('save_exchange_rate_reference_v2', {
    p_ptax: quote.cotacaoVenda,
    p_roe: roe,
    p_effective_date: quoteDate,
    p_source: 'bcb_live',
    p_quote_date: quoteDate,
  })
  if (referenceError) {
    console.error('recalc-demurrage-ptax: referencia cambial falhou', referenceError)
    await recordPtaxFailure(supabase, 'reference_failed', referenceError)
    return new Response(JSON.stringify({ error: 'reference_failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  const { data, error } = await supabase.rpc('recalculate_demurrage_invoices', {
    p_ptax: quote.cotacaoVenda,
    p_quote_date: quoteDate,
    p_source: 'bcb_live',
  })
  if (error) {
    console.error('recalc-demurrage-ptax: RPC falhou', error)
    await recordPtaxFailure(supabase, 'recalc_failed', error)
    return new Response(JSON.stringify({ error: 'recalc_failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    await resolvePtaxFailure(supabase, quoteDate)
  } catch (error) {
    console.error('recalc-demurrage-ptax: alerta de falha não resolvido', error)
    await recordPtaxFailure(supabase, 'alert_resolution_failed', error)
    return new Response(JSON.stringify({ error: 'alert_resolution_failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true, ptax: quote.cotacaoVenda, roe, quote_date: quoteDate, result: data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}))
