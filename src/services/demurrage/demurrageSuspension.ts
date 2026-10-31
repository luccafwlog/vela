/**
 * Fim do motivo de a Invoice estar fora da Régua porque os itens não batem
 * mais com o que vale hoje. Desde a migration 524 o começo diz a causa:
 * "Datas de container alteradas", "Container passou a SOC" ou "Divisão da
 * caixa entre Clientes alterada" (`_demurrage_stale_reason`).
 */
export const STALE_PAID_SUFFIX = ' depois do pagamento; conferir a diferença.'
export const STALE_NEGOTIATED_SUFFIX = ' em Invoice com desconto ou disputa; reemitir à mão.'

/** A causa da diferença ("Container passou a SOC"…), ou null quando o motivo é outro. */
export function staleSuspensionCause(reason: string | null | undefined): { cause: string; paid: boolean } | null {
  const text = reason?.trim() ?? ''
  if (text.endsWith(STALE_PAID_SUFFIX)) return { cause: text.slice(0, -STALE_PAID_SUFFIX.length), paid: true }
  if (text.endsWith(STALE_NEGOTIATED_SUFFIX)) return { cause: text.slice(0, -STALE_NEGOTIATED_SUFFIX.length), paid: false }
  return null
}
