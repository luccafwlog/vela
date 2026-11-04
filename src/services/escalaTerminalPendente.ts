import { mapChunks } from '../lib/utils'
import { normalizePortCode } from './portCode'
import { supabase } from './supabase'

/**
 * Frentes de operação sem terminal por escala, pela mesma derivação do banco
 * que trava o Fechar ADR e abre o alerta "Escala sem terminal"
 * (`escala_frentes_sem_terminal`, migration 584): as frentes gravadas em TBC e
 * as que nascem dos dados (B/L, transbordo, vazios de importação, Granito e
 * Embarque de vazios) e ainda não têm terminal. Chave: `${voyageId}::${porto}`,
 * com o porto normalizado.
 */
export type EscalasSemTerminal = Map<string, string[]>

export function escalaSemTerminalKey(voyageId: number, port: string | null | undefined): string {
  return `${voyageId}::${normalizePortCode(port) ?? String(port ?? '').trim().toUpperCase()}`
}

export async function fetchEscalasSemTerminal(voyageIds: readonly number[]): Promise<EscalasSemTerminal> {
  const result: EscalasSemTerminal = new Map()
  const ids = [...new Set(voyageIds)].filter((id) => Number.isInteger(id))
  if (!ids.length) return result
  const rows = await mapChunks(ids, 50, async (chunk) => {
    const { data, error } = await supabase.rpc('escala_frentes_sem_terminal' as never, { p_voyage_ids: chunk } as never)
    if (error) throw error
    return (data ?? []) as Array<{ voyage_id: number | string; port: string | null; fronts: string[] | null }>
  })
  for (const row of rows) {
    const fronts = (row.fronts ?? []).filter((front) => typeof front === 'string' && front.length > 0)
    if (!fronts.length) continue
    result.set(escalaSemTerminalKey(Number(row.voyage_id), row.port), [...fronts].sort())
  }
  return result
}

/** Frentes pendentes de um sentido (`importacao:*` ou `exportacao:*`). */
export function pendingFrontsForDirection(fronts: readonly string[] | undefined, direction: 'importacao' | 'exportacao'): string[] {
  return (fronts ?? []).filter((front) => front.startsWith(`${direction}:`))
}

// Mesmos nomes da recusa do Fechar ADR (`assert_voyage_escala_ready_for_report_close`).
const FRONT_LABELS: Record<string, string> = {
  'importacao:carga_cheia': 'carga cheia',
  'importacao:carga_solta': 'carga solta',
  'importacao:vazio': 'vazios de importação',
  'importacao:veiculo': 'veículos',
  'exportacao:granito': 'granito',
  'exportacao:vazio': 'embarque de vazios',
}

export function operationFrontPendingLabel(key: string): string {
  return FRONT_LABELS[key] ?? key
}

/** "Sem terminal: carga solta, vazios de importação." — título do TBC em âmbar. */
export function pendingFrontsTitle(fronts: readonly string[]): string {
  return `Sem terminal: ${fronts.map(operationFrontPendingLabel).join(', ')}. Atribua o terminal em Editar escala.`
}
