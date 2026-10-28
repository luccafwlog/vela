import { chargeLineActions } from './blChargeAdjustmentPresentation'

export const isUsualLine = (status: string | null) => status === 'calculated' || status === 'ready_for_billing'

/**
 * Colunas da tabela de Taxas Locais que só aparecem quando alguma linha foge
 * do normal (identidade, lote 1): Origem com linha manual, Situação com linha
 * em revisão, isenta, excluída ou revisada, Observação com texto, Ações com
 * alguma linha que aceite ação (ADR 0111: toda linha calculada ou manual fora
 * de revisão, em B/L que não é só consulta).
 */
export function chargeTableColumns(
  lines: Array<{
    source: string | null
    status: string | null
    review_reason?: string | null
    notes?: string | null
    adjustment_id?: number | null
    adjustment_kind?: string | null
  }>,
  locked: boolean,
) {
  const showOrigin = lines.some((line) => line.source === 'manual')
  return {
    showOrigin,
    showSituation: lines.some((line) => !isUsualLine(line.status)),
    showNotes: lines.some((line) => Boolean(line.review_reason ?? line.notes)),
    showActions: lines.some((line) => chargeLineActions(line, locked).length > 0),
  }
}
