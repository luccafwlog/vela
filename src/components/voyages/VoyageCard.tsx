import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Block, Fact, FactList, LeadValue } from '../ui/Block'
import { IdentityBand } from '../ui/IdentityBand'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { useAuth } from '../../hooks/useAuth'
import { useVoyageReconciliation } from '../../hooks/useVoyageReconciliation'
import { useClosedAgencyReportPorts } from '../../hooks/useAgencyReport'
import { useManifestosMercanteByVoyage } from '../../hooks/useManifestosMercante'
import type { VoyageVehicleStat } from '../../hooks/useVehicles'
import type { VoyageVaziosImportacaoStat } from '../../hooks/useVaziosImportacaoStats'
import { countDistinctContainerNumbers, countDistinctContainerNumbersBy } from '../../lib/containerCounts'
import { formatDate } from '../../lib/utils'
import {
  collectVoyagePorts,
  computeAdrEscalaPods,
  countPlannedPodRows,
  deriveEstadoConciliacao,
  getBlsAffectedByOmittedPod,
  getProximaEscala,
  isEtaOverdue,
  summarizeExportByEmbarkPort,
  splitVoyageBls,
  summarizeBreakbulk,
  voyageCeCoverage,
} from '../../services/voyageSummaries'
import { formatMetric, normalizePortName } from '../../lib/voyageFormat'
import { normalizePortCode } from '../../services/portCode'
import {
  type VoyageEscalaSchedule,
  type VoyagePolSchedule,
} from '../../services/voyageRouteSchedules'
import type { VoyageExportSchedule } from '../../services/voyageExportSchedules'
import { ESTADO_CONCILIACAO_META, statusLabel, VOYAGE_STATUS_BADGE_TONE, VOYAGE_STATUS_LABELS } from '../../lib/statusLabels'
import { TabButton } from '../ui/TabButton'
import { TabList } from '../ui/TabList'
import { buildVoyageRouteLegs, collectVoyageManifestBatchRows, countRouteManifestNumbers, type VoyageImportBatch } from './voyageCardHelpers'
import { VoyageVisaoTab } from './VoyageVisaoTab'
import { VoyageImportacaoTab } from './VoyageImportacaoTab'
import { VoyageExportacaoTab } from './VoyageExportacaoTab'
import { VoyageManifestosTab } from './VoyageManifestosTab'
import { VoyageAgencyReportTab } from './VoyageAgencyReportTab'
import { OmitEscalaModal } from './OmitEscalaModal'
import type {
  EditingPolPayload,
  Voyage,
  VoyagePodRow,
} from './voyageCardTypes'
import type { EscalaModalData } from '../shared/VoyageScheduleModals'

export type {
  Voyage,
  EditingPolPayload,
} from './voyageCardTypes'

export type VoyageTabKey = 'visao' | 'importacao' | 'exportacao' | 'manifestos' | 'adr'

/** "20DC (14) | 40HC (10)" → "20DC 14, 40HC 10". */
function formatContainerTypes(types: string) {
  return types.split(' | ').filter(Boolean).map((entry) => entry.replace(/\s*\((\d+)\)$/, ' $1')).join(', ')
}

function routeText(leg: { originPorts: string[]; destinationPorts: string[] } | null | undefined) {
  if (!leg) return null
  return `${leg.originPorts.join(', ') || 'Origem a definir'} → ${leg.destinationPorts.join(', ') || 'Destino a definir'}`
}

const DEFAULT_VEHICLE_STATS: VoyageVehicleStat = {
  totalVehicles: 0,
  distinctContainerCount: 0,
  containerNumbers: [],
  brandSummary: '-',
  vehicleByContainerTypeSummary: '-',
  byPod: {},
}

const DEFAULT_VAZIOS_IMP_STATS: VoyageVaziosImportacaoStat = {
  totalManifests: 0,
  distinctContainers: 0,
  containerTypes: '',
  destinations: '',
  byPod: {},
}

type VoyageCardProps = {
  voyage: Voyage
  vehicleStats: VoyageVehicleStat | undefined
  vaziosImpStats: VoyageVaziosImportacaoStat | undefined
  voyagesWithUnpaidBls: Set<number> | null | undefined
  polSchedules: Map<string, VoyagePolSchedule> | undefined
  routeCeMasters: Map<string, string> | undefined
  scheduledEscalaRows: VoyageEscalaSchedule[]
  exportSchedules: VoyageExportSchedule[]
  onEditVoyage: (voyageId: number) => void
  onDeleteVoyage: (voyageId: number) => void
  onCancelVoyage: (voyageId: number) => void
  onReactivateVoyage?: (voyageId: number) => void
  onEditEscala: (payload: EscalaModalData) => void
  onEditPol: (payload: EditingPolPayload) => void
  initialTab?: VoyageTabKey
  /** Aba controlada pela URL (`?tab=`); sem ela, o card guarda a aba localmente. */
  activeTab?: VoyageTabKey
  onTabChange?: (tab: VoyageTabKey) => void
  initialEscala?: string
  initialReportId?: string
  initialTerminalCode?: string
}

export function VoyageCard({
  voyage,
  vehicleStats: vehicleStatsProp,
  vaziosImpStats: vaziosImpStatsProp,
  voyagesWithUnpaidBls,
  polSchedules,
  routeCeMasters,
  scheduledEscalaRows,
  exportSchedules,
  onEditVoyage,
  onDeleteVoyage,
  onCancelVoyage,
  onReactivateVoyage,
  onEditEscala,
  onEditPol,
  initialTab = 'visao',
  activeTab: controlledActiveTab,
  onTabChange,
  initialEscala,
  initialReportId,
  initialTerminalCode,
}: VoyageCardProps) {
  const [localActiveTab, setLocalActiveTab] = useState<VoyageTabKey>(initialTab)
  const activeTab = controlledActiveTab ?? localActiveTab
  const [omitTarget, setOmitTarget] = useState<string | null>(null)
  const { isAdmin, user, profile } = useAuth()
  const isCancelled = voyage.status === 'cancelled'
  const canEditVoyages = !isCancelled && Boolean(profile || user)
  const canDeleteVoyage = !isCancelled && isAdmin
  // Cancelar e Reativar viagem sao do Administrativo (ADR 0071; migration 089).
  const canReactivateVoyage = isCancelled && isAdmin && Boolean(onReactivateVoyage)

  const vehicleStats = vehicleStatsProp ?? DEFAULT_VEHICLE_STATS
  const vaziosImpStats = vaziosImpStatsProp ?? DEFAULT_VAZIOS_IMP_STATS
  const voyageLabel = `${voyage.vessel?.name ?? 'Navio'} / ${voyage.voyage_number}`

  const { containerBls } = splitVoyageBls(voyage.bls)
  const importBatches = useMemo<VoyageImportBatch[]>(() => voyage.import_batches ?? [], [voyage.import_batches])
  // Contagem por rota (par POL/POD), não por arquivo de manifesto (#315): viagens
  // só-B/L não têm batch, e dois arquivos da mesma rota são uma rota só.
  const totalBls = (voyage.bls ?? []).length
  const billingClosed = totalBls > 0 && voyagesWithUnpaidBls != null && !voyagesWithUnpaidBls.has(voyage.id)
  const flatContainers = containerBls.flatMap((bl) => bl.bl_containers ?? [])
  const totalContainers = countDistinctContainerNumbers(flatContainers)
  const totalImoContainers = countDistinctContainerNumbersBy(flatContainers, (container) => Boolean(container.is_imo))
  const totalOogContainers = countDistinctContainerNumbersBy(flatContainers, (container) => Boolean(container.is_oog))
  const totalImportVehicles = vehicleStats.totalVehicles
  const breakbulkSummary = summarizeBreakbulk(voyage.bls)
  const exportSummary = summarizeExportByEmbarkPort(voyage.granite_manifests, voyage.vazios_manifests)
  // Mesma fonte da aba Exportação (`summarizeExportByEmbarkPort`): contar
  // `vazios_manifests.total_bookings` aqui fazia o KPI divergir da faixa
  // "Vazios embarcados" da aba sempre que o agregado do manifesto ficava
  // defasado em relação aos bookings realmente carregados.
  const totalExportContainers = exportSummary.reduce((sum, embarkPort) => sum + embarkPort.vazios.units, 0)
  const totalVaziosManifests = (voyage.vazios_manifests ?? []).length
  const totalGraniteBls = exportSummary.reduce((sum, embarkPort) => sum + embarkPort.granite.bls, 0)
  const totalGraniteWeightTon = exportSummary.reduce((sum, embarkPort) => sum + embarkPort.granite.weightTon, 0)
  const destinationPorts = collectVoyagePorts(
    voyage.bls,
    'pod',
    null,
    scheduledEscalaRows,
  )
  const { importLeg, exportLeg } = buildVoyageRouteLegs({
    bls: voyage.bls,
    fallbackPol: voyage.pol?.name ?? null,
    escalas: scheduledEscalaRows,
    exportDischargePorts: (voyage.granite_manifests ?? []).map((manifest) => manifest.discharge_port),
  })
  const manifestRows = useMemo(
    () => collectVoyageManifestBatchRows({
      voyageId: voyage.id,
      batches: importBatches,
      bls: voyage.bls,
      polSchedules,
      routeCeMasters,
      vaziosRoutes: vaziosImpStats?.routes,
    }),
    [importBatches, polSchedules, routeCeMasters, vaziosImpStats?.routes, voyage.bls, voyage.id],
  )
  const blCountByPod = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of manifestRows) {
      const podKey = normalizePortCode(row.pod) ?? normalizePortName(row.pod)
      counts.set(podKey, (counts.get(podKey) ?? 0) + row.blCount)
    }
    return counts
  }, [manifestRows])
  const escalasByPort = new Map(scheduledEscalaRows.map((schedule) => [normalizePortCode(schedule.port) ?? normalizePortName(schedule.port), schedule]))
  const podRows: VoyagePodRow[] = destinationPorts.map((pod) => {
    const schedule = escalasByPort.get(normalizePortCode(pod) ?? normalizePortName(pod))
    return {
      pod: schedule?.port ?? pod,
      blCount: blCountByPod.get(normalizePortCode(pod) ?? normalizePortName(pod)) ?? 0,
      eta: schedule?.eta ?? null,
      etb: schedule?.atracacoes[0]?.etb ?? null,
      ata: schedule?.ata ?? null,
      atb: schedule?.atracacoes[0]?.atb ?? null,
      etd: schedule?.atracacoes.reduce<string | null>((latest, atracacao) => (
        latest === null || (atracacao.etd ?? '') > latest ? atracacao.etd ?? latest : latest
      ), null) ?? null,
      atd: schedule?.atd ?? null,
      rtw: schedule?.atracacoes.reduce((total, atracacao) => total + (atracacao.rtw ?? 0), 0) || null,
      ceStatus: schedule?.ceStatus ?? 'waiting',
      linked: schedule?.linked ?? false,
      escalaNumber: schedule?.escalaNumber ?? null,
      omitted: schedule?.omitted ?? false,
    }
  })
  const activePods = podRows.filter((row) => !row.omitted).map((row) => row.pod)
  const planningEscalaRows = (() => {
    const knownPorts = new Set(scheduledEscalaRows.map((row) => normalizePortCode(row.port) ?? normalizePortName(row.port)))
    const blOnlyRows: VoyageEscalaSchedule[] = destinationPorts
      .filter((port) => !knownPorts.has(normalizePortCode(port) ?? normalizePortName(port)))
      .map((port) => ({
        entityId: `${voyage.id}::${port}`,
        voyageId: voyage.id,
        port,
        eta: null,
        ata: null,
        atd: null,
        atracacoes: [],
        ceStatus: null,
        podCeStatus: null,
        exportCeStatus: null,
        linked: null,
        escalaNumber: null,
        omitted: false,
        deleted: false,
        temImportacao: true,
        temExportacao: false,
        temGranito: false,
        containersQty: null,
        movementsQty: null,
        dischargePorts: [],
        divergences: [],
      }))
    return [...scheduledEscalaRows, ...blOnlyRows]
  })()
  const plannedPodCount = countPlannedPodRows(podRows)

  // Escalas do ADR (Task 2 do ADR 2026-07-31): não omitidas + omitidas que já
  // têm ADR fechado (registro imutável, não pode ficar inalcançável). podRows
  // já é recalculado a cada render, então nenhuma memoização adicional é
  // necessária aqui.
  const { data: closedAdrPorts } = useClosedAgencyReportPorts(voyage.id)
  const adrPods = computeAdrEscalaPods(podRows, closedAdrPorts ?? [])

  // Estado de Conciliação: divergências da viagem aberta (uma consulta) +
  // sinais baratos do payload.
  const { data: reconciliation } = useVoyageReconciliation(voyage.id)
  const divergenceCount = reconciliation?.items.length ?? 0
  const ceCoverage = voyageCeCoverage(voyage.bls)
  const { data: dbManifestos } = useManifestosMercanteByVoyage(voyage.id)
  // Mesma contagem da aba Rotas e Manifestos: cada número exibido nela conta,
  // e uma rota pode ter mais de um manifesto. Rota com B/L (ou vazios) ainda
  // sem número segue sinalizada como "a informar".
  const routeManifestCounts = manifestRows.map((row) => ({ row, count: countRouteManifestNumbers(row, dbManifestos) }))
  const manifestNumberCount = routeManifestCounts.reduce((total, entry) => total + entry.count, 0)
  const pendingManifestCount = routeManifestCounts.filter(
    ({ row, count }) => count === 0 && (row.blCount > 0 || row.isVazios),
  ).length
  const proximaEscala = getProximaEscala(podRows)
  const reconciliationState = deriveEstadoConciliacao({
    hasOpenDivergences: divergenceCount > 0,
    ceFilled: ceCoverage.filled,
    ceTotal: ceCoverage.total,
  })
  const reconciliationMeta = ESTADO_CONCILIACAO_META[reconciliationState]

  const tabs: Array<{ key: VoyageTabKey; label: string }> = [
    { key: 'visao', label: 'Visão geral' },
    { key: 'importacao', label: 'Importação' },
    { key: 'exportacao', label: 'Exportação' },
    { key: 'manifestos', label: 'Rotas e Manifestos' },
    { key: 'adr', label: 'ADR' },
  ]
  const omitAffectedBls = useMemo(() => {
    if (!omitTarget) return []
    return getBlsAffectedByOmittedPod(voyage.bls, omitTarget)
  }, [omitTarget, voyage.bls])

  return (
    <Card className="app-voyage-ficha p-0">
      <IdentityBand
        headingLevel={2}
        kind={`Viagem · ${voyage.vessel?.carrier?.name ?? 'Armador não informado'}`}
        title={`${voyage.vessel?.name ?? 'Navio'} / ${voyage.voyage_number}`}
        titleAside={(
          <>
            <Badge tone={VOYAGE_STATUS_BADGE_TONE[voyage.status ?? 'active'] ?? 'blue'}>
              {statusLabel(VOYAGE_STATUS_LABELS, voyage.status ?? 'active')}
            </Badge>
            {billingClosed ? (
              <Badge tone="success" title="Todos os B/Ls desta viagem estão quitados ou isentos.">Faturamento encerrado</Badge>
            ) : null}
          </>
        )}
        facts={[
          ...(importLeg ? [{ label: 'Importação', value: routeText(importLeg) }] : []),
          ...(exportLeg ? [{ label: 'Exportação', value: routeText(exportLeg) }] : []),
          { label: 'B/Ls de importação', value: formatMetric(totalBls) },
        ]}
        actions={canReactivateVoyage || canEditVoyages || canDeleteVoyage ? (
          <>
            {canReactivateVoyage ? (
              <Button variant="ghost" onClick={() => onReactivateVoyage?.(voyage.id)}>Reativar viagem</Button>
            ) : null}
            {canEditVoyages ? <Button variant="ghost" onClick={() => onEditVoyage(voyage.id)}>Editar</Button> : null}
            {canEditVoyages && isAdmin ? (
              <Button variant="danger" onClick={() => onCancelVoyage(voyage.id)}>Cancelar viagem</Button>
            ) : null}
            {canDeleteVoyage ? (
              // Excluir viagem é do Administrativo: delete_records('voyage')
              // exige is_admin() e respeita a trava do CE (ADR 0071).
              <Button variant="danger" onClick={() => onDeleteVoyage(voyage.id)}>Excluir</Button>
            ) : null}
          </>
        ) : null}
      />

      <div className="app-voyage-ficha__body">
        <section className="app-voyage-kpi-grid" aria-label="Indicadores da viagem">
          <Block title="Contêineres" aside="Importação" headingLevel={3}>
            <LeadValue>
              {formatMetric(totalContainers)} <span className="app-lead__unit">cheios, distintos</span>
            </LeadValue>
            <FactList columns={1}>
              {vaziosImpStats.distinctContainers > 0 ? (
                <Fact label="Vazios a descarregar" detail={vaziosImpStats.containerTypes ? formatContainerTypes(vaziosImpStats.containerTypes) : null}>
                  {formatMetric(vaziosImpStats.distinctContainers)}
                </Fact>
              ) : null}
              <Fact label="B/Ls">{formatMetric(containerBls.length)}</Fact>
              <Fact label="IMO / OOG">{`${totalImoContainers} / ${totalOogContainers}`}</Fact>
              <Fact label="Veículos">{formatMetric(totalImportVehicles)}</Fact>
            </FactList>
          </Block>
          <Block title="Carga solta" aside="Importação" headingLevel={3}>
            <LeadValue>
              {breakbulkSummary.bls > 0 ? (
                <>{formatMetric(Math.round(breakbulkSummary.weightTon * 100) / 100)} <span className="app-lead__unit">toneladas</span></>
              ) : (
                <NoValue label="Sem carga solta" />
              )}
            </LeadValue>
            <FactList columns={1}>
              <Fact label="B/Ls">{formatMetric(breakbulkSummary.bls)}</Fact>
              <Fact label="Máquinas / Packages">{`${formatMetric(breakbulkSummary.machines)} / ${formatMetric(breakbulkSummary.packages)}`}</Fact>
              <Fact label="CBM">{formatMetric(Math.round(breakbulkSummary.cbm * 100) / 100)}</Fact>
            </FactList>
          </Block>
          <Block title="Exportação" headingLevel={3}>
            <LeadValue>
              {formatMetric(totalExportContainers)} <span className="app-lead__unit">vazios embarcados</span>
            </LeadValue>
            <FactList columns={1}>
              <Fact label="Granito · B/Ls">{formatMetric(totalGraniteBls)}</Fact>
              <Fact label="Granito · ton">{formatMetric(totalGraniteWeightTon)}</Fact>
              <Fact label="Embarques de vazios">{formatMetric(totalVaziosManifests)}</Fact>
            </FactList>
          </Block>
          <Block title="Próxima escala" headingLevel={3}>
            <LeadValue
              tone={proximaEscala && isEtaOverdue(proximaEscala.eta) ? 'warning' : 'default'}
              detail={proximaEscala ? `ETA ${formatDate(proximaEscala.eta)}${isEtaOverdue(proximaEscala.eta) ? ' · vencido' : ''}` : 'Nenhuma escala com ETA a cumprir'}
            >
              {proximaEscala?.pod ?? <NoValue label="Sem próxima escala" />}
            </LeadValue>
            <FactList columns={1}>
              <Fact label="Planejadas">{formatMetric(plannedPodCount)}</Fact>
              <Fact label="Atracação">{proximaEscala?.etb ? `ETB ${formatDate(proximaEscala.etb)}` : <NoValue label="Sem atracação prevista" />}</Fact>
              <Fact label="Status">
                {proximaEscala ? (isEtaOverdue(proximaEscala.eta) ? 'ETA vencido' : 'Pendente') : <NoValue label="Sem escala a cumprir" />}
              </Fact>
            </FactList>
          </Block>
          <Block title="Conciliação" headingLevel={3}>
            <LeadValue tone={reconciliationState === 'divergente' ? 'danger' : reconciliationState === 'conciliado' ? 'default' : 'warning'}>
              {reconciliationMeta.label}
            </LeadValue>
            <FactList columns={1}>
              <Fact label="CE Mercante">{`${ceCoverage.filled}/${ceCoverage.total}`}</Fact>
              <Fact label="Manifestos Mercante">
                {pendingManifestCount > 0 ? (
                  <StatusText tone="warning">{`${manifestNumberCount} · ${pendingManifestCount} a informar`}</StatusText>
                ) : formatMetric(manifestNumberCount)}
              </Fact>
              <Fact label="Divergências EDI × B/Ls">{formatMetric(divergenceCount)}</Fact>
            </FactList>
          </Block>
        </section>

        {/* Abas trocam a vista; atalhos (link com seta) levam a outra página. */}
        <div className="app-voyage-tabs-row">
          <TabList label="Seções da viagem">
            {tabs.map((tab) => (
              <TabButton
                key={tab.key}
                id={`voyage-${voyage.id}-tab-${tab.key}`}
                controls={`voyage-${voyage.id}-panel`}
                label={tab.label}
                active={activeTab === tab.key}
                onClick={() => (onTabChange ? onTabChange(tab.key) : setLocalActiveTab(tab.key))}
              />
            ))}
          </TabList>
          <nav aria-label="Atalhos da viagem" className="app-voyage-shortcuts">
            {reconciliationState === 'divergente' ? (
              <Link to={`/baplie?voyage=${voyage.id}`} className="app-btn app-btn--primary app-btn--sm">
                Resolver divergências ({divergenceCount})
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            ) : (
              <Link to={`/baplie?voyage=${voyage.id}`} className="app-btn app-btn--secondary app-btn--sm">
                Baplie EDI
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            )}
            <Link to={`/bls?voyage=${voyage.id}`} className="app-btn app-btn--secondary app-btn--sm">
              B/Ls da viagem
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
            {totalGraniteBls > 0 ? (
              <Link to={`/granito?voyage=${voyage.id}`} className="app-btn app-btn--secondary app-btn--sm">
                Granito
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            ) : null}
          </nav>
        </div>

        <div
          id={`voyage-${voyage.id}-panel`}
          role="tabpanel"
          aria-labelledby={`voyage-${voyage.id}-tab-${activeTab}`}
          className="grid gap-4"
        >
          {activeTab === 'visao' ? (
            <VoyageVisaoTab
              voyage={voyage}
              voyageLabel={voyageLabel}
              escalaRows={planningEscalaRows}
              importBatches={importBatches}
              exportSchedules={exportSchedules}
              divergenceCount={divergenceCount}
              ceCoverage={ceCoverage}
              canEdit={!isCancelled}
              onEditEscala={onEditEscala}
              onOmitPod={(pod) => setOmitTarget(pod)}
            />
          ) : null}
          {activeTab === 'importacao' ? (
            <VoyageImportacaoTab
              voyage={voyage}
              voyageLabel={voyageLabel}
              vehicleStats={vehicleStats}
              vaziosImpStats={vaziosImpStats}
              userId={isCancelled ? undefined : user?.id}
            />
          ) : null}
          {activeTab === 'exportacao' ? (
            <VoyageExportacaoTab voyage={voyage} voyageLabel={voyageLabel} userId={isCancelled ? undefined : user?.id} />
          ) : null}
          {activeTab === 'manifestos' ? (
            <VoyageManifestosTab
              voyage={voyage}
              voyageLabel={voyageLabel}
              importBatches={importBatches}
              polSchedules={polSchedules}
              routeCeMasters={routeCeMasters}
              ceCoverage={ceCoverage}
              vaziosRoutes={vaziosImpStats?.routes}
              canEdit={!isCancelled}
              onEditPol={onEditPol}
            />
          ) : null}
          {activeTab === 'adr' ? (
            <VoyageAgencyReportTab
              voyageId={voyage.id}
              voyageLabel={voyageLabel}
              carrierName={voyage.vessel?.carrier?.name ?? 'Armador não informado'}
              pods={adrPods}
              initialEscala={initialEscala}
              reportId={initialReportId}
              terminalCode={initialTerminalCode}
              readOnly={isCancelled}
            />
          ) : null}
        </div>
      </div>
      {omitTarget ? (
        <OmitEscalaModal
          open
          onClose={() => setOmitTarget(null)}
          voyageId={voyage.id}
          omittedPod={omitTarget}
          candidateDischargePods={activePods.length > 1 ? activePods.filter((pod) => pod !== omitTarget) : activePods}
          affectedBlNumbers={omitAffectedBls.map((bl) => String(bl.bl_number ?? '').trim() || bl.id)}
        />
      ) : null}
    </Card>
  )
}
