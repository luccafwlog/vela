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

  // Capture o POD antes da RPC: set_bl_cod já muta o B/L e a leitura posterior
  // não consegue mais reconstruir o valor anterior para a auditoria/retorno.
  const { data: currentBl, error: fetchError } = await supabase
    .from('bls')
    .select('id, pod, ce_mercante, manifesto_mercante_id')
    .eq('id', blId)
    .single()

  if (fetchError) throw fetchError
  if (!currentBl) throw new Error(`B/L ${blId} não encontrado.`)

  const oldPod = currentBl.pod ?? ''

  // Se houver omissão vinculada, executa a RPC set_bl_cod
  if (omissionId != null) {
    const { error: rpcError } = await supabase.rpc('set_bl_cod', {
      p_bl_id: blId,
      p_omission_id: omissionId,
      p_justification: reason ?? 'Alteração de destino (COD)',
      p_changed_by: changedBy,
    })
    if (rpcError) throw rpcError

    // O destino efetivo pertence à omissão e pode ser diferente de newPod.
    // Releia-o apenas para devolver o estado persistido; não faça um update
    // direto que contorne a auditoria e a limpeza do manifesto da RPC.
    const { data: updatedBl, error: updatedFetchError } = await supabase
      .from('bls')
      .select('pod, ce_mercante, manifesto_mercante_id')
      .eq('id', blId)
      .single()

    if (updatedFetchError) throw updatedFetchError
    return {
      blId,
      oldPod,
      newPod: updatedBl?.pod ?? newPod,
      ceMercante: updatedBl?.ce_mercante ?? currentBl.ce_mercante,
      manifestoMercanteId: updatedBl?.manifesto_mercante_id ?? null,
    }
  }

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
