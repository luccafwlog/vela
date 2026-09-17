import { Box, Car, FileText, PackageOpen, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import type { VoyageVehicleStat } from '../../hooks/useVehicles'
import type { VoyageVaziosImportacaoStat } from '../../hooks/useVaziosImportacaoStats'
import { countDistinctContainerNumbers, countDistinctContainerNumbersBy } from '../../lib/containerCounts'
import { formatMetric, formatPortDisplayName } from '../../lib/voyageFormat'
import { splitVoyageBls, summarizeImportByPod, type PodImportSummary } from '../../services/voyageSummaries'
import { VoyageImportActions } from '../shared/VoyageImportActions'
import type { Voyage } from './voyageCardTypes'

type CountToken = { label: string; count: number }

export function VoyageImportacaoTab({ voyage, voyageLabel, vehicleStats, vaziosImpStats, userId }: {
  voyage: Voyage
  voyageLabel: string
  vehicleStats: VoyageVehicleStat
  vaziosImpStats: VoyageVaziosImportacaoStat
  userId: string | undefined
}) {
  const importByPod = summarizeImportByPod(voyage.bls, vehicleStats.containerNumbers)
  const importByPodMap = new Map(importByPod.map((summary) => [summary.pod, summary]))
  const podCodes = Array.from(new Set([
    ...importByPod.map((summary) => summary.pod),
    ...Object.keys(vehicleStats.byPod),
    ...Object.keys(vaziosImpStats.byPod),
  ])).sort((left, right) => left.localeCompare(right, 'pt-BR'))
  const { containerBls, breakbulkBls } = splitVoyageBls(voyage.bls)
  const containers = containerBls.flatMap((bl) => bl.bl_containers ?? [])
  const totalWeightTon = breakbulkBls.reduce(
    (sum, bl) => sum + Number(bl.bb_weight_ton ?? 0),
    0,
  )
  const totals = [
    ['B/Ls', formatMetric(voyage.bls?.length ?? 0)],
    ['CNTRs distintos', formatMetric(countDistinctContainerNumbers(containers))],
    ['IMO', formatMetric(countDistinctContainerNumbersBy(containers, (container) => Boolean(container.is_imo)))],
    ['OOG', formatMetric(countDistinctContainerNumbersBy(containers, (container) => Boolean(container.is_oog)))],
    ['Veículos', formatMetric(vehicleStats.totalVehicles)],
    ['Carga solta', `${formatMetric(totalWeightTon)} ton`],
  ] as Array<[string, string]>

  const hasUnassigned = Boolean(
    (vaziosImpStats.unassigned && (vaziosImpStats.unassigned.distinctContainers > 0 || vaziosImpStats.unassigned.manifestos > 0)) ||
    (vehicleStats.unassigned && vehicleStats.unassigned.totalVehicles > 0),
  )
  const hasCargo = podCodes.length > 0 || hasUnassigned

  return (
    <div className="flex flex-col gap-4">
      <TotalStrip totals={totals} />
      <SectionLabel label="Carga por escala" />
      {podCodes.length ? (
        <div className="grid gap-3">
          {podCodes.map((pod) => (
            <PodBlock key={`${voyage.id}-imp-${pod}`} pod={pod} summary={importByPodMap.get(pod)} vehicle={vehicleStats.byPod[pod]} vazios={vaziosImpStats.byPod[pod]} />
          ))}
        </div>
      ) : null}
      {hasUnassigned ? (
        <div className="grid gap-3">
          <UnassignedCargoBlock vehicle={vehicleStats.unassigned} vazios={vaziosImpStats.unassigned} />
        </div>
      ) : null}
      {!hasCargo ? (
        <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4 text-sm text-[var(--app-muted)]">
          Nenhuma carga de importação vinculada a esta viagem.
        </div>
      ) : null}
      {userId ? (
        <section className="mt-1 grid gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-[var(--app-muted)]">Importação rápida</div>
            <div className="mt-1 text-[13px] text-[var(--app-muted)]">Importe arquivos diretamente nesta viagem sem sair da tela.</div>
          </div>
          <VoyageImportActions voyageId={voyage.id} voyageLabel={voyageLabel} userId={userId} types={['baplie', 'blFreight', 'blBreakbulk', 'ceMercante', 'vehicles', 'vaziosImp']} />
          <div className="flex items-start gap-2 text-[11px] leading-5 text-[var(--app-muted-soft)]">
            <ShieldCheck size={13} className="mt-0.5 shrink-0" />
            <span><b className="text-[var(--app-muted)]">CE Mercante serve os dois modos.</b> O import casa por número de B/L contra a tabela <code>bls</code>, que guarda container e carga solta no mesmo lugar (<code>cargo_mode</code>) — um botão só.</span>
          </div>
        </section>
      ) : null}
    </div>
  )
}

function TotalStrip({ totals }: { totals: Array<[string, string]> }) {
  return (
    <div className="flex flex-wrap items-center gap-y-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-4 py-3">
      <span className="mr-2 shrink-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--app-muted)]">Total da viagem</span>
      {totals.map(([label, value], index) => <span key={label} className={`flex items-baseline gap-1.5 px-4 ${index > 0 ? 'border-l border-[var(--app-border)]' : ''}`}><span className="font-[var(--app-font-mono)] text-[15px] font-semibold text-[var(--app-text-strong)]">{value}</span><span className="text-[11px] text-[var(--app-muted-soft)]">{label}</span></span>)}
    </div>
  )
}

function SectionLabel({ label }: { label: string }) {
  return <div className="flex items-center gap-3"><span className="text-[11px] font-bold uppercase tracking-[0.09em] text-[var(--app-muted)]">{label}</span><span className="h-px flex-1 bg-[var(--app-border)]" /></div>
}

function PodBlock({ pod, summary, vehicle, vazios }: {
  pod: string
  summary: PodImportSummary | undefined
  vehicle: VoyageVehicleStat['byPod'][string] | undefined
  vazios: VoyageVaziosImportacaoStat['byPod'][string] | undefined
}) {
  const containers = summary?.containers ?? { distinct: 0, imo: 0, oog: 0, types: '' }
  const generalCargo = summary?.generalCargo ?? { distinct: 0, imo: 0, oog: 0 }
  const breakbulk = summary?.breakbulk ?? { bls: 0, machines: 0, packages: 0, weightTon: 0, cbm: 0 }
  const vehicleContainers = summary?.vehicles.distinctContainers ?? vehicle?.distinctContainerCount ?? 0
  const vehicleCount = vehicle?.totalVehicles ?? 0
  const summaryParts: string[] = [`${containers.distinct} CNTRs`]
  if (breakbulk.bls > 0) summaryParts.push(`${breakbulk.bls} B/Ls carga solta`)
  if (vehicleContainers > 0) summaryParts.push(`${vehicleContainers} CNTRs c/ veículos`)
  const summaryLabel = summaryParts.join(' · ')

  return (
    <div className="grid gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3.5 px-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="inline-flex items-baseline gap-2"><span className="text-[15px] font-bold text-[var(--app-text-strong)]">{pod}</span><span className="text-xs text-[var(--app-muted-soft)]">{formatPortDisplayName(pod)}</span></span><span className="text-xs text-[var(--app-muted)]">{summaryLabel}</span></div>
      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Containers" icon={<Box size={15} />} lead={containers.distinct} leadUnit="distintos"><MiniStats stats={[['Carga geral', generalCargo.distinct], ['C/ veículos', vehicleContainers], ['IMO', containers.imo], ['OOG', containers.oog]]} /><CountPills values={parseCountSummary(containers.types)} /></Panel>
        {breakbulk.bls ? <Panel title="Carga solta" icon={<FileText size={15} />} lead={breakbulk.weightTon} leadUnit="ton"><MiniStats stats={[['B/Ls', breakbulk.bls], ['Máquinas', breakbulk.machines], ['Packages', breakbulk.packages], ['CBM', breakbulk.cbm]]} /></Panel> : <Panel title="Carga solta" icon={<FileText size={15} />} empty="Sem carga solta nesta escala" />}
      </div>
      {vehicleCount ? <ScaleStrip title="Veículos" icon={<Car size={15} />} lead={vehicleCount} leadUnit="unidades" blocks={[{ label: 'CNTRs', value: vehicleContainers }, { label: 'Marcas', value: <CountPills values={parseCountSummary(vehicle?.brandSummary)} /> }, { label: 'Tipo de container', value: <CountPills values={parseCountSummary(vehicle?.vehicleByContainerTypeSummary)} />, grow: true }]} /> : <EmptyScaleStrip title="Veículos" icon={<Car size={15} />} text="Sem veículos descarregados nesta escala" />}
      {vazios && (vazios.distinctContainers > 0 || vazios.manifestos > 0) ? <ScaleStrip title="Vazios IMP" icon={<PackageOpen size={15} />} lead={vazios.distinctContainers} leadUnit="containers" blocks={[{ label: 'Manifestos', value: vazios.manifestos }, { label: 'Tipos', value: <CountPills values={vazios.types} />, grow: true }]} /> : <EmptyScaleStrip title="Vazios IMP" icon={<PackageOpen size={15} />} text="Sem vazios de importação nesta escala" />}
    </div>
  )
}

function UnassignedCargoBlock({
  vehicle,
  vazios,
}: {
  vehicle?: VoyageVehicleStat['unassigned']
  vazios?: VoyageVaziosImportacaoStat['unassigned']
}) {
  const vehicleCount = vehicle?.totalVehicles ?? 0
  const vaziosCount = vazios?.distinctContainers ?? 0
  const summaryParts: string[] = []
  if (vehicleCount > 0) summaryParts.push(`${vehicleCount} veículos`)
  if (vaziosCount > 0) summaryParts.push(`${vaziosCount} vazios`)

  return (
    <div className="grid gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3.5 px-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="inline-flex items-baseline gap-2">
          <span className="text-[15px] font-bold text-[var(--app-text-strong)]">Sem escala atribuída</span>
          <span className="text-xs text-[var(--app-muted-soft)]">Cargas de importação sem porto de descarga (POD) definido</span>
        </span>
        <span className="text-xs text-[var(--app-muted)]">{summaryParts.join(' · ')}</span>
      </div>
      {vehicleCount > 0 && vehicle ? (
        <ScaleStrip
          title="Veículos"
          icon={<Car size={15} />}
          lead={vehicleCount}
          leadUnit="unidades"
          blocks={[
            { label: 'CNTRs', value: vehicle.distinctContainerCount },
            { label: 'Marcas', value: <CountPills values={parseCountSummary(vehicle.brandSummary)} /> },
            { label: 'Tipo de container', value: <CountPills values={parseCountSummary(vehicle.vehicleByContainerTypeSummary)} />, grow: true },
          ]}
        />
      ) : null}
      {vaziosCount > 0 && vazios ? (
        <ScaleStrip
          title="Vazios IMP"
          icon={<PackageOpen size={15} />}
          lead={vazios.distinctContainers}
          leadUnit="containers"
          blocks={[
            { label: 'Manifestos', value: vazios.manifestos },
            { label: 'Tipos', value: <CountPills values={vazios.types} />, grow: true },
          ]}
        />
      ) : null}
    </div>
  )
}

function Panel({ title, icon, lead, leadUnit, empty, children }: {
  title: string
  icon: ReactNode
  lead?: number
  leadUnit?: string
  empty?: string
  children?: ReactNode
}) {
  return <div className="flex min-h-[126px] flex-col gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-3.5 px-4"><div className="flex items-center justify-between gap-2"><span className={`inline-flex items-center gap-2 text-[13px] font-bold ${empty ? 'text-[var(--app-muted-soft)]' : 'text-[var(--app-text-strong)]'}`}><span className="text-[var(--app-muted)]">{icon}</span>{title}</span>{empty ? null : <span className="inline-flex items-baseline gap-1.5"><span className="font-[var(--app-font-display)] text-[22px] font-bold leading-none tracking-[-0.03em] text-[var(--app-text-strong)]">{formatMetric(lead)}</span><span className="text-[11px] font-semibold text-[var(--app-muted-soft)]">{leadUnit}</span></span>}</div>{empty ? <div className="flex min-h-[68px] flex-1 items-center justify-center rounded-md border border-dashed border-[var(--app-border)] px-3.5 text-center text-xs text-[var(--app-muted-soft)]">{empty}</div> : children}</div>
}

function MiniStats({ stats }: { stats: Array<[string, number]> }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{stats.map(([label, value]) => <div key={label} className="flex flex-col gap-0.5 border-l-2 border-[var(--app-border)] pl-2.5"><span className="font-[var(--app-font-mono)] text-sm font-semibold text-[var(--app-text-strong)]">{formatMetric(value)}</span><span className="text-[10px] uppercase tracking-[0.05em] text-[var(--app-muted-soft)]">{label}</span></div>)}</div>
}

function CountPills({ values }: { values: CountToken[] }) {
  if (!values.length) return <span className="text-xs text-[var(--app-muted-soft)]">—</span>
  return <div className="flex flex-wrap gap-1.5">{values.map(({ label, count }) => <span key={`${label}-${count}`} className="app-voyage-token gap-1.5 bg-[var(--app-surface-muted)] px-2 py-0.5"><span className="font-semibold text-[var(--app-text)]">{label}</span><span className="font-[var(--app-font-mono)] text-[var(--app-muted-soft)]">{count}</span></span>)}</div>
}

function ScaleStrip({ title, icon, lead, leadUnit, blocks }: { title: string; icon: ReactNode; lead: number; leadUnit: string; blocks: Array<{ label: string; value: ReactNode; grow?: boolean }> }) {
  return <div className="flex flex-wrap items-center gap-4 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-3.5"><span className="inline-flex shrink-0 items-center gap-2 text-[13px] font-bold text-[var(--app-text-strong)]"><span className="text-[var(--app-muted)]">{icon}</span>{title}</span><span className="inline-flex shrink-0 items-baseline gap-1.5"><span className="font-[var(--app-font-display)] text-[22px] font-bold leading-none tracking-[-0.03em] text-[var(--app-text-strong)]">{formatMetric(lead)}</span><span className="text-[11px] font-semibold text-[var(--app-muted-soft)]">{leadUnit}</span></span>{blocks.map((block) => <span key={block.label} className={`flex flex-col gap-1 border-l-2 border-[var(--app-border)] pl-3 ${block.grow ? 'min-w-[180px] flex-1' : ''}`}><span className="flex flex-wrap gap-1.5 text-sm font-semibold text-[var(--app-text-strong)]">{typeof block.value === 'number' ? formatMetric(block.value) : block.value}</span><span className="text-[10px] uppercase tracking-[0.05em] text-[var(--app-muted-soft)]">{block.label}</span></span>)}</div>
}

function EmptyScaleStrip({ title, icon, text }: { title: string; icon: ReactNode; text: string }) {
  return <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-3 text-[var(--app-muted-soft)]"><span className="inline-flex shrink-0 items-center gap-2 text-[13px] font-bold"><span>{icon}</span>{title}</span><span className="text-xs">{text}</span></div>
}

function parseCountSummary(value: string | null | undefined): CountToken[] {
  if (!value || value === '-') return []
  return value.split('|').flatMap((entry) => {
    const [label, countText] = entry.split(':').map((part) => part.trim())
    const count = Number(countText)
    return label && Number.isFinite(count) ? [{ label, count }] : []
  })
}
