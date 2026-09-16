import { Fragment, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, ChevronUp, Clock, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { MetricSection } from '../shared/VoyageSectionCards'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { useAuth } from '../../hooks/useAuth'
import { useVoyageTimeline } from '../../hooks/useVoyageTimeline'
import { formatDate } from '../../lib/utils'
import { classifyDbError } from '../../lib/errors'
import { normalizePortName } from '../../lib/voyageFormat'
import { normalizePortCode } from '../../services/portCode'
import {
  buildVoyageTimeline,
  groupBlsByRoute,
  type VoyageTimelineEvent,
} from '../../services/voyageSummaries'
import { deleteVoyagePodSchedule, type VoyageEscalaDivergence, type VoyageEscalaSchedule } from '../../services/voyageRouteSchedules'
import { deleteVoyageExportSchedule, type VoyageExportSchedule } from '../../services/voyageExportSchedules'
import { listVaziosExportEmbarkPorts } from '../../services/vaziosExportOperations'
import { queryKeys } from '../../services/queryKeys'
import { afterEscalaAlterada } from '../../services/cacheEffects'
import {
  renderCeStatusLabel,
  renderEscalaNumber,
  renderLinkedLabel,
  type VoyageImportBatch,
} from './voyageCardHelpers'
import type { Voyage } from './voyageCardTypes'
import type { EscalaModalData } from '../shared/VoyageScheduleModals'
import { TransshipmentInfoCard } from './TransshipmentInfoCard'

export function VoyageVisaoTab({
  voyage,
  voyageLabel,
  escalaRows,
  importBatches,
  exportSchedules,
  isAdmin,
  divergenceCount,
  ceCoverage,
  onEditEscala,
  onOmitPod,
}: {
  voyage: Voyage
  voyageLabel: string
  escalaRows: VoyageEscalaSchedule[]
  importBatches: VoyageImportBatch[]
  exportSchedules: VoyageExportSchedule[]
  isAdmin: boolean
  divergenceCount: number
  ceCoverage: { filled: number; total: number }
  onEditEscala: (payload: EscalaModalData) => void
  onOmitPod: (pod: string) => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { user, profile } = useAuth()
  const canEditVoyages = Boolean(profile || user)
  const [timelineOpen, setTimelineOpen] = useState(true)
  const [collapsedAtracacoes, setCollapsedAtracacoes] = useState<Set<string>>(() => new Set())

  function toggleAtracacoes(port: string) {
    setCollapsedAtracacoes((current) => {
      const next = new Set(current)
      if (next.has(port)) next.delete(port)
      else next.add(port)
      return next
    })
  }

  // Rota (POL -> POD) de cada manifesto, derivada dos B/Ls do batch, para
  // identificar o import na linha do tempo pela rota em vez do nome do arquivo.
  const routesByBatchId = useMemo(() => groupBlsByRoute(voyage.bls), [voyage.bls])

  const { data: timelineSources } = useVoyageTimeline(voyage.id)
  const timelineEvents = useMemo(
    () =>
      buildVoyageTimeline({
        importBatches: (timelineSources?.importBatches ?? importBatches).map((batch) => ({ ...batch, route: batch.route_summary ?? undefined, routes: routesByBatchId.get(batch.id) })),
        scheduleEvents: timelineSources?.scheduleEvents,
        auditEvents: timelineSources?.auditEvents,
        resolutions: timelineSources?.resolutions,
        baplieImports: timelineSources?.baplieImports,
        openDivergenceCount: divergenceCount,
        voyageStatus: voyage.status,
        ceCoverage,
        actorNames: timelineSources?.actorNames,
        actorDepartments: timelineSources?.actorDepartments,
      }),
    [ceCoverage, divergenceCount, importBatches, routesByBatchId, timelineSources, voyage.status],
  )

  const exportScheduleByPort = useMemo(() => {
    const byPort = new Map<string, VoyageExportSchedule>()
    for (const schedule of exportSchedules) {
      byPort.set(normalizePortCode(schedule.pol) ?? normalizePortName(schedule.pol), schedule)
    }
    return byPort
  }, [exportSchedules])

  // Embarque de Vazios é (viagem, porto): a lista de portos diz em qual escala
  // existe carga de exportação registrada.
  const { data: vaziosExportPorts } = useQuery({
    queryKey: queryKeys.voyages.vaziosExportPorts(voyage.id),
    queryFn: () => listVaziosExportEmbarkPorts(voyage.id),
  })

  // A declaração de exportação não pode ser retirada de uma escala que já tem
  // carga: granito pelo porto de carregamento do manifesto, vazios pelo porto
  // de embarque da operação.
  const granitePorts = useMemo(() => {
    const ports = new Set<string>()
    for (const manifest of voyage.granite_manifests ?? []) {
      const normalized = normalizePortCode(manifest.loading_port)
      if (normalized) ports.add(normalized)
    }
    return ports
  }, [voyage.granite_manifests])

  const emptyPorts = useMemo(() => {
    const ports = new Set<string>()
    for (const port of vaziosExportPorts ?? []) ports.add(port)
    return ports
  }, [vaziosExportPorts])

  const portsWithExportCargo = useMemo(
    () => new Set([...granitePorts, ...emptyPorts]),
    [granitePorts, emptyPorts],
  )

  function buildEscalaModalData(row: VoyageEscalaSchedule | null, focusTerminalId?: string | null): EscalaModalData {
    const exportSchedule = row
      ? exportScheduleByPort.get(normalizePortCode(row.port) ?? normalizePortName(row.port)) ?? null
      : null
    return {
      voyageId: voyage.id,
      voyageLabel,
      port: row?.port ?? null,
      // Escala nova nasce importadora: o modo de operacao exibido ja e
      // Importacao, e sem isto o salvamento gravaria tem_importacao = false
      // contra o que a tela mostra.
      temImportacao: row?.temImportacao ?? true,
      eta: row?.eta ?? null,
      ata: row?.ata ?? null,
      // Em uma escala com importação, o campo editável é exclusivamente o
      // status do POD. `row.ceStatus` pode carregar o status da exportação em
      // payloads legados e não pode reabrir o modal como se fosse um CE recebido.
      ceStatus: (row?.temImportacao ? row.podCeStatus : row?.ceStatus ?? null) as EscalaModalData['ceStatus'],
      linked: row?.linked ?? null,
      escalaNumber: row?.escalaNumber ?? null,
      exportExistingId: exportSchedule?.id ?? null,
      temExportacao: exportSchedule?.temExportacao ?? false,
      hasGranite: exportSchedule?.hasGranite ?? false,
      // `fetchExportSchedulesByVoyageIds` normaliza linha legada sem coluna para
      // false; só usamos o marcador agregado quando não existe declaração.
      hasEmpty: exportSchedule ? exportSchedule.hasEmpty : Boolean(row?.temVazios),
      containersQty: exportSchedule?.containersQty ?? null,
      movementsQty: exportSchedule?.movementsQty ?? null,
      dischargePorts: exportSchedule?.dischargePorts ?? [],
      exportLocked: row ? portsWithExportCargo.has(normalizePortCode(row.port) ?? normalizePortName(row.port)) : false,
      graniteLocked: row ? granitePorts.has(normalizePortCode(row.port) ?? normalizePortName(row.port)) : false,
      emptyLocked: row ? emptyPorts.has(normalizePortCode(row.port) ?? normalizePortName(row.port)) : false,
      focusTerminalId,
    }
  }

  // Uma escala, uma exclusão: o portador das datas e a linha de exportação do
  // mesmo porto saem juntos.
  async function handleDeleteEscala(row: VoyageEscalaSchedule) {
    const exportSchedule = exportScheduleByPort.get(normalizePortCode(row.port) ?? normalizePortName(row.port)) ?? null
    const routeBls = (voyage.bls ?? []).filter((bl) => (normalizePortCode(bl.pod) ?? normalizePortName(bl.pod)) === (normalizePortCode(row.port) ?? normalizePortName(row.port)))
    const hasScheduleData = Boolean(row.eta || row.ata || row.atd || (row.atracacoes ?? []).some((atracacao) => atracacao.etb || atracacao.atb || atracacao.etd || atracacao.atd || atracacao.rtw !== null))
    if (routeBls.length > 0) {
      showToast('Não é possível excluir esta escala: existem B/Ls vinculados.', 'error')
      return
    }
    if (!hasScheduleData && row.linked !== true && !exportSchedule) {
      showToast('Esta escala ja nao possui dados planejados para remover.', 'info')
      return
    }
    if (!user?.id) {
      showToast('Sessao expirada. Entre novamente para registrar a auditoria.', 'error')
      return
    }
    const confirmed = await confirm({
      title: 'Excluir escala do planejamento',
      message: `Excluir a escala ${row.port}? As datas, o vínculo operacional e o planejamento de exportação serão removidos.`,
      confirmLabel: 'Excluir',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      await Promise.all([
        row.temImportacao ? deleteVoyagePodSchedule({ voyageId: voyage.id, pod: row.port, changedBy: user.id }) : Promise.resolve(),
        exportSchedule ? deleteVoyageExportSchedule(exportSchedule.id) : Promise.resolve(),
      ])
      await afterEscalaAlterada(queryClient, { voyageId: voyage.id })
      showToast('Escala removida do planejamento.', 'success')
    } catch (error) {
      const classified = classifyDbError(error)
      if (classified.kind === 'permissao') {
        showToast('Sem permissão para excluir a escala. Solicite acesso administrativo.', 'error')
        return
      }
      showToast(`Falha ao excluir a escala. Motivo: ${classified.message}`, 'error')
    }
  }

  const planningContent = (
    <MetricSection
      title="Planejamento por escala"
      compact
      actions={canEditVoyages ? (
        <Button variant="secondary" className="app-btn--sm" onClick={() => onEditEscala(buildEscalaModalData(null))}>
          <Plus size={15} />
          Adicionar escala
        </Button>
      ) : undefined}
    >
      <div className="app-voyage-table-frame">
        <div className="app-table-scroll">
          <table className="app-table app-table--compact app-table--dense app-table--sticky-actions w-full text-center text-sm" aria-label="Planejamento por escala">
            <colgroup>
              <col className="min-w-[90px]" />
              <col className="min-w-[150px]" />
              <col className="min-w-[80px]" />
              <col className="min-w-[90px]" />
              <col className="min-w-[100px]" />
              <col className="min-w-[90px]" />
              <col className="min-w-[90px]" />
              <col className="min-w-[90px]" />
              <col className="w-[1%] whitespace-nowrap" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" rowSpan={2} className="px-3 py-2 text-center">Escala</th>
                <th scope="col" rowSpan={2} className="px-3 py-2 text-center">Opera</th>
                <th scope="col" colSpan={2} className="px-3 py-2 text-center">Chegada</th>
                <th scope="col" rowSpan={2} className="px-3 py-2 text-center">ATD</th>
                <th scope="col" rowSpan={2} className="px-3 py-2 text-center">BLs e CEs</th>
                <th scope="col" rowSpan={2} className="px-3 py-2 text-center">Nº Escala</th>
                <th scope="col" rowSpan={2} className="px-3 py-2 text-center">Vinculada</th>
                <th scope="col" rowSpan={2} className="px-3 py-2 text-center">Ações</th>
              </tr>
              <tr>
                <th scope="col" className="px-3 py-2 text-center">ETA · previsto</th>
                <th scope="col" className="px-3 py-2 text-center">ATA · real</th>
              </tr>
            </thead>
            <tbody>
              {escalaRows.length ? (
                escalaRows.map((row) => {
                  const atracacoes = (row.atracacoes ?? []).filter((atracacao) => Boolean(
                    atracacao.terminalId
                    || atracacao.etb
                    || atracacao.atb
                    || atracacao.etd
                    || atracacao.atd
                    || atracacao.rtw !== null && atracacao.rtw !== undefined,
                  ))
                  return (
                    <Fragment key={`${voyage.id}-scale-${row.port}`}>
                    <tr key={`${voyage.id}-lineup-${row.port}`}>
                      <td className="px-3 py-2 align-top text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {atracacoes.length ? (
                            <button
                              type="button"
                              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--app-muted)] hover:bg-[var(--app-panel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-border-focus)]"
                              aria-controls={`${voyage.id}-atracacoes-${row.port}`}
                              aria-expanded={!collapsedAtracacoes.has(row.port)}
                              aria-label={`${collapsedAtracacoes.has(row.port) ? 'Expandir' : 'Recolher'} atracações de ${row.port}`}
                              onClick={() => toggleAtracacoes(row.port)}
                            >
                              {collapsedAtracacoes.has(row.port) ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
                            </button>
                          ) : null}
                          <span className="font-semibold text-[var(--app-text-strong)]">{row.port}</span>
                          {row.omitted ? <Badge tone="slate">OMIT</Badge> : null}
                          {atracacoes.length ? <Badge tone="slate">{atracacoes.length} atracações</Badge> : null}
                        </div>
                        {row.divergences.length ? <EscalaDivergenceWarning divergences={row.divergences} /> : null}
                      </td>
                      <td className="px-3 py-2 align-top text-center">
                        <EscalaOperationMarkers row={row} />
                      </td>
                      <td className="px-3 py-2 text-center text-[var(--app-muted)]">{formatDate(row.eta)}</td>
                      <td className="px-3 py-2 text-center">{formatDate(row.ata)}</td>
                      <td className="px-3 py-2 text-center">{formatDate(row.atd)}</td>
                      <td className="px-3 py-2 text-center">{renderCeStatusLabel(row.ceStatus)}</td>
                      <td className="px-3 py-2 text-center">{renderEscalaNumber(row.escalaNumber)}</td>
                      <td className="px-3 py-2 text-center"><Badge tone={row.linked ? 'green' : 'slate'}>{renderLinkedLabel(row.linked)}</Badge></td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {canEditVoyages ? (
                            <Button
                              variant="secondary"
                              className="app-voyage-icon-btn"
                              aria-label={`Editar planejamento da escala ${row.port}`}
                              onClick={() => onEditEscala(buildEscalaModalData(row))}
                            >
                              <Pencil size={15} />
                            </Button>
                          ) : null}
                          {canEditVoyages && row.temImportacao && !row.omitted ? (
                            <Button
                              variant="secondary"
                              className="app-voyage-icon-btn"
                              aria-label={`Omitir escala do POD ${row.port}`}
                              title={`Omitir escala do POD ${row.port}`}
                              onClick={() => onOmitPod(row.port)}
                            >
                              <AlertTriangle size={15} />
                            </Button>
                          ) : null}
                          {isAdmin ? (
                            // handleDeleteEscala pode chamar deleteVoyageExportSchedule,
                            // cuja policy de DELETE exige is_admin() (091). Nao trocar
                            // por canEditVoyages sem tambem alinhar a RLS.
                            <Button
                              variant="danger"
                              className="app-voyage-icon-btn"
                              aria-label={`Excluir escala ${row.port}`}
                              onClick={() => handleDeleteEscala(row)}
                            >
                              <Trash2 size={15} />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {atracacoes.length && !collapsedAtracacoes.has(row.port) ? (
                      <tr key={`${voyage.id}-atracacoes-${row.port}`} id={`${voyage.id}-atracacoes-${row.port}`}>
                        <td colSpan={9} className="px-3 pb-3 pt-0 text-center">
                          <div className="ml-4 overflow-hidden rounded-[10px] border border-[var(--app-border-strong)] bg-[var(--app-surface)] text-xs">
                            <div className="flex items-center justify-between gap-3 border-b border-[var(--app-border)] bg-[var(--app-surface-muted)] px-3 py-2 text-left">
                              <div className="font-semibold uppercase tracking-wide text-[var(--app-muted)]">Atracações de {row.port}</div>
                              {canEditVoyages ? (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  className="app-btn--sm"
                                  aria-label={`Adicionar atracação na escala ${row.port}`}
                                  onClick={() => onEditEscala(buildEscalaModalData(row, null))}
                                >
                                  <Plus size={13} />
                                  Adicionar atracação
                                </Button>
                              ) : null}
                            </div>
                            <table className="app-table app-table--dense app-voyage-atracacoes-table w-full text-center" aria-label={`Atracações de ${row.port}`}>
                              <thead>
                                <tr>
                                  <th scope="col" className="px-3 py-2 text-center">Terminal</th>
                                  <th scope="col" className="px-3 py-2 text-center">ETB</th>
                                  <th scope="col" className="px-3 py-2 text-center">ATB</th>
                                  <th scope="col" className="px-3 py-2 text-center">ETD</th>
                                  <th scope="col" className="px-3 py-2 text-center">ATD</th>
                                  <th scope="col" className="px-3 py-2 text-center">Restow</th>
                                  <th scope="col" className="px-3 py-2 text-center"><span className="sr-only">Ações</span></th>
                                </tr>
                              </thead>
                              <tbody>
                                {atracacoes.map((atracacao, index) => (
                                  <tr key={`${atracacao.terminalId ?? 'tbc'}-${index}`}>
                                    <td className="px-3 py-2 text-center"><span className="rounded-full bg-[var(--app-surface-muted)] px-2 py-1 font-medium text-[var(--app-text-strong)]">{atracacao.terminalCode ?? 'TBC'}</span></td>
                                    <td className="px-3 py-2 text-center text-[var(--app-muted)]">{formatDate(atracacao.etb)}</td>
                                    <td className="px-3 py-2 text-center">{formatDate(atracacao.atb)}</td>
                                    <td className="px-3 py-2 text-center text-[var(--app-muted)]">{formatDate(atracacao.etd)}</td>
                                    <td className="px-3 py-2 text-center">{formatDate(atracacao.atd)}</td>
                                    <td className="px-3 py-2 text-center font-mono text-xs">{atracacao.rtw ?? '—'}</td>
                                    <td className="px-3 py-2 text-center">
                                      {canEditVoyages ? (
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          className="app-table__icon-button app-table__icon-button--sm"
                                          aria-label={`Editar atracação ${atracacao.terminalCode ?? atracacao.terminalId ?? 'TBC'} da escala ${row.port}`}
                                          onClick={() => onEditEscala(buildEscalaModalData(row, atracacao.terminalId))}
                                        >
                                          <Pencil size={14} />
                                        </Button>
                                      ) : null}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    </Fragment>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={9} className="px-3 py-3 text-center text-[var(--app-muted)]">
                    Nenhuma escala planejada para esta viagem.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MetricSection>
  )

  return (
    <div className="grid gap-4">
      <TransshipmentInfoCard voyageId={voyage.id} />
      {planningContent}
      <VoyageTimeline events={timelineEvents} open={timelineOpen} onToggle={() => setTimelineOpen((value) => !value)} />
    </div>
  )
}

function EscalaOperationMarkers({ row }: { row: VoyageEscalaSchedule }) {
  const markers = [
    row.temImportacao ? <Badge key="importacao" tone="blue">Importação</Badge> : null,
    row.temExportacao ? <Badge key="exportacao" tone="yellow">Exportação</Badge> : null,
    // ponytail: coluna "Opera" mostra só a natureza da operação (imp/exp);
    // granito é modalidade de carga da exportação, não uma operação à parte.
  ].filter(Boolean)

  if (!markers.length) return <span className="text-[var(--app-muted-soft)]">-</span>

  return <div className="flex max-w-[220px] flex-wrap items-center gap-1.5">{markers}</div>
}

function EscalaDivergenceWarning({ divergences }: { divergences: VoyageEscalaDivergence[] }) {
  return (
    <div className="mt-1 flex flex-wrap justify-center gap-1.5">
      {divergences.map((divergence, index) => (
        (() => {
          const field = formatDivergenceField(divergence.field)
          const fullMessage = `Divergência ${field}: POD ${formatDivergenceValue(divergence.podValue)} / ${divergence.source === 'pol' ? 'POL' : 'EXP'} ${formatDivergenceValue(divergence.sourceValue)}`
          return (
            <span key={`${divergence.field}-${divergence.source}-${index}`} className="app-badge app-badge--yellow !text-[var(--app-gold-strong)] gap-1" title={fullMessage}>
              <AlertTriangle size={12} aria-hidden="true" />
              {field} divergente
            </span>
          )
        })()
      ))}
    </div>
  )
}

function formatDivergenceField(field: VoyageEscalaDivergence['field']) {
  if (field === 'ceStatus') return 'CEs'
  if (field === 'linked') return 'VINCULADA'
  if (field === 'escalaNumber') return 'Nº Escala'
  return field.toUpperCase()
}

function formatDivergenceValue(value: VoyageEscalaDivergence['podValue'] | VoyageEscalaDivergence['sourceValue']) {
  if (value === null || value === '') return '-'
  if (typeof value === 'boolean') return value ? 'SIM' : 'NÃO'
  return String(value)
}

const TIMELINE_DOT: Record<VoyageTimelineEvent['kind'], string> = {
  import: '#2a9d63',
  'baplie-import': '#0f766e',
  'escala-date': '#1d4d88',
  'escala-terminal': '#0e7490',
  'escala-number': '#b8860b',
  'manifestos-linked': '#2563a8',
  'ce-status': '#7c3aed',
  restow: '#d97706',
  'pod-added': '#2a9d63',
  'divergence-resolved': '#1f7a4d',
  'divergence-opened': '#b45309',
  'pod-removed': '#cf4b3f',
  'voyage-completed': '#1f7a4d',
  'ce-master': '#5b5fc7',
  'voyage-data': '#64748b',
  'ce-coverage': '#15803d',
  omission: '#dc2626',
  'transshipment-info': '#0f766e',
}

function formatTimelineMoment(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return formatDate(value)
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const TIMELINE_COLLAPSED_COUNT = 3

function VoyageTimeline({
  events,
  open,
  onToggle,
}: {
  events: VoyageTimelineEvent[]
  open: boolean
  onToggle: () => void
}) {
  // Eventos chegam ordenados do mais recente para o mais antigo (buildVoyageTimeline).
  const [expanded, setExpanded] = useState(false)
  const hasMore = events.length > TIMELINE_COLLAPSED_COUNT
  const visibleEvents = expanded ? events : events.slice(0, TIMELINE_COLLAPSED_COUNT)

  return (
    <section className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--app-muted)]">
          <Clock size={16} />
          Linha do tempo
        </span>
        {open ? (
          <ChevronUp size={18} className="text-[var(--app-muted)]" />
        ) : (
          <ChevronDown size={18} className="text-[var(--app-muted)]" />
        )}
      </button>
      {open ? (
        events.length ? (
          <>
            <ol className="mt-4 flex flex-col gap-2">
              {visibleEvents.map((event) => (
                <li
                  key={event.id}
                  className="relative flex flex-col gap-0.5 overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-3 pl-4 sm:flex-row sm:items-baseline sm:gap-3"
                >
                  <span
                    className="absolute left-0 top-0 h-full w-1"
                    style={{ backgroundColor: TIMELINE_DOT[event.kind] }}
                  />
                  <div className="shrink-0 text-xs text-[var(--app-muted-soft)] sm:w-36">
                    {formatTimelineMoment(event.at)}
                  </div>
                  <div className="flex flex-1 flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-semibold text-[var(--app-text)]">{event.title}</span>
                    <span className="text-sm leading-snug text-[var(--app-muted)]">{event.detail}</span>
                  </div>
                </li>
              ))}
            </ol>
            {hasMore ? (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="mt-3 text-sm font-medium text-[var(--app-link)] hover:underline"
              >
                {expanded ? 'Mostrar menos' : `Mostrar todos os ${events.length} eventos`}
              </button>
            ) : null}
          </>
        ) : (
          <div className="mt-3 text-sm text-[var(--app-muted)]">Sem eventos registrados ainda.</div>
        )
      ) : null}
    </section>
  )
}
