import { supabase } from './supabase'
import { fetchUserDisplayNames } from './userNames'

export type BlTimelineFamily = 'edicao' | 'container' | 'veiculo' | 'taxas' | 'fatura' | 'sistema'

export type BlTimelineEvent = {
  id: number
  family: BlTimelineFamily
  entity_type: string
  field_name: string
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  changed_at: string | null
  justification: string | null
}

export const BL_TIMELINE_PAGE_SIZE = 50

function parseTimelineFamily(value: string): BlTimelineFamily {
  if (value === 'edicao' || value === 'container' || value === 'veiculo' || value === 'taxas' || value === 'fatura' || value === 'sistema') return value
  throw new Error(`Família inválida na timeline do B/L: ${value}`)
}

export async function fetchBlTimeline(blId: string, offset: number): Promise<BlTimelineEvent[]> {
  const { data, error } = await supabase.rpc('bl_timeline', {
    p_bl_id: blId,
    p_limit: BL_TIMELINE_PAGE_SIZE,
    p_offset: offset,
  })
  if (error) throw error
  return (data ?? []).map((row) => ({ ...row, family: parseTimelineFamily(row.family) }))
}

// ponytail: o Histórico do B/L lê tudo de uma vez, em páginas de 50, até
// 1.000 eventos, para filtrar por assunto e paginar de 20 em 20 na tela (como o
// Histórico do Cliente). Um B/L tem dezenas de eventos; se algum passar do
// teto, a paginação volta para o servidor com contagem e filtro na RPC.
export const BL_TIMELINE_MAX_EVENTS = 1000

export async function fetchFullBlTimeline(blId: string): Promise<BlTimelineEvent[]> {
  const events: BlTimelineEvent[] = []
  for (let offset = 0; offset < BL_TIMELINE_MAX_EVENTS; offset += BL_TIMELINE_PAGE_SIZE) {
    const page = await fetchBlTimeline(blId, offset)
    events.push(...page)
    if (page.length < BL_TIMELINE_PAGE_SIZE) break
  }
  return events
}

/** Nome de quem fez cada evento, pelo id gravado no histórico. */
export async function fetchActorNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  return fetchUserDisplayNames(ids)
}
