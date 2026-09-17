import { supabase } from './supabase'

export type ApplyCodInput = {
  blId: string
  newPod: string
  reason?: string | null
  changedBy: string
  omissionId?: number | null
}

export type ApplyCodResult = {
  blId: string
  oldPod: string
  newPod: string
  ceMercante: string | null
  manifestoMercanteId: string | null
}

export async function applyChangeOfDestination(input: ApplyCodInput): Promise<ApplyCodResult> {
  const { blId, newPod, reason, changedBy, omissionId } = input

  // Se houver omissão vinculada, executa a RPC set_bl_cod
  if (omissionId != null) {
    const { error: rpcError } = await supabase.rpc('set_bl_cod', {
      p_bl_id: blId,
      p_omission_id: omissionId,
      p_justification: reason ?? 'Alteração de destino (COD)',
      p_changed_by: changedBy,
    })
    if (rpcError) throw rpcError
  }

  // Busca dados atuais do B/L
  const { data: currentBl, error: fetchError } = await supabase
    .from('bls')
    .select('id, pod, ce_mercante, manifesto_mercante_id')
    .eq('id', blId)
    .single()

  if (fetchError) throw fetchError
  if (!currentBl) throw new Error(`B/L ${blId} não encontrado.`)

  const oldPod = currentBl.pod ?? ''

  // Ao alterar o destino (COD):
  // 1. O ce_mercante permanece inalterado (fato 8 da spec)
  // 2. manifesto_mercante_id é limpo (NULL), gerando pendência operacional
  const { error: updateError } = await supabase
    .from('bls')
    .update({
      pod: newPod,
      manifesto_mercante_id: null,
    })
    .eq('id', blId)

  if (updateError) throw updateError

  return {
    blId,
    oldPod,
    newPod,
    ceMercante: currentBl.ce_mercante,
    manifestoMercanteId: null,
  }
}
