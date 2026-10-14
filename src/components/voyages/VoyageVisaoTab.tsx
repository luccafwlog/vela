import { Fragment, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { Button } from '../ui/Button'
import { Block } from '../ui/Block'
import { StatusText } from '../ui/StatusText'
import { NoValue } from '../ui/NoValue'
import { useToast } from '../ui/Toast'
import { useConfirmWithReason } from '../ui/ConfirmDialog'
import { useAuth } from '../../hooks/useAuth'
import { useVoyageTimeline } from '../../hooks/useVoyageTimeline'
import { formatDate } from '../../lib/utils'
import { classifyDbError } from '../../lib/errors'
import { atracacaoEditLabel, normalizePortName } from '../../lib/voyageFormat'
import { normalizePortCode } from '../../services/portCode'
import {
  buildVoyageTimeline,
  groupBlsByRoute,
  type VoyageTimelineEvent,
} from '../../services/voyageSummaries'
import { deleteEscala, type VoyageEscalaDivergence, type VoyageEscalaSchedule } from '../../services/voyageRouteSchedules'
import type { VoyageExportSchedule } from '../../services/voyageExportSchedules'
import { listVaziosExportEmbarkPorts } from '../../services/vaziosExportOperations'
import { queryKeys } from '../../services/queryKeys'
import { afterEscalaAlterada } from '../../services/cacheEffects'
import {
  renderCeStatusLabel,
  renderEscalaNumber,
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
  divergenceCount,
  ceCoverage,
  canEdit = true,
  onEditEscala,
  onOmitPod,
}: {
  voyage: Voyage
  voyageLabel: string
  escalaRows: VoyageEscalaSchedule[]
  importBatches: VoyageImportBatch[]
  exportSchedules: VoyageExportSchedule[]
  divergenceCount: number
  ceCoverage: { filled: number; total: number }
  canEdit?: boolean
  onEditEscala: (payload: EscalaModalData) => void
  onOmitPod: (pod: string) => void
}) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirmWithReason = useConfirmWithReason()
  const { user, profile, isAdmin } = useAuth()
  const canEditVoyages = canEdit && Boolean(profile || user)
  const [timelineOpen, setTimelineOpen] = useState(true)
  // A seta no começo da linha abre as atracações; fechadas por padrão.
  const [openAtracacoes, setOpenAtracacoes] = useState<Set<string>>(() => new Set())

  function toggleAtracacoes(port: string) {
    setOpenAtracacoes((current) => {
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
      exportCeStatus: row?.exportCeStatus ?? exportSchedule?.ceStatus ?? null,
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
      rowActions: row ? {
        omit: canEditVoyages && row.temImportacao && !row.omitted ? () => onOmitPod(row.port) : undefined,
        // Excluir escala é do Administrativo e respeita a trava do CE
        // (delete_escala, migration 088; ADR 0071).
        remove: canEdit && isAdmin ? () => void handleDeleteEscala(row) : undefined,
      } : undefined,
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
    try {
      const preview = await deleteEscala(voyage.id, row.port, { dryRun: true })
      if (preview.reasons.length > 0) {
        showToast(`Não é possível excluir a escala ${row.port}: ${preview.reasons.join(', ')}. Corrija a escala ou omita.`, 'error')
        return
      }
      const reason = await confirmWithReason({
        title: 'Excluir escala do planejamento',
        message: `Excluir a escala ${row.port}?`,
        affected: preview.scope ? {
          summary: 'Vão junto com a escala:',
          items: [
            `${preview.scope.terminals} atracação(ões)`,
            `${preview.scope.export_schedules} escala(s) de exportação`,
            `${preview.scope.open_departure_reports} ADR(s) de Saída em aberto`,
          ],
        } : undefined,
        consequence: 'As datas, o vínculo operacional, as atracações e o planejamento de exportação desta escala saem da viagem, do Line-Up e da Programação no Portal.',
        reversibility: 'Adicione a escala de novo se precisar; o registro fica na auditoria.',
        confirmLabel: 'Excluir',
        tone: 'danger',
      })
      if (reason === null) return
      const result = await deleteEscala(voyage.id, row.port, { reason })
      if (!result.deleted) {
        showToast(`A escala não foi excluída: ${result.reasons.join(', ')}.`, 'error')
        return
      }
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
    <Block
      title="Planejamento por escala"
      headingLevel={3}
      flush
      aside={(
        <>
          <span>{escalaRows.length === 1 ? '1 escala' : `${escalaRows.length} escalas`}</span>
          {canEditVoyages ? (
            <Button variant="secondary" className="app-btn--sm" onClick={() => onEditEscala(buildEscalaModalData(null))}>
              <Plus size={15} aria-hidden="true" />
              Adicionar escala
            </Button>
          ) : null}
        </>
      )}
    >
      <div className="app-table-scroll">
        <table className="app-table app-table--compact w-full" aria-label="Planejamento por escala">
          <thead>
            <tr>
              <th scope="col" className="app-table__text-head">Porto</th>
              <th scope="col" className="app-table__text-head">Opera</th>
              <th scope="col">ETA</th>
              <th scope="col">ATA</th>
              <th scope="col">ATD</th>
              <th scope="col">CE Mercante</th>
              <th scope="col">Nº Escala</th>
              <th scope="col">Vinculada</th>
              <th scope="col"><span className="sr-only">Ações</span></th>
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
                const isOpen = openAtracacoes.has(row.port)
                const panelId = `${voyage.id}-atracacoes-${row.port}`
                return (
                  <Fragment key={`${voyage.id}-scale-${row.port}`}>
                    <tr>
                      <td className="app-table__text">
                        <span className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            className="app-table__icon-button"
                            aria-controls={panelId}
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? 'Recolher' : 'Expandir'} atracações de ${row.port}`}
                            onClick={() => toggleAtracacoes(row.port)}
                          >
                            {isOpen ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                          </button>
                          <strong>{row.port}</strong>
                          {row.omitted ? <StatusText tone="warning">Omitida</StatusText> : null}
                        </span>
                        {row.divergences.length ? <EscalaDivergenceWarning divergences={row.divergences} /> : null}
                      </td>
                      <td className="app-table__text">{escalaOperationText(row) ?? <NoValue label="Sem operação declarada" />}</td>
                      <td className="tabular-nums">{row.eta ? formatDate(row.eta) : <NoValue label="Sem ETA" />}</td>
                      <td className="tabular-nums">{row.ata ? formatDate(row.ata) : <NoValue label="Sem ATA" />}</td>
                      <td className="tabular-nums">{row.atd ? formatDate(row.atd) : <NoValue label="Sem ATD" />}</td>
                      <td><StatusText tone={row.ceStatus === 'approved' ? 'default' : 'warning'}>{renderCeStatusLabel(row.ceStatus)}</StatusText></td>
                      <td>{row.escalaNumber ? renderEscalaNumber(row.escalaNumber) : <NoValue label="Sem Nº Escala" />}</td>
                      <td>{row.linked ? 'Sim' : 'Não'}</td>
                      <td>
                        {canEditVoyages ? (
                          <Button
                            variant="secondary"
                            className="app-btn--sm"
                            aria-label={`Editar planejamento da escala ${row.port}`}
                            onClick={() => onEditEscala(buildEscalaModalData(row))}
                          >
                            Editar
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr id={panelId} data-row-detail>
                        <td colSpan={9}>
                          {atracacoes.length ? (
                            <table className="app-table app-table--dense w-auto" aria-label={`Atracações de ${row.port}`}>
                              <thead>
                                <tr>
                                  <th scope="col" className="app-table__text-head">Terminal</th>
                                  <th scope="col">ETB</th>
                                  <th scope="col">ATB</th>
                                  <th scope="col">ETD</th>
                                  <th scope="col">ATD</th>
                                  <th scope="col">Restow</th>
                                  <th scope="col"><span className="sr-only">Ações</span></th>
                                </tr>
                              </thead>
                              <tbody>
                                {atracacoes.map((atracacao, index) => (
                                  <tr key={`${atracacao.terminalId ?? 'tbc'}-${index}`}>
                                    <td className="app-table__text">{atracacao.terminalCode ?? 'TBC'}</td>
                                    <td className="tabular-nums">{atracacao.etb ? formatDate(atracacao.etb) : <NoValue label="Sem ETB" />}</td>
                                    <td className="tabular-nums">{atracacao.atb ? formatDate(atracacao.atb) : <NoValue label="Sem ATB" />}</td>
                                    <td className="tabular-nums">{atracacao.etd ? formatDate(atracacao.etd) : <NoValue label="Sem ETD" />}</td>
                                    <td className="tabular-nums">{atracacao.atd ? formatDate(atracacao.atd) : <NoValue label="Sem ATD" />}</td>
                                    <td className="tabular-nums">{atracacao.rtw ?? <NoValue label="Sem restow" />}</td>
                                    <td>
                                      {canEditVoyages ? (
                                        <Button
                                          type="button"
                                          variant="secondary"
                                          className="app-btn--sm"
                                          aria-label={atracacaoEditLabel(atracacao, row.port)}
                                          onClick={() => onEditEscala(buildEscalaModalData(row, atracacao.terminalId))}
                                        >
                                          Editar
                                        </Button>
                                      ) : null}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="app-facts__detail">Sem atracação em {row.port}.</p>
                          )}
                          {canEditVoyages ? (
                            <Button
                              type="button"
                              variant="ghost"
                              className="app-btn--sm mt-2"
                              aria-label={`Adicionar atracação na escala ${row.port}`}
                              onClick={() => onEditEscala(buildEscalaModalData(row, null))}
                            >
                              <Plus size={13} aria-hidden="true" />
                              Adicionar atracação
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })
            ) : (
              <tr>
                <td colSpan={9}>Nenhuma escala planejada para esta viagem.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Block>
  )

  return (
    <div className="grid gap-4">
      <TransshipmentInfoCard voyageId={voyage.id} />
      {planningContent}
      <VoyageTimeline events={timelineEvents} open={timelineOpen} onToggle={() => setTimelineOpen((value) => !value)} />
    </div>
  )
}

// ponytail: coluna "Opera" mostra só a natureza da operação (imp/exp);
// granito é modalidade de carga da exportação, não uma operação à parte.
function escalaOperationText(row: VoyageEscalaSchedule) {
  const parts = [row.temImportacao ? 'Importação' : null, row.temExportacao ? 'Exportação' : null].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
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
    <Block
      title="Linha do tempo"
      headingLevel={3}
      flush
      aside={(
        <>
          <span>{events.length === 1 ? '1 evento' : `${events.length} eventos`}</span>
          <Button variant="secondary" className="app-btn--sm" aria-expanded={open} onClick={onToggle}>
            {open ? 'Recolher' : 'Mostrar'}
          </Button>
        </>
      )}
    >
      {open ? (
        events.length ? (
          <>
            <div className="app-table-scroll">
              <table className="app-table app-table--compact w-full" aria-label="Linha do tempo da viagem">
                <thead>
                  <tr>
                    <th scope="col">Quando</th>
                    <th scope="col" className="app-table__text-head">Evento</th>
                    <th scope="col" className="app-table__text-head">Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEvents.map((event) => {
                    const { text, author } = splitTimelineAuthor(event.detail)
                    return (
                      <tr key={event.id}>
                        <td className="whitespace-nowrap tabular-nums">{formatTimelineMoment(event.at)}</td>
                        <td className="app-table__text whitespace-nowrap"><strong>{event.title}</strong></td>
                        <td className="app-table__text app-table__text--wrap !min-w-[18rem]">
                          {text}
                          {author ? <span className="app-facts__detail block">{author}</span> : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {hasMore ? (
              <div className="app-block__body">
                <Button variant="secondary" className="app-btn--sm w-fit" onClick={() => setExpanded((value) => !value)}>
                  {expanded ? 'Mostrar menos' : `Mostrar todos os ${events.length} eventos`}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="app-block__body app-facts__detail">Sem eventos registrados ainda.</p>
        )
      ) : null}
    </Block>
  )
}

/** "… · por Ana Ribeiro (Administrativo)" → texto e autor em linhas separadas. */
function splitTimelineAuthor(detail: string) {
  const match = /^(.*?)(?: · )?(por [^·]+)$/.exec(detail ?? '')
  if (!match) return { text: detail, author: null }
  return { text: match[1], author: match[2] }
}
