import { supabase } from './supabase'

export type SetBlTerminalOverrideInput = {
  blId: string
  terminalId: string | null
  podPortId: number | null
  justification: string
  changedBy?: string | null
}


/**
 * A exceção de terminal é uma mutação de domínio: não fazemos UPDATE direto
 * em `bls`, porque o banco registra autor, data, valores anterior/novo e a
 * justificativa numa única transação.
 */
export async function setBlTerminalOverride(input: SetBlTerminalOverrideInput): Promise<unknown> {
  const { data, error } = await supabase.rpc('set_bl_terminal_override' as never, {
    p_bl_id: input.blId,
    p_terminal_id: input.terminalId,
    p_pod_port_id: input.podPortId,
    p_justification: input.justification,
    p_changed_by: input.changedBy ?? null,
  } as never)
  if (error) throw new Error((error as { message?: string }).message ?? 'Não foi possível atualizar a exceção de terminal.')
  return data
}
