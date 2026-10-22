import { supabase } from './supabase'

/** Linha que a tela grava no Histórico (`audit_logs`). */
export type AuditEntry = {
  entity_type: string
  entity_id: string
  field_name: string
  old_value: string | null
  new_value: string | null
  justification?: string | null
}

/**
 * Única porta de escrita da tela em `audit_logs` (migration `402`, F-46): o
 * INSERT direto foi fechado e a RPC `record_audit_entries` aceita só os
 * assuntos que a tela grava (agenda de POL/POD, Viagem, evento operacional),
 * com o autor tirado da sessão — `changed_by` enviado é ignorado.
 */
export async function recordAuditEntries(entries: ReadonlyArray<AuditEntry & { changed_by?: string | null }>): Promise<void> {
  if (!entries.length) return
  const payload = entries.map(({ entity_type, entity_id, field_name, old_value, new_value, justification }) => ({
    entity_type, entity_id, field_name, old_value, new_value, justification: justification ?? null,
  }))
  const { error } = await supabase.rpc('record_audit_entries' as never, { p_entries: payload } as never)
  if (error) throw error
}
