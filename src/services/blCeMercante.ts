import { supabase } from './supabase'

// Porta única do CE Mercante (ADR 0078, item 3; migration 176). A ficha do B/L
// não grava `ce_mercante` pelo Salvar: corrigir e remover passam por RPCs que
// exigem motivo, registram o Histórico e abrem a pendência de reenvio do
// Comunicado de CE e Taxas quando ele já foi enviado.

export const CE_MERCANTE_PATTERN = /^\d{15}$/

export function normalizeCeMercanteInput(value: string): string {
  return value.replace(/\D/g, '')
}

export async function correctBlCeMercante(input: { blId: string; ce: string; reason: string }): Promise<void> {
  const { error } = await supabase.rpc('correct_bl_ce_mercante' as never, {
    p_bl_id: input.blId,
    p_ce: normalizeCeMercanteInput(input.ce),
    p_reason: input.reason,
  } as never)
  if (error) throw error
}

export async function removeBlCeMercante(input: { blId: string; reason: string }): Promise<void> {
  const { error } = await supabase.rpc('remove_bl_ce_mercante' as never, {
    p_bl_id: input.blId,
    p_reason: input.reason,
  } as never)
  if (error) throw error
}
