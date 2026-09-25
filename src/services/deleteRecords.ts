import { supabase } from './supabase'
import type { DeleteDependencyReport } from './deleteDependencies'

export type DeleteRecordKind = 'bl' | 'container' | 'vehicle' | 'customer' | 'voyage'

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

export type CatalogDeleteTable =
  | 'granite_rates'
  | 'depots'
  | 'depot_services'
  | 'vazios_export_service_lines'
  | 'demurrage_rates'
  | 'customer_demurrage_agreements'
  | 'customer_rate_overrides'
  | 'charge_table_items'

/**
 * Exclui uma linha de cadastro (taxas, locais, servicos, linhas de vazios)
 * pela RPC `delete_catalog_row` (migration 096), que exige o motivo e o grava
 * na auditoria. O banco recusa DELETE direto nessas tabelas. Devolve o erro em
 * vez de lancar, para o chamador poder traduzir codigos como 23503.
 */
export async function deleteOneById(
  table: CatalogDeleteTable,
  id: string | number,
  reason: string,
): Promise<{ error: Error | null }> {
  const { error } = await supabase.rpc('delete_catalog_row' as never, {
    p_table: table,
    p_id: String(id),
    p_reason: reason,
  } as never)
  if (!error) return { error: null }
  if ((error as { code?: string }).code === 'P0002') return { error: new Error(NOTHING_DELETED_MESSAGE) }
  return { error }
}
