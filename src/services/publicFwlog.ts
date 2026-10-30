import { projectPortalScheduleRows, type PortalScheduleRpcRow, type PortalScheduleVoyage } from './portalScheduleVoyages'

// Chamadas do quadro "Chegadas e saídas" e da Consulta de container públicos
// (ADR 0114). Vão direto às Edge Functions, sem sessão e sem a chave do
// Supabase: a Edge confere origem, Turnstile e limite, e lê o banco com
// `service_role`. A resposta já vem pela lista positiva da Edge.

export type PublicFailure = 'challenge' | 'limit' | 'unavailable'

export class PublicRequestError extends Error {
  readonly reason: PublicFailure
  constructor(reason: PublicFailure) {
    super(reason)
    this.reason = reason
  }
}

/** Site Key do widget público do Turnstile; vazia, as páginas públicas ficam indisponíveis. */
export function publicTurnstileSiteKey(): string {
  return String(import.meta.env.VITE_TURNSTILE_PUBLIC_SITE_KEY ?? '').trim()
}

function functionUrl(name: string): string {
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
  if (!base) throw new PublicRequestError('unavailable')
  return `${base}/functions/v1/${name}`
}

async function refusalCode(response: Response): Promise<string | null> {
  try {
    const data = await response.json() as { error?: unknown } | null
    return typeof data?.error === 'string' ? data.error : null
  } catch {
    return null
  }
}

async function post(name: string, body: Record<string, string>): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(functionUrl(name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
    })
  } catch {
    throw new PublicRequestError('unavailable')
  }
  if (response.status === 403) throw new PublicRequestError('challenge')
  // 429 é o limite de quem consulta ou, com `indisponivel`, o disjuntor global
  // da busca, que vale para todos até a hora virar.
  if (response.status === 429) throw new PublicRequestError(await refusalCode(response) === 'indisponivel' ? 'unavailable' : 'limit')
  if (!response.ok) throw new PublicRequestError('unavailable')
  try {
    return await response.json()
  } catch {
    throw new PublicRequestError('unavailable')
  }
}

type PublicScheduleCall = { port_code: string; kind: 'pol' | 'pod'; date: string | null; actual: string | null; omitted: boolean }
type PublicScheduleVoyage = { vessel_name: string; voyage: string; imo: string | null; calls: PublicScheduleCall[] }

export type PublicSchedule = { vessels: PortalScheduleVoyage[]; updatedAt: number }

/**
 * Quadro público na mesma projeção do Portal (`projectPortalScheduleRows`):
 * a Viagem não tem id fora do Vela, então a posição na resposta faz o papel.
 */
export async function fetchPublicSchedule(turnstileToken: string): Promise<PublicSchedule> {
  const data = await post('public-ship-schedule', { turnstile_token: turnstileToken }) as { voyages?: PublicScheduleVoyage[]; updated_at?: string }
  const rows: PortalScheduleRpcRow[] = (data.voyages ?? []).flatMap((voyage, index) => voyage.calls.map((call) => ({
    voyage_id: index + 1,
    vessel_name: voyage.vessel_name,
    voyage: voyage.voyage,
    imo_number: voyage.imo,
    port_code: call.port_code,
    kind: call.kind,
    date_value: call.date,
    actual_value: call.actual,
    omitted: call.omitted,
  })))
  const updatedAt = Date.parse(data.updated_at ?? '')
  return { vessels: projectPortalScheduleRows(rows), updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now() }
}

export type PublicContainerSituation = 'aguardando_descarga' | 'no_prazo' | 'prazo_vencido' | 'prazo_a_confirmar' | 'devolvido'

export type PublicContainer = {
  number: string
  type: string | null
  vessel_name: string | null
  voyage: string | null
  discharge_port: string | null
  discharge_date: string | null
  return_date: string | null
  free_time_days: number | null
  free_time_until: string | null
  situation: PublicContainerSituation
}

export type PublicLookupResult = { found: false } | { found: true; container: PublicContainer; consultedAt: number }

export async function lookupPublicContainer(containerNumber: string, turnstileToken: string): Promise<PublicLookupResult> {
  const data = await post('public-container-lookup', { container_number: containerNumber, turnstile_token: turnstileToken }) as
    { found?: boolean; container?: PublicContainer; consulted_at?: string }
  if (data.found !== true || !data.container) return { found: false }
  const consultedAt = Date.parse(data.consulted_at ?? '')
  return { found: true, container: data.container, consultedAt: Number.isFinite(consultedAt) ? consultedAt : Date.now() }
}
