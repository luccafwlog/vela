import { supabase } from './supabase'

export type SetBlTerminalOverrideInput = {
  blId: string
  terminalId: string | null
  podPortId: number | null
  justification: string
  changedBy?: string | null
}

type RpcResult = { data: unknown; error: { message?: string } | null }

/**
 * A exceção de terminal é uma mutação de domínio: não fazemos UPDATE direto
 * em `bls`, porque o banco registra autor, data, valores anterior/novo e a
 * justificativa numa única transação.
 */
export async function setBlTerminalOverride(input: SetBlTerminalOverrideInput): Promise<unknown> {
  const rpc = supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>
  const { data, error } = await rpc('set_bl_terminal_override', {
    p_bl_id: input.blId,
    p_terminal_id: input.terminalId,
    p_pod_port_id: input.podPortId,
    p_justification: input.justification,
    p_changed_by: input.changedBy ?? null,
  })
  if (error) throw new Error(error.message ?? 'Não foi possível atualizar a exceção de terminal.')
  return data
}
