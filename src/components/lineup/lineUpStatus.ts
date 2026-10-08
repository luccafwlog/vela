import type { LineUpRow } from '../../services/lineup'
import { getVoyagePodCeStatusLabel } from '../../services/voyageRouteSchedules'

export type LineUpStatusTone = 'success' | 'info' | 'warning' | 'danger'

/**
 * Status "BLs e CEs" de uma linha do Line-Up, lido igual no Painel e na TV.
 * A TV tinha um mapa próprio que só conhecia Aprovado/Parcial e mostrava
 * Recebido, Lançando e Em aprovação como "Aguardando" — a mesma escala lia um
 * estado no Painel e outro no quadro.
 */
export function lineUpCeStatus(status: LineUpRow['ceStatus'] | null | undefined): { label: string; tone: LineUpStatusTone } {
  const label = getVoyagePodCeStatusLabel(status)
  if (status === 'approved') return { label, tone: 'success' }
  if (status === 'received' || status === 'approving') return { label, tone: 'info' }
  if (status === 'launching' || status === 'partial') return { label, tone: 'warning' }
  return { label, tone: 'danger' }
}

/** Vinculada: manifestos vinculados à escala no Mercante. */
export function lineUpLinked(linked: boolean | null | undefined): { label: string; tone: LineUpStatusTone } {
  return linked ? { label: 'Sim', tone: 'success' } : { label: 'Não', tone: 'warning' }
}

const integer = new Intl.NumberFormat('pt-BR')

export function formatLineUpInteger(value: number | null | undefined) {
  return integer.format(Number(value ?? 0))
}

/** Exportação ocupa as colunas de carga: granito, containers e movimentos. */
export function lineUpExportLabel(row: Pick<LineUpRow, 'exportHasGranite' | 'exportContainersQty' | 'exportMovementsQty'>) {
  const parts: string[] = ['Exportação']
  if (row.exportHasGranite) parts.push('Granito')
  if (row.exportContainersQty !== null) {
    const moves = row.exportMovementsQty !== null ? ` · ${formatLineUpInteger(row.exportMovementsQty)} movimentos` : ''
    parts.push(`${formatLineUpInteger(row.exportContainersQty)} CNTRs${moves}`)
  }
  return parts.join(' · ')
}
