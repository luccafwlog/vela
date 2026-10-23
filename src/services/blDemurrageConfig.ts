import { supabase } from './supabase'

export async function saveBlDemurrageConfig({
  blId,
  expectedUpdatedAt,
  freeTime,
  p1,
  p2,
  changedBy,
}: {
  blId: string
  expectedUpdatedAt: string | null
  freeTime: number | null
  p1: number | null
  p2: number | null
  changedBy: string
}) {
  const { error } = await supabase.rpc('save_bl_demurrage_config', {
    p_bl_id: blId,
    p_expected_updated_at: expectedUpdatedAt,
    p_free_time_override: freeTime,
    p_rate_p1_usd: p1,
    p_rate_p2_usd: p2,
    p_changed_by: changedBy,
  })
  if (error) throw error
}

/**
 * ROE manual do B/L (migration 435): Financeiro, Administrativo e Equipamentos
 * põem (`roe`) ou tiram (`null`), com motivo de 10 caracteres ou mais. Vale
 * para a próxima Invoice de Demurrage emitida; o histórico do B/L leva o motivo.
 */
export async function setBlManualRoe({ blId, roe, reason }: { blId: string; roe: number | null; reason: string }) {
  const text = reason.trim()
  if (text.length < 10) throw new Error('Informe o motivo do ROE manual (mínimo de 10 caracteres).')
  const { error } = await supabase.rpc('set_bl_manual_roe' as never, { p_bl_id: blId, p_roe: roe, p_reason: text } as never)
  if (error) throw error
}
