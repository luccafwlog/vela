import type { PortalScheduleLane } from '../../services/portalScheduleLanes'
import type { PortalScheduleVoyage } from '../../services/portalScheduleVoyages'

/** "VITÓRIA" → "Vitória": a constante guarda o rótulo da planilha, em caixa alta. */
export function scheduleLaneTitle(lane: PortalScheduleLane) {
  return lane.label.charAt(0) + lane.label.slice(1).toLocaleLowerCase('pt-BR')
}

function todayIso() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export type ScheduleCellState = 'actual' | 'forecast' | 'overdue' | 'omitted' | 'none'

/**
 * Estado de uma célula da Programação, igual no Portal e em Chegadas e Saídas.
 * `actual` é a data efetiva (ATD no POL, ATA no POD); `overdue` é uma
 * previsão já passada sem a data efetiva — não é atraso confirmado, só falta
 * de confirmação. OMIT (escala omitida pelo armador) é distinto de X (sem data).
 */
export function scheduleCellState(voyage: PortalScheduleVoyage, lane: PortalScheduleLane, today = todayIso()): { state: ScheduleCellState; value: string | null } {
  if (voyage.omittedByLabel?.[lane.label]) return { state: 'omitted', value: null }
  const actual = voyage.actualDatesByLabel?.[lane.label]
  if (actual) return { state: 'actual', value: actual }
  const value = voyage.datesByLabel[lane.label]
  if (!value || value === 'X') return { state: 'none', value: null }
  return { state: value < today ? 'overdue' : 'forecast', value }
}

