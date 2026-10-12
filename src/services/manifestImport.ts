import { supabase } from './supabase'
import { canonicalManifestoNumero } from './manifestosMercanteService'

/**
 * Define o CE Master (Sistema Mercante) de um manifesto. Editado inline na
 * página Viagens; operador ativo pode atualizar (RLS de import_batches).
 */
export async function setImportBatchCeMaster(batchId: number, ceMaster: string | null, changedBy: string) {
  // Mesma forma canônica do cadastro de Manifestos (migration 181); vazio limpa.
  const normalized = canonicalManifestoNumero(ceMaster ?? '')
  const { error } = await supabase.rpc('set_import_batch_ce_master', {
    p_batch_id: batchId,
    p_ce_master: normalized,
    p_changed_by: changedBy,
  })
  if (error) throw error
}
