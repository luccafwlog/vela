import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  closeReport,
  closeReportByReportId,
  fetchTerminalAtdRegisteredAt,
  getAgencyReportOwnDataByReportId,
  getAgencyReportDerivedData,
  getAgencyReportOwnData,
  listClosedAgencyReportPorts,
  listDepartmentSignoffEvents,
  listDepartmentSignoffEventsByReportId,
  listSignoffEvents,
  listSignoffEventsByReportId,
  reopenReport,
  reopenReportByReportId,
  setDepartmentSignoff,
  setDepartmentSignoffByReportId,
  setSectionObservation,
  setSectionObservationByReportId,
  setSignoff,
  setSignoffByReportId,
  setTerminal,
} from '../services/agencyDepartureReport'
import { fetchEscalaTerminalState } from '../services/escalaTerminalAllocation'
import { listAgencyReportSlaRows, type AgencyReportSlaDateRange } from '../services/agencyReportSla'
import { queryKeys } from '../services/queryKeys'

export function useAgencyReportDerived(voyageId: number, port: string | null) {
  return useQuery({
    queryKey: queryKeys.agencyReports.byScale(voyageId, port ?? ''),
    queryFn: () => getAgencyReportDerivedData(voyageId, port as string),
    enabled: Boolean(port),
  })
}

export function useAgencyReportOwn(voyageId: number, port: string | null, reportId?: string | null) {
  return useQuery({
    queryKey: reportId ? queryKeys.agencyReports.ownByReportId(reportId) : queryKeys.agencyReports.ownByScale(voyageId, port ?? ''),
    queryFn: () => reportId ? getAgencyReportOwnDataByReportId(reportId) : getAgencyReportOwnData(voyageId, port as string),
    enabled: Boolean(reportId || port),
  })
}

export function useAgencyReportTerminalState(voyageId: number, port: string | null) {
  return useQuery({
    queryKey: queryKeys.agencyReports.terminalState(voyageId, port ?? ''),
    queryFn: () => fetchEscalaTerminalState(voyageId, port as string),
    enabled: Boolean(port),
    retry: false,
  })
}

// Portos com ADR fechado da viagem (Task 2 do ADR 2026-07-31): usado por
// VoyageCard para não sumir com a escala omitida que já tem ADR fechado.
// Uma query por card renderizado na lista de viagens — staleTime evita
// refetch a cada montagem/foco de janela para um dado que muda raramente
// (mesmo valor usado por useVoyageReconciliation, o hook irmão no mesmo card).
export function useClosedAgencyReportPorts(voyageId: number) {
  return useQuery({
    queryKey: ['agency-report-closed-ports', voyageId],
    queryFn: () => listClosedAgencyReportPorts(voyageId),
    staleTime: 60_000,
  })
}

function useAgencyReportOwnMutation<T>(mutationFn: (input: T) => Promise<void>, extraKeys: string[] = []) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      for (const queryKey of [['agency-report-own'], ...extraKeys.map((key) => [key])]) {
        void queryClient.invalidateQueries({ queryKey })
      }
    },
  })
}

export function useSetAgencyReportSignoff(reportId?: string | null) {
  return useAgencyReportOwnMutation((input: Parameters<typeof setSignoff>[0]) => (
    reportId ? setSignoffByReportId({ ...input, reportId }) : setSignoff(input)
  ), ['agency-report-signoff-events'])
}

export function useSetAgencyReportDepartmentSignoff(reportId?: string | null) {
  return useAgencyReportOwnMutation((input: Parameters<typeof setDepartmentSignoff>[0]) => (
    reportId ? setDepartmentSignoffByReportId({ ...input, reportId }) : setDepartmentSignoff(input)
  ), ['agency-report-department-signoff-events'])
}

export function useSetAgencyReportSectionObservation(reportId?: string | null) {
  return useAgencyReportOwnMutation((input: Parameters<typeof setSectionObservation>[0]) => (
    reportId ? setSectionObservationByReportId({ ...input, reportId }) : setSectionObservation(input)
  ))
}

export function useAgencyReportSignoffEvents(voyageId: number, port: string | null, reportId?: string | null) {
  return useQuery({
    queryKey: reportId ? ['agency-report-signoff-events', 'report', reportId] : ['agency-report-signoff-events', voyageId, port],
    queryFn: () => reportId ? listSignoffEventsByReportId(reportId) : listSignoffEvents(voyageId, port as string),
    enabled: Boolean(reportId || port),
  })
}

export function useAgencyReportDepartmentSignoffEvents(voyageId: number, port: string | null, reportId?: string | null) {
  return useQuery({
    queryKey: reportId ? ['agency-report-department-signoff-events', 'report', reportId] : ['agency-report-department-signoff-events', voyageId, port],
    queryFn: () => reportId ? listDepartmentSignoffEventsByReportId(reportId) : listDepartmentSignoffEvents(voyageId, port as string),
    enabled: Boolean(reportId || port),
  })
}

// B8: a chave inclui o ATD, então registrar outro ATD busca de novo o momento do registro.
export function useAgencyReportAtdRegisteredAt(voyageId: number, port: string | null, terminalId: string | null, atd: string | null) {
  return useQuery({
    queryKey: ['agency-report-atd-registered-at', voyageId, port, terminalId, atd],
    queryFn: () => fetchTerminalAtdRegisteredAt(voyageId, port as string, terminalId as string, atd as string),
    enabled: Boolean(port && terminalId && atd),
  })
}

export function useSetAgencyReportTerminal() {
  return useAgencyReportOwnMutation(setTerminal)
}

// Fechamento/reabertura também altera alertas e os indicadores exibidos no
// header, no Painel e na tela de Alertas.
const CLOSE_REOPEN_KEYS = ['agency-report', 'agency-report-signoff-events', 'alerts', 'op-count', 'header-alert', 'dashboard']

export function useCloseAgencyReport(reportId?: string | null) {
  return useAgencyReportOwnMutation((input: Parameters<typeof closeReport>[0]) => (
    reportId ? closeReportByReportId({ ...input, reportId }) : closeReport(input)
  ), CLOSE_REOPEN_KEYS)
}

export function useReopenAgencyReport(reportId?: string | null) {
  return useAgencyReportOwnMutation((input: Parameters<typeof reopenReport>[0]) => (
    reportId ? reopenReportByReportId({ ...input, reportId }) : reopenReport(input)
  ), CLOSE_REOPEN_KEYS)
}

// Agregado de SLA do Prazo de Conclusão do ADR (Task 5 do ADR 0039), exibido
// em Administração ("Prazo do ADR"). `enabled` fica a cargo da chamadora
// (tab === '...'), mesmo padrão lazy-load de logs/métricas em Admin.
export function useAgencyReportSla(range: AgencyReportSlaDateRange | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['agency-report-sla', range?.from ?? null, range?.to ?? null],
    queryFn: () => listAgencyReportSlaRows(range),
    enabled,
    staleTime: 30_000,
  })
}
