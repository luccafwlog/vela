import { supabase } from './supabase'

export type CancelBlResult = { cancelled: boolean; reasons: string[] }

/**
 * Cancela um B/L com CE Mercante que nao vai seguir (ADR 0071, item 9). So o
 * Administrativo; recusado enquanto houver fatura, recebivel ou fatura de
 * Demurrage em aberto. Com `dryRun`, so devolve o que bloqueia.
 */
export async function cancelBl(blId: string, reason: string, options: { dryRun?: boolean } = {}): Promise<CancelBlResult> {
  const { data, error } = await supabase.rpc('cancel_bl' as never, {
    p_bl_id: blId,
    p_reason: reason,
    p_dry_run: options.dryRun ?? false,
  } as never)
  if (error) throw error
  return data as unknown as CancelBlResult
}

/** Devolve um B/L cancelado por engano; so o Administrativo, com motivo. */
export async function reactivateBl(blId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('reactivate_bl' as never, { p_bl_id: blId, p_reason: reason } as never)
  if (error) throw error
}
