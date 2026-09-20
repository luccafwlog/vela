import { useMemo, useState } from 'react'
import { ArrowRight, Ban, Pencil, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { useAuth } from '../../hooks/useAuth'
import { useVoyageReconciliation } from '../../hooks/useVoyageReconciliation'
import { useClosedAgencyReportPorts } from '../../hooks/useAgencyReport'
import { useManifestosMercanteByVoyage } from '../../hooks/useManifestosMercante'
import type { VoyageVehicleStat } from '../../hooks/useVehicles'
import type { VoyageVaziosImportacaoStat } from '../../hooks/useVaziosImportacaoStats'
import { countDistinctContainerNumbers, countDistinctContainerNumbersBy } from '../../lib/containerCounts'
import { calculateTeu } from '../../services/containerTeu'
import { formatDate } from '../../lib/utils'
import {
  collectVoyagePorts,
  computeAdrEscalaPods,
  countPlannedPodRows,
  deriveEstadoConciliacao,
  getProximaEscala,
  isEtaOverdue,
  summarizeExportByEmbarkPort,
  splitVoyageBls,
  voyageCeCoverage,
} from '../../services/voyageSummaries'
import { formatMetric, normalizePortName } from '../../lib/voyageFormat'
import { normalizePortCode } from '../../services/portCode'
import {
  deriveAutomaticVoyagePodCeStatus,
  type VoyageEscalaSchedule,
  type VoyagePolSchedule,
} from '../../services/voyageRouteSchedules'
import type { VoyageExportSchedule } from '../../services/voyageExportSchedules'
import { ESTADO_CONCILIACAO_META, statusLabel, VOYAGE_STATUS_BADGE_TONE, VOYAGE_STATUS_LABELS } from '../../lib/statusLabels'
import { TabButton } from '../ui/TabButton'
import { buildVoyageRouteLegs, collectVoyageManifestBatchRows, type VoyageImportBatch } from './voyageCardHelpers'
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

function DirectionKpiTile({
  direction,
  tone,
  primary,
  metrics,
}: {
  direction: string
  tone: 'blue' | 'green' | 'yellow' | 'red' | 'slate'
  primary: { value: string; unit?: string; color?: string; variant?: 'number' | 'text' }
  metrics: Array<{ label: string; value: string }>
}) {
  return (
    <div className="app-voyage-kpi-tile">
      <Badge tone={tone}>{direction}</Badge>
      <div className="app-voyage-kpi-tile__primary">
        <span
          className={`app-voyage-kpi-tile__value${primary.variant === 'text' ? ' app-voyage-kpi-tile__value--text' : ''}`}
          style={{ color: primary.color }}
          title={primary.value}
        >
          {primary.value}
        </span>
        {primary.unit ? <span className="app-voyage-kpi-tile__unit">{primary.unit}</span> : null}
      </div>
      <div className="app-voyage-kpi-tile__support">
        {/* ponytail: teto visual de quatro apoios por tile; upgrade: tornar o
            conjunto expansível quando surgirem métricas que precisem de detalhe. */}
        {metrics.slice(0, 4).map((metric) => (
          <div key={`${direction}-${metric.label}`} className="app-voyage-kpi-tile__metric">
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </div>
    </div>
  )
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
  onEditEscala: (payload: EscalaModalData) => void
  onEditPol: (payload: EditingPolPayload) => void
  initialTab?: VoyageTabKey
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
  onEditEscala,
  onEditPol,
  initialTab = 'visao',
  initialEscala,
  initialReportId,
  initialTerminalCode,
}: VoyageCardProps) {
  const [activeTab, setActiveTab] = useState<VoyageTabKey>(initialTab)
  const [omitTarget, setOmitTarget] = useState<string | null>(null)
  const { isAdmin, user, profile } = useAuth()
  const isCancelled = voyage.status === 'cancelled'
  const canEditVoyages = !isCancelled && Boolean(profile || user)
  const canDeleteVoyage = !isCancelled && isAdmin

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
  const distinctContainerTypes = Array.from(new Map(
    flatContainers
      .map((container) => [String(container.container_number ?? '').trim().toUpperCase(), container.type ?? null] as const)
      .filter(([containerNumber]) => Boolean(containerNumber)),
  ).values())
  const totalTeu = calculateTeu(distinctContainerTypes)
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
    const routeBls = (voyage.bls ?? []).filter((bl) => (normalizePortCode(bl.pod) ?? normalizePortName(bl.pod)) === (normalizePortCode(pod) ?? normalizePortName(pod)))
    const routeCeFilledCount = routeBls.filter((bl) => String(bl.ce_mercante ?? '').trim()).length
    const autoCeStatus = deriveAutomaticVoyagePodCeStatus(routeCeFilledCount, routeBls.length)
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
      ceStatus: schedule?.ceStatus ?? autoCeStatus,
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
  // Uma rota tem manifesto quando o lote traz `ce_master`, quando a rota recebeu
  // número avulso (#322) OU quando há lançamento em `manifestos_mercante` (aba Rotas e Manifestos).
  const ceMasterCount = manifestRows.filter((row) => {
    if (String(row.ceMaster ?? '').trim().length > 0) return true
    return (dbManifestos ?? []).some((m) => m.pol === row.pol && m.pod === row.pod)
  }).length
  const ceMasterTotal = manifestRows.length
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

  return (
    <Card className="grid gap-5">
      <section className="app-voyage-hero">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="grid gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-[var(--app-muted-soft)]">
                {voyage.vessel?.carrier?.name ?? 'Armador nao informado'}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-bold text-[var(--app-text-strong)]">
                  {voyage.vessel?.name ?? 'Navio'} / {voyage.voyage_number}
                </h2>
                <Badge tone={VOYAGE_STATUS_BADGE_TONE[voyage.status ?? 'active'] ?? 'blue'}>
                  {statusLabel(VOYAGE_STATUS_LABELS, voyage.status ?? 'active')}
                </Badge>
                {billingClosed ? (
                  <span
                    className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300"
                    title="Todos os B/Ls desta viagem estao quitados ou isentos."
                  >
                    Faturamento Encerrado
                  </span>
                ) : null}
              </div>
            </div>

            <div className="grid gap-2">
              {importLeg ? (
                <VoyageRouteLeg
                  keyPrefix={`${voyage.id}-imp`}
                  kind="importacao"
                  originPorts={importLeg.originPorts}
                  destinationPorts={importLeg.destinationPorts}
                />
              ) : null}
              {exportLeg ? (
                <VoyageRouteLeg
                  keyPrefix={`${voyage.id}-exp`}
                  kind="exportacao"
                  originPorts={exportLeg.originPorts}
                  destinationPorts={exportLeg.destinationPorts}
                />
              ) : null}
            </div>
          </div>

          {canEditVoyages || canDeleteVoyage ? (
            <div className="flex items-center gap-2 self-start">
              {canEditVoyages ? (
                <>
                  <Button variant="ghost" className="app-voyage-action-icon" onClick={() => onEditVoyage(voyage.id)}>
                    <Pencil size={15} />
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    className="app-voyage-action-icon app-voyage-action-icon--danger"
                    onClick={() => onCancelVoyage(voyage.id)}
                    disabled={voyage.status === 'cancelled'}
                  >
                    <Ban size={15} />
                    Cancelar viagem
                  </Button>
                </>
              ) : null}
              {canDeleteVoyage ? (
                // deleteVoyage faz DELETE real em voyages, cuja policy exige
                // is_admin() (010_rls_by_role) — nao alinhar com voyages_edit.
                <Button
                  variant="ghost"
                  className="app-voyage-action-icon app-voyage-action-icon--danger"
                  onClick={() => onDeleteVoyage(voyage.id)}
                  aria-label="Excluir viagem"
                  title="Excluir viagem"
                >
                  <Trash2 size={15} />
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <DirectionKpiTile
          direction="Importação"
          tone="blue"
          primary={{ value: String(totalBls), unit: 'B/Ls' }}
          metrics={[
            { label: 'CNTRs distintos', value: String(totalContainers) },
            { label: 'TEU', value: totalTeu.unknownTypeCount ? `${totalTeu.teu} (+${totalTeu.unknownTypeCount} diverg.)` : String(totalTeu.teu) },
            { label: 'IMO / OOG', value: `${totalImoContainers} / ${totalOogContainers}` },
            { label: 'Veículos', value: String(totalImportVehicles) },
          ]}
        />
        <DirectionKpiTile
          direction="Exportação"
          tone="green"
          primary={{ value: String(totalExportContainers), unit: 'vazios embarcados' }}
          metrics={[
            { label: 'Granito · B/Ls', value: String(totalGraniteBls) },
            { label: 'Granito · ton', value: formatMetric(totalGraniteWeightTon) },
            { label: 'Embarques de vazios', value: String(totalVaziosManifests) },
          ]}
        />
        <DirectionKpiTile
          direction="PRÓXIMA ESCALA"
          tone="blue"
          primary={{
            value: proximaEscala?.pod ?? '—',
            unit: proximaEscala ? `ETA ${formatDate(proximaEscala.eta)}` : undefined,
            variant: 'text',
          }}
          metrics={[
            { label: 'Planejadas', value: String(plannedPodCount) },
            { label: 'Atracação', value: proximaEscala?.etb ? `ETB ${formatDate(proximaEscala.etb)}` : 'TBC' },
            { label: 'Status', value: proximaEscala && isEtaOverdue(proximaEscala.eta) ? 'ETA vencido' : 'Pendente' },
          ]}
        />
        <DirectionKpiTile
          direction="CONCILIAÇÃO"
          tone={reconciliationMeta.badgeTone}
          primary={{ value: reconciliationMeta.label, color: reconciliationMeta.color, variant: 'text' }}
          metrics={[
            { label: 'CE Mercante', value: `${ceCoverage.filled}/${ceCoverage.total}` },
            { label: 'Manifestos Mercante', value: `${ceMasterCount}/${ceMasterTotal}` },
            { label: 'Divergências EDIxBLs', value: String(divergenceCount) },
          ]}
        />
      </section>

      <section className="grid gap-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Seções da viagem">
          {tabs.map((tab) => (
            <TabButton
              key={tab.key}
              label={tab.label}
              active={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
            />
          ))}
        </div>

        <div className="grid gap-4">
          {activeTab === 'visao' ? (
            <VoyageVisaoTab
              voyage={voyage}
              voyageLabel={voyageLabel}
              escalaRows={planningEscalaRows}
              importBatches={importBatches}
              exportSchedules={exportSchedules}
              isAdmin={isAdmin}
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
      </section>
      {omitTarget ? (
        <OmitEscalaModal
          open
          onClose={() => setOmitTarget(null)}
          voyageId={voyage.id}
          omittedPod={omitTarget}
          candidateDischargePods={activePods.length > 1 ? activePods.filter((pod) => pod !== omitTarget) : activePods}
          blCount={podRows.find((row) => (normalizePortCode(row.pod) ?? normalizePortName(row.pod)) === (normalizePortCode(omitTarget) ?? normalizePortName(omitTarget)))?.blCount ?? 0}
        />
      ) : null}
    </Card>
  )
}

function VoyageRouteLeg({
  keyPrefix,
  kind,
  originPorts,
  destinationPorts,
}: {
  keyPrefix: string
  kind: 'importacao' | 'exportacao'
  originPorts: string[]
  destinationPorts: string[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--app-muted)]">
      <Badge tone={kind === 'importacao' ? 'blue' : 'green'} className="flex-none">
        {kind === 'importacao' ? 'Importação' : 'Exportação'}
      </Badge>
      <div className="flex flex-wrap items-center gap-2">
        {originPorts.length ? (
          originPorts.map((port) => (
            <span key={`${keyPrefix}-origin-${port}`} className="app-voyage-token">
              {port}
            </span>
          ))
        ) : (
          <span className="app-voyage-token">Origem a definir</span>
        )}
      </div>
      <ArrowRight size={16} className="text-[var(--app-muted)]" />
      <div className="flex flex-wrap items-center gap-2">
        {destinationPorts.length ? (
          destinationPorts.map((port) => (
            <span key={`${keyPrefix}-destination-${port}`} className="app-voyage-token">
              {port}
            </span>
          ))
        ) : (
          <span className="app-voyage-token">Destino a definir</span>
        )}
      </div>
    </div>
  )
}
