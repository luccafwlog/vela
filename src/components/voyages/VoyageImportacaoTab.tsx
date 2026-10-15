import { Box, Car, FileText, PackageOpen } from 'lucide-react'
import type { ReactNode } from 'react'
import type { VoyageVehicleStat } from '../../hooks/useVehicles'
import type { VoyageVaziosImportacaoStat } from '../../hooks/useVaziosImportacaoStats'
import { countDistinctContainerNumbers, countDistinctContainerNumbersBy } from '../../lib/containerCounts'
import { formatMetric, formatPortDisplayName } from '../../lib/voyageFormat'
import { splitVoyageBls, summarizeBreakbulk, summarizeImportByPod, type PodImportSummary } from '../../services/voyageSummaries'
import { VoyageImportActions } from '../shared/VoyageImportActions'
import type { Voyage } from './voyageCardTypes'
import { NoValue } from '../ui/NoValue'

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
  const { containerBls } = splitVoyageBls(voyage.bls)
  const containers = containerBls.flatMap((bl) => bl.bl_containers ?? [])
  const totalWeightTon = summarizeBreakbulk(voyage.bls).weightTon
  const distinctContainers = countDistinctContainerNumbers(containers)
  const socCount = countDistinctContainerNumbersBy(containers, (container) => container.ownership === 'SOC')
  const cocCount = countDistinctContainerNumbersBy(containers, (container) => container.ownership === 'COC')
  // Sem SOC/COC no B/L nem no Baplie: tratado como COC, mas contado à parte
  // para a pendência de cadastro ficar visível.
  const unknownOwnership = Math.max(0, distinctContainers - socCount - cocCount)
  const breakbulkBlCount = splitVoyageBls(voyage.bls).breakbulkBls.length
  const totals = [
    ['B/Ls', formatMetric(voyage.bls?.length ?? 0)],
    [`CNTRs distintos em ${formatMetric(containerBls.length)} ${containerBls.length === 1 ? 'B/L' : 'B/Ls'}`, formatMetric(distinctContainers)],
    ['IMO', formatMetric(countDistinctContainerNumbersBy(containers, (container) => Boolean(container.is_imo)))],
    ['OOG', formatMetric(countDistinctContainerNumbersBy(containers, (container) => Boolean(container.is_oog)))],
    ['SOC', formatMetric(socCount)],
    ['COC', formatMetric(cocCount)],
    ...(unknownOwnership > 0 ? [['SOC/COC não informado', formatMetric(unknownOwnership), 'warning']] : []),
    ['Veículos', formatMetric(vehicleStats.totalVehicles)],
    [`Carga solta em ${formatMetric(breakbulkBlCount)} ${breakbulkBlCount === 1 ? 'B/L' : 'B/Ls'}`, `${formatMetric(totalWeightTon)} ton`],
  ] as Array<[string, string, 'warning'?]>

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
        <section className="grid gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-4" aria-label="Importação rápida">
          <h3 className="text-sm font-semibold text-[var(--app-strip-text)]">Importação rápida</h3>
          <VoyageImportActions voyageId={voyage.id} voyageLabel={voyageLabel} userId={userId} types={['baplie', 'blFreight', 'blBreakbulk', 'ceMercante', 'vehicles', 'vaziosImp']} />
        </section>
      ) : null}
    </div>
  )
}

// Opção A da identidade (lote 1, 2026-10-15): total e cabeçalho da escala no
// azul-marinho da estrutura; os quadros de dentro com título na faixa azulada.
function TotalStrip({ totals }: { totals: Array<[string, string, 'warning'?]> }) {
  return (
    <div className="flex flex-wrap items-center gap-y-3 rounded-lg bg-[var(--app-thead-bg)] px-4 py-3 text-[var(--app-thead-text)]">
      <span className="mr-2 shrink-0 text-xs font-semibold opacity-80">Total da viagem</span>
      {totals.map(([label, value, tone], index) => (
        <span key={label} className={`flex items-baseline gap-1.5 px-4 ${index > 0 ? 'border-l border-[var(--app-thead-text)]/25' : ''}`}>
          <span className={`font-[var(--app-font-mono)] text-base font-semibold ${tone === 'warning' ? 'text-[var(--app-gold)]' : ''}`}>{value}</span>
          <span className={`text-xs ${tone === 'warning' ? 'text-[var(--app-gold)]' : 'opacity-80'}`}>{label}</span>
        </span>
      ))}
    </div>
  )
}

function SectionLabel({ label }: { label: string }) {
  return <div className="flex items-center gap-3"><span className="text-xs font-semibold text-[var(--app-muted)]">{label}</span><span className="h-px flex-1 bg-[var(--app-border)]" /></div>
}

function PodBlock({ pod, summary, vehicle, vazios }: {
  pod: string
  summary: PodImportSummary | undefined
  vehicle: VoyageVehicleStat['byPod'][string] | undefined
  vazios: VoyageVaziosImportacaoStat['byPod'][string] | undefined
}) {
  const containers = summary?.containers ?? { bls: 0, distinct: 0, imo: 0, oog: 0, soc: 0, coc: 0, types: '' }
  const generalCargo = summary?.generalCargo ?? { distinct: 0, imo: 0, oog: 0 }
  const breakbulk = summary?.breakbulk ?? { bls: 0, machines: 0, packages: 0, weightTon: 0, cbm: 0 }
  const vehicleContainers = summary?.vehicles.distinctContainers ?? vehicle?.distinctContainerCount ?? 0
  const vehicleCount = vehicle?.totalVehicles ?? 0
  const blsLabel = (count: number) => `${formatMetric(count)} ${count === 1 ? 'B/L' : 'B/Ls'}`
  const summaryParts: string[] = [`${containers.distinct} CNTRs em ${blsLabel(containers.bls)}`]
  if (breakbulk.bls > 0) summaryParts.push(`${formatMetric(breakbulk.weightTon)} t de carga solta em ${blsLabel(breakbulk.bls)}`)
  if (vehicleContainers > 0) summaryParts.push(`${vehicleContainers} CNTRs c/ veículos`)

  return (
    <section className="overflow-hidden rounded-lg border border-[var(--app-border)]" aria-label={`Escala ${pod}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2 bg-[var(--app-thead-bg)] px-4 py-2.5 text-[var(--app-thead-text)]">
        <span className="inline-flex items-baseline gap-2"><span className="text-base font-bold">{pod}</span><span className="text-xs opacity-80">{formatPortDisplayName(pod)}</span></span>
        <span className="text-xs opacity-80">{summaryParts.join(' · ')}</span>
      </header>
      <div className="grid gap-3 bg-[var(--app-surface-muted)] p-3.5 px-4">
        <div className="grid gap-3 xl:grid-cols-2">
          <Panel title="Containers" icon={<Box size={15} />} lead={containers.distinct} leadUnit={`distintos em ${blsLabel(containers.bls)}`}><MiniStats stats={[['B/Ls', containers.bls], ['Carga geral', generalCargo.distinct], ['C/ veículos', vehicleContainers], ['IMO', containers.imo], ['OOG', containers.oog], ['SOC', containers.soc], ['COC', containers.coc]]} /><CountPills values={parseCountSummary(containers.types)} /></Panel>
          {breakbulk.bls ? <Panel title="Carga solta" icon={<FileText size={15} />} lead={breakbulk.weightTon} leadUnit={`ton em ${blsLabel(breakbulk.bls)}`}><MiniStats stats={[['B/Ls', breakbulk.bls], ['Máquinas', breakbulk.machines], ['Packages', breakbulk.packages], ['CBM', breakbulk.cbm]]} /></Panel> : <Panel title="Carga solta" icon={<FileText size={15} />} empty="Sem carga solta nesta escala" />}
        </div>
        {vehicleCount ? <ScaleStrip title="Veículos" icon={<Car size={15} />} lead={vehicleCount} leadUnit="unidades" blocks={[{ label: 'CNTRs', value: vehicleContainers }, { label: 'Marcas', value: <CountPills values={parseCountSummary(vehicle?.brandSummary)} /> }, { label: 'Tipo de container', value: <CountPills values={parseCountSummary(vehicle?.vehicleByContainerTypeSummary)} />, grow: true }]} /> : <EmptyScaleStrip title="Veículos" icon={<Car size={15} />} text="Sem veículos descarregados nesta escala" />}
        {vazios && (vazios.distinctContainers > 0 || vazios.manifestos > 0) ? <ScaleStrip title="Vazios IMP" icon={<PackageOpen size={15} />} lead={vazios.distinctContainers} leadUnit="containers" blocks={[{ label: 'Manifestos', value: vazios.manifestos }, { label: 'Tipos', value: <CountPills values={vazios.types} />, grow: true }]} /> : <EmptyScaleStrip title="Vazios IMP" icon={<PackageOpen size={15} />} text="Sem vazios de importação nesta escala" />}
      </div>
    </section>
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
    <section className="overflow-hidden rounded-lg border border-[var(--app-border)]" aria-label="Sem escala atribuída">
      <header className="flex flex-wrap items-baseline justify-between gap-2 bg-[var(--app-thead-bg)] px-4 py-2.5 text-[var(--app-thead-text)]">
        <span className="inline-flex items-baseline gap-2">
          <span className="text-base font-bold">Sem escala atribuída</span>
          <span className="text-xs opacity-80">Cargas de importação sem porto de descarga (POD) definido</span>
        </span>
        <span className="text-xs opacity-80">{summaryParts.join(' · ')}</span>
      </header>
      <div className="grid gap-3 bg-[var(--app-surface-muted)] p-3.5 px-4">
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
    </section>
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
  return (
    <div className="flex min-h-[126px] flex-col overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--app-border-soft)] bg-[var(--app-strip)] px-4 py-2 text-[var(--app-strip-text)]">
        <span className="inline-flex items-center gap-2 text-sm font-semibold"><span aria-hidden="true">{icon}</span>{title}</span>
        {empty ? null : <span className="inline-flex items-baseline gap-1.5"><span className="text-xl font-bold leading-none tabular-nums">{formatMetric(lead)}</span><span className="text-xs font-semibold text-[var(--app-muted)]">{leadUnit}</span></span>}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-3.5 px-4">
        {empty ? <span className="text-sm text-[var(--app-muted)]">{empty}</span> : children}
      </div>
    </div>
  )
}

function MiniStats({ stats }: { stats: Array<[string, number]> }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{stats.map(([label, value]) => <div key={label} className="flex flex-col gap-0.5 border-l-2 border-[var(--app-border)] pl-2.5"><span className="font-[var(--app-font-mono)] text-sm font-semibold text-[var(--app-text-strong)]">{formatMetric(value)}</span><span className="text-xs text-[var(--app-muted-soft)]">{label}</span></div>)}</div>
}

function CountPills({ values }: { values: CountToken[] }) {
  if (!values.length) return <span className="text-xs"><NoValue label="Sem registros" /></span>
  return <div className="flex flex-wrap gap-1.5">{values.map(({ label, count }) => <span key={`${label}-${count}`} className="app-voyage-token gap-1.5 bg-[var(--app-surface-muted)] px-2 py-0.5"><span className="font-semibold text-[var(--app-text)]">{label}</span><span className="font-[var(--app-font-mono)] text-[var(--app-muted-soft)]">{count}</span></span>)}</div>
}

function ScaleStrip({ title, icon, lead, leadUnit, blocks }: { title: string; icon: ReactNode; lead: number; leadUnit: string; blocks: Array<{ label: string; value: ReactNode; grow?: boolean }> }) {
  return <div className="flex flex-wrap items-center gap-4 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-3.5"><span className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-[var(--app-strip-text)]"><span aria-hidden="true">{icon}</span>{title}</span><span className="inline-flex shrink-0 items-baseline gap-1.5"><span className="text-xl font-bold leading-none tabular-nums text-[var(--app-text-strong)]">{formatMetric(lead)}</span><span className="text-xs font-semibold text-[var(--app-muted-soft)]">{leadUnit}</span></span>{blocks.map((block) => <span key={block.label} className={`flex flex-col gap-1 border-l-2 border-[var(--app-border)] pl-3 ${block.grow ? 'min-w-[180px] flex-1' : ''}`}><span className="flex flex-wrap gap-1.5 text-sm font-semibold text-[var(--app-text-strong)]">{typeof block.value === 'number' ? formatMetric(block.value) : block.value}</span><span className="text-xs text-[var(--app-muted-soft)]">{block.label}</span></span>)}</div>
}

function EmptyScaleStrip({ title, icon, text }: { title: string; icon: ReactNode; text: string }) {
  return <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-3"><span className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-[var(--app-strip-text)]"><span aria-hidden="true">{icon}</span>{title}</span><span className="text-sm text-[var(--app-muted)]">{text}</span></div>
}

function parseCountSummary(value: string | null | undefined): CountToken[] {
  if (!value || value === '-') return []
  return value.split('|').flatMap((entry) => {
    const [label, countText] = entry.split(':').map((part) => part.trim())
    const count = Number(countText)
    return label && Number.isFinite(count) ? [{ label, count }] : []
  })
}
