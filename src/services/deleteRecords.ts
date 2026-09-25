import { supabase } from './supabase'
import type { DeleteDependencyReport } from './deleteDependencies'

export type DeleteRecordKind = 'bl' | 'container' | 'vehicle' | 'customer'

type DeleteRecordsResponse = {
  deleted: string[]
  blocked: Array<{ id: string; reasons: string[] }>
}

/**
 * Exclui B/Ls, containers, veiculos ou clientes pela RPC `delete_records`
 * (migration 087). Cada item e excluido por inteiro no banco -- filhos e
 * principal -- ou volta intacto com o motivo. Com `dryRun`, nada e apagado e o
 * relatorio e a previa exata da execucao. Somente o Administrativo executa; o
 * banco recusa os demais com erro, em vez de apagar 0 linhas em silencio.
 */
export async function deleteRecords<K extends string | number>(
  kind: DeleteRecordKind,
  ids: K[],
  options: { dryRun?: boolean; reason?: string } = {},
): Promise<DeleteDependencyReport<K>> {
  if (ids.length === 0) return { deletableIds: [], blockedIds: [] }

  const { data, error } = await supabase.rpc('delete_records' as never, {
    p_kind: kind,
    p_ids: ids.map(String),
    p_dry_run: options.dryRun ?? false,
    p_reason: options.reason ?? null,
  } as never)
  if (error) throw error

  const response = data as unknown as DeleteRecordsResponse
  const byKey = new Map(ids.map((id) => [String(id), id]))
  const toKey = (id: string) => byKey.get(id) ?? (id as K)
  return {
    deletableIds: response.deleted.map(toKey),
    blockedIds: response.blocked.map((item) => ({ id: toKey(item.id), reasons: item.reasons })),
  }
}

export const NOTHING_DELETED_MESSAGE =
  'Nada foi excluído: você não tem permissão para excluir este registro, ou ele já não existe.'

/**
 * Exclui uma linha por id e confere que ela saiu. O PostgREST responde a um
 * DELETE barrado por RLS com 0 linhas e sem erro; sem esta conferencia a tela
 * anunciava "excluido" para algo que continuava no banco (achado A1).
 * Devolve o erro em vez de lancar, para o chamador poder traduzir codigos
 * como 23503.
 */
export async function deleteOneById(table: string, id: string | number): Promise<{ error: Error | null }> {
  const { data, error } = await supabase
    .from(table as never)
    .delete()
    .eq('id' as never, id as never)
    .select('id')
  if (error) return { error }
  if (!data || (data as unknown[]).length === 0) return { error: new Error(NOTHING_DELETED_MESSAGE) }
  return { error: null }
}
