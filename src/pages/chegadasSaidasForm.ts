import { PORTAL_SCHEDULE_LANES, portalLaneCode } from '../services/portalScheduleLanes'
import type { PortalScheduleVoyage } from '../services/portalScheduleVoyages'
import type { ScheduleLaneInput } from '../services/voyageFromSchedule'

export type ScheduleForm = {
  vesselName: string
  vesselImo: string
  voyageNumber: string
  /** Data ISO por label de lane; '' = nao escala. */
  dates: Record<string, string>
  /** Se true, o navio nao escala nesta lane. */
  omitted?: Record<string, boolean>
}

export const emptyScheduleForm: ScheduleForm = {
  vesselName: '',
  vesselImo: '',
  voyageNumber: '',
  dates: Object.fromEntries(PORTAL_SCHEDULE_LANES.map((lane) => [lane.label, ''])),
  omitted: Object.fromEntries(PORTAL_SCHEDULE_LANES.map((lane) => [lane.label, true])),
}

export function buildScheduleLanes(form: ScheduleForm): ScheduleLaneInput[] {
  return PORTAL_SCHEDULE_LANES.map((lane) => ({
    code: portalLaneCode(lane),
    kind: lane.kind,
    date: form.dates[lane.label]?.trim() ? form.dates[lane.label].trim() : null,
  }))
}

export function scheduleFormFromVoyage(voyage: PortalScheduleVoyage): ScheduleForm {
  return {
    vesselName: voyage.vesselName,
    vesselImo: voyage.imoNumber ?? '',
    voyageNumber: voyage.voyage,
    dates: Object.fromEntries(PORTAL_SCHEDULE_LANES.map((lane) => [
      lane.label,
      voyage.forecastDatesByLabel?.[lane.label] ?? voyage.datesByLabel[lane.label] ?? '',
    ])),
    omitted: Object.fromEntries(PORTAL_SCHEDULE_LANES.map((lane) => {
      const dateVal = voyage.forecastDatesByLabel?.[lane.label] ?? voyage.datesByLabel[lane.label]
      const isOmitted = Boolean(voyage.omittedByLabel?.[lane.label]) || !dateVal || dateVal === 'X'
      return [lane.label, isOmitted]
    })),
  }
}

/**
 * Portos de descarga que tinham data na publicação e passaram a "não escala"
 * na edição. Para cada um, `createOrAttachVoyageFromSchedule` remove a escala
 * da Viagem quando ela não tem B/L, ATA nem manifesto; por isso a tela confirma.
 */
export function clearedPodLabels(original: ScheduleForm, next: ScheduleForm): string[] {
  return PORTAL_SCHEDULE_LANES
    .filter((lane) => lane.kind === 'pod')
    .filter((lane) => Boolean(original.dates[lane.label]?.trim()) && !next.dates[lane.label]?.trim())
    .map((lane) => lane.label)
}
