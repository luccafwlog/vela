export const isUsualLine = (status: string | null) => status === 'calculated' || status === 'ready_for_billing'

/**
 * Colunas da tabela de Taxas Locais que só aparecem quando alguma linha foge
 * do normal (identidade, lote 1): Origem com linha manual, Situação com linha
 * em revisão, isenta ou revisada, Observação com texto, Ações com linha
 * manual em B/L ainda não faturado.
 */
export function chargeTableColumns(
  lines: Array<{ source: string | null; status: string | null; review_reason?: string | null; notes?: string | null }>,
  locked: boolean,
) {
  const showOrigin = lines.some((line) => line.source === 'manual')
  return {
    showOrigin,
    showSituation: lines.some((line) => !isUsualLine(line.status)),
    showNotes: lines.some((line) => Boolean(line.review_reason ?? line.notes)),
    showActions: !locked && showOrigin,
  }
}
