import {
  previewBlChargeChangeEffect,
  type BlChargeChangeAction,
} from '../../services/charges/chargeOperationsService'

export type InvoiceEffectRead = { ok: true; message: string | null } | { ok: false; error: unknown }

/**
 * Frase do efeito na fatura para a confirmação (ADR 0111, D8). Só o B/L
 * faturado consulta o banco; os outros não têm fatura a corrigir. A recusa da
 * ação volta como erro, para a tela avisar antes de pedir a justificativa.
 */
export async function readInvoiceEffect(
  billed: boolean,
  input: { blId: string; action: BlChargeChangeAction; lineKey?: string | null; kind?: 'unit' | 'total' | null; value?: number | null },
): Promise<InvoiceEffectRead> {
  if (!billed) return { ok: true, message: null }
  try {
    const effect = await previewBlChargeChangeEffect(input)
    return { ok: true, message: effect?.message ?? null }
  } catch (error) {
    return { ok: false, error }
  }
}
