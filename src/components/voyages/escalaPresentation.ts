import { deriveEscalaState } from '../../lib/escalaState'
import { formatDate } from '../../lib/utils'
import { isEtaOverdue } from '../../services/voyageSummaries'
import type { VoyageAtracacao } from '../../services/voyageRouteSchedules'
import type { Step } from '../ui/StepRail'

/**
 * Leitura das datas de uma Escala na ficha da Viagem (etapa 03).
 *
 * A Escala é dona de ETA/ATA (chegada ao porto); cada Atracação é dona de
 * ETB/ATB/ETD/ATD no seu terminal (CONTEXT.md). Por isso a chegada nunca cita
 * terminal e a saída sempre cita o terminal que a produziu. Previsão e
 * realização ficam distintas: a data efetiva não apaga a prevista.
 */
export type EscalaDatesInput = {
  port: string
  eta: string | null
  ata: string | null
  atd?: string | null
  omitted?: boolean
  atracacoes?: VoyageAtracacao[] | null
}

export type ArrivalState = 'omitted' | 'actual' | 'overdue' | 'forecast' | 'missing'

export type ArrivalReading = {
  state: ArrivalState
  /** Data principal da célula (ATA, ou ETA quando não houve chegada). */
  date: string | null
  /** Linha secundária: de onde vem a data e o que falta. */
  caption: string
}

export function describeArrival(row: EscalaDatesInput, now: Date = new Date()): ArrivalReading {
  if (row.omitted) return { state: 'omitted', date: null, caption: 'Escala omitida pelo armador' }
  if (row.ata) {
    const forecast = row.eta && row.eta !== row.ata ? ` · prev. ${formatDate(row.eta)}` : ''
    return { state: 'actual', date: row.ata, caption: `ATA real${forecast}` }
  }
  if (!row.eta) return { state: 'missing', date: null, caption: 'ETA não informado' }
  if (isEtaOverdue(row.eta, now)) return { state: 'overdue', date: row.eta, caption: 'ETA vencido — ATA pendente' }
  return { state: 'forecast', date: row.eta, caption: 'ETA previsto' }
}

export type DepartureReading = {
  state: 'actual' | 'forecast' | 'missing'
  date: string | null
  caption: string
}

function terminalName(atracacao: Pick<VoyageAtracacao, 'terminalCode'>) {
  return atracacao.terminalCode?.trim() || 'TBC'
}

/**
 * Saída do porto: o ATD da Escala é derivado da última Atracação e só existe
 * quando todas desatracaram. Antes disso, a previsão é o ETD mais tardio, com o
 * terminal que o informou.
 */
export function describeDeparture(row: EscalaDatesInput): DepartureReading {
  const atracacoes = row.atracacoes ?? []
  if (row.omitted) return { state: 'missing', date: null, caption: '—' }
  if (row.atd) {
    const owner = atracacoes.reduce<VoyageAtracacao | null>((latest, item) => (
      item.atd && (!latest || String(item.atd) > String(latest.atd)) ? item : latest
    ), null)
    return { state: 'actual', date: row.atd, caption: owner ? `ATD · ${terminalName(owner)}` : 'ATD real' }
  }
  const pendingTerminal = atracacoes.find((item) => !item.atd)
  const latestEtd = atracacoes.reduce<VoyageAtracacao | null>((latest, item) => (
    item.etd && (!latest || String(item.etd) > String(latest.etd)) ? item : latest
  ), null)
  if (latestEtd?.etd) {
    return { state: 'forecast', date: latestEtd.etd, caption: `ETD previsto · ${terminalName(latestEtd)}` }
  }
  if (pendingTerminal) return { state: 'missing', date: null, caption: `Aguardando ETD de ${terminalName(pendingTerminal)}` }
  return { state: 'missing', date: null, caption: 'Sem atracação' }
}

export type EscalaStateTag = { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' }

/** Estado curto da escala para o rótulo ao lado do porto; nunca só cor. */
export function escalaStateTag(row: EscalaDatesInput, isNext: boolean, now: Date = new Date()): EscalaStateTag | null {
  if (row.omitted) return { label: 'Omitida', tone: 'warning' }
  const atracacoes = row.atracacoes ?? []
  const state = deriveEscalaState({ atracacoes: atracacoes.map((item) => ({ atb: item.atb ?? null, atd: item.atd ?? null })) })
  if (state === 'concluida') return { label: 'Concluída', tone: 'neutral' }
  if (state === 'atracada') return { label: 'Atracada', tone: 'success' }
  if (row.ata) return { label: 'Chegou', tone: 'info' }
  if (isNext) return isEtaOverdue(row.eta, now) ? { label: 'ETA vencido', tone: 'danger' } : { label: 'Próxima', tone: 'info' }
  return null
}

function sortKey(row: EscalaDatesInput) {
  return row.ata ?? row.eta ?? '9999-12-31'
}

/**
 * Trilho das escalas brasileiras, na ordem da chegada (ATA, senão ETA; sem
 * data no fim). A escala atual é a atracada ou, sem atracação aberta, a
 * próxima a chegar.
 */
export function buildEscalaTrail(rows: EscalaDatesInput[], nextPort: string | null, now: Date = new Date()): Step[] {
  const ordered = [...rows].sort((left, right) => sortKey(left).localeCompare(sortKey(right)) || left.port.localeCompare(right.port))
  const hasBerthed = ordered.some((row) => escalaStateTag(row, false, now)?.label === 'Atracada')
  const steps = ordered.map((row) => {
    const isNext = row.port === nextPort
    const tag = escalaStateTag(row, isNext, now)
    const arrival = describeArrival(row, now)
    const departure = describeDeparture(row)
    let state: Step['state'] = 'pending'
    let detail: string
    if (row.omitted) {
      state = 'skipped'
      detail = 'OMIT'
    } else if (tag?.label === 'Concluída') {
      state = 'done'
      detail = `Concluída · ATD ${formatDate(departure.date)}`
    } else if (tag?.label === 'Atracada') {
      state = 'current'
      detail = 'Atracada'
    } else if (tag?.label === 'Chegou') {
      state = hasBerthed ? 'done' : 'current'
      detail = `Chegou · ATA ${formatDate(arrival.date)}`
    } else if (arrival.state === 'overdue') {
      state = hasBerthed ? 'pending' : isNext ? 'current' : 'pending'
      detail = `ETA ${formatDate(arrival.date)} vencido`
    } else if (arrival.state === 'forecast') {
      state = !hasBerthed && isNext ? 'current' : 'pending'
      detail = `ETA ${formatDate(arrival.date)}`
    } else {
      detail = 'ETA não informado'
    }
    return { key: row.port, label: row.port, detail, state }
  })
  // Um navio está em um lugar só: com mais de uma chegada sem atracação
  // registrada, só a mais recente é a atual; as anteriores ficaram para trás.
  const currentIndexes = steps.flatMap((step, index) => (step.state === 'current' ? [index] : []))
  if (currentIndexes.length > 1) {
    const keep = currentIndexes.find((index) => steps[index].detail === 'Atracada')
      ?? [...currentIndexes].reverse().find((index) => steps[index].detail?.startsWith('Chegou'))
      ?? currentIndexes[0]
    for (const index of currentIndexes) {
      if (index === keep) continue
      steps[index] = { ...steps[index], state: steps[index].detail?.startsWith('Chegou') ? 'done' : 'pending' }
    }
  }
  return steps
}
