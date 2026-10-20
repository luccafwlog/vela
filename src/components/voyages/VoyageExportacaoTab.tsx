import type { ReactNode } from 'react'
import { Box, Mountain } from 'lucide-react'
import { VoyageImportActions } from '../shared/VoyageImportActions'
import { formatMetric, formatPortDisplayName } from '../../lib/voyageFormat'
import { summarizeExportByEmbarkPort, type EmbarkPortExportSummary } from '../../services/voyageSummaries'
import type { Voyage } from './voyageCardTypes'

export function VoyageExportacaoTab({ voyage, voyageLabel, userId }: {
  voyage: Voyage
  voyageLabel: string
  userId: string | undefined
}) {
  const exportByEmbarkPort = summarizeExportByEmbarkPort(voyage.granite_manifests, voyage.vazios_manifests)
  const graniteTotals = exportByEmbarkPort.reduce(
    (totals, embarkPort) => ({
      manifests: totals.manifests + embarkPort.granite.manifests,
      bls: totals.bls + embarkPort.granite.bls,
      weightTon: totals.weightTon + embarkPort.granite.weightTon,
    }),
    { manifests: 0, bls: 0, weightTon: 0 },
  )
  const emptyTotals = exportByEmbarkPort.reduce(
    (totals, embarkPort) => ({
      units: totals.units + embarkPort.vazios.units,
      distinctContainers: totals.distinctContainers + embarkPort.vazios.distinctContainers,
      depots: totals.depots + embarkPort.vazios.depots.length,
    }),
    { units: 0, distinctContainers: 0, depots: 0 },
  )
  const totals = [
    ['Vazios embarcados', formatMetric(emptyTotals.units)],
    ['CNTRs distintos', formatMetric(emptyTotals.distinctContainers)],
    ['Depots de origem', formatMetric(emptyTotals.depots)],
    [`Granito em ${formatMetric(graniteTotals.bls)} ${graniteTotals.bls === 1 ? 'B/L' : 'B/Ls'}`, `${formatMetric(graniteTotals.weightTon)} ton`],
  ] as Array<[string, string]>

  return (
    <div className="flex flex-col gap-4">
      <TotalStrip totals={totals} />
      <SectionLabel label="Carga por terminal de embarque" />
      {exportByEmbarkPort.length ? (
        <div className="grid gap-3">
          {exportByEmbarkPort.map((summary) => <EmbarkPortBlock key={`${voyage.id}-${summary.embarkPort}`} summary={summary} />)}
        </div>
      ) : (
        <div className="app-panel app-panel--padded text-sm text-[var(--app-muted)]">
          Nenhuma carga de exportação vinculada a esta viagem.
        </div>
      )}

      {userId ? (
        <section className="grid gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-4" aria-label="Ações da exportação">
          <h3 className="text-sm font-semibold text-[var(--app-strip-text)]">Ações da exportação</h3>
          <VoyageImportActions voyageId={voyage.id} voyageLabel={voyageLabel} userId={userId} types={['granite', 'vaziosExp']} />
        </section>
      ) : null}
    </div>
  )
}

// Opção A da identidade (lote 1, 2026-10-15), igual à aba Importação.
function TotalStrip({ totals }: { totals: Array<[string, string]> }) {
  return <div className="flex flex-wrap items-center gap-y-3 rounded-lg bg-[var(--app-thead-bg)] px-4 py-3 text-[var(--app-thead-text)]">
    <span className="mr-2 shrink-0 text-xs font-semibold opacity-80">Total da viagem</span>
    {totals.map(([label, value], index) => <span key={label} className={`flex items-baseline gap-1.5 px-4 ${index > 0 ? 'border-l border-[var(--app-thead-text)]/25' : ''}`}><span className="font-[var(--app-font-mono)] text-base font-semibold">{value}</span><span className="text-xs opacity-80">{label}</span></span>)}
  </div>
}

function SectionLabel({ label }: { label: string }) {
  return <div className="flex items-center gap-3"><span className="text-xs font-semibold text-[var(--app-muted)]">{label}</span><span className="h-px flex-1 bg-[var(--app-border)]" /></div>
}

function EmbarkPortBlock({ summary }: { summary: EmbarkPortExportSummary }) {
  const summaryParts: string[] = []
  if (summary.vazios.units > 0) {
    summaryParts.push(`${formatMetric(summary.vazios.units)} vazios`)
    if (summary.vazios.depots.length > 1) summaryParts.push(`${summary.vazios.depots.length} depots`)
  }
  if (summary.granite.bls > 0) summaryParts.push(`${formatMetric(summary.granite.bls)} B/Ls de granito`)

  return <section className="overflow-hidden rounded-lg border border-[var(--app-border)]" aria-label={`Terminal de embarque ${summary.embarkPort}`}>
    <header className="flex flex-wrap items-baseline justify-between gap-2 bg-[var(--app-thead-bg)] px-4 py-2.5 text-[var(--app-thead-text)]">
      <span className="inline-flex items-baseline gap-2"><span className="text-base font-bold">{summary.embarkPort}</span><span className="text-xs opacity-80">{formatPortDisplayName(summary.embarkPort)}</span></span>
      <span className="text-xs opacity-80">{summaryParts.join(' · ')}</span>
    </header>
    <div className="grid items-start gap-3 bg-[var(--app-surface-muted)] p-3.5 px-4 xl:grid-cols-2">
      {summary.vazios.units > 0 ? (
        <EmptyPanel summary={summary} />
      ) : (
        <EmptyPanel title="Vazios EXP" icon={<Box size={15} />} empty="Sem vazios embarcados neste terminal" />
      )}
      {summary.granite.manifests > 0 ? <GranitePanel summary={summary} /> : <EmptyPanel title="Granito" icon={<Mountain size={15} />} empty="Sem granito embarcado neste terminal" />}
    </div>
  </section>
}

function EmptyPanel({ summary, title = 'Vazios EXP', icon = <Box size={15} />, empty }: { summary?: EmbarkPortExportSummary; title?: string; icon?: ReactNode; empty?: string }) {
  if (empty) return <PanelShell title={title} icon={icon} empty={empty} />
  const vazios = summary!.vazios
  const multi = vazios.depots.length > 1
  return <PanelShell title={title} icon={icon} lead={vazios.units} leadUnit="embarcados">
    <MiniStats stats={[["CNTRs distintos", vazios.distinctContainers], [multi ? "Depots de origem" : "Depot de origem", vazios.depots.length]]} />
    {multi ? <div className="border-t border-[var(--app-border)] pt-1">
      <div className="flex items-center justify-between py-1.5"><span className="text-xs font-semibold text-[var(--app-muted-soft)]">Por depot</span><CountPills value={vazios.types} /></div>
      {vazios.depots.map((depot, index) => <DepotRow key={depot.code} depot={depot} last={index === vazios.depots.length - 1} />)}
    </div> : <div className="flex items-center justify-between gap-2 border-t border-[var(--app-border)] pt-2.5"><span className="inline-flex min-w-0 items-center gap-2 truncate text-[13px] text-[var(--app-text)]"><Box size={13} className="shrink-0 text-[var(--app-muted-soft)]" />{vazios.depots[0]?.name ?? vazios.depots[0]?.code}</span><CountPills value={vazios.types} /></div>}
  </PanelShell>
}

function GranitePanel({ summary }: { summary: EmbarkPortExportSummary }) {
  const granite = summary.granite
  return <PanelShell title="Granito" icon={<Mountain size={15} />} lead={granite.weightTon} leadUnit={`ton em ${formatMetric(granite.bls)} ${granite.bls === 1 ? 'B/L' : 'B/Ls'}`}>
    <MiniStats stats={[["Manifestos", granite.manifests], ["B/Ls", granite.bls]]} />
  </PanelShell>
}

function PanelShell({ title, icon, lead, leadUnit, empty, children }: { title: string; icon: ReactNode; lead?: number; leadUnit?: string; empty?: string; children?: ReactNode }) {
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

function MiniStats({ stats, tones = [] }: { stats: Array<[string, number]>; tones?: Array<'green' | 'muted' | null> }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {stats.map(([label, value], index) => (
        <div key={label} className="flex flex-col gap-0.5 border-l-2 border-[var(--app-border)] pl-2.5">
          <span className={`font-[var(--app-font-mono)] text-sm font-semibold ${tones[index] === 'green' ? 'text-[var(--app-green)]' : tones[index] === 'muted' ? 'text-[var(--app-muted-soft)]' : 'text-[var(--app-text-strong)]'}`}>{formatMetric(value)}</span>
          <span className="text-xs text-[var(--app-muted-soft)]">{label}</span>
        </div>
      ))}
    </div>
  )
}

function CountPills({ value }: { value: string }) {
  if (!value || value === '-') return <span className="text-xs text-[var(--app-muted-soft)]">—</span>
  return <div className="flex flex-wrap gap-1.5">{value.split('|').map((token) => { const [label, count] = token.split(':').map((part) => part.trim()); return <span key={token} className="app-voyage-token gap-1.5 bg-[var(--app-surface-muted)] px-2 py-0.5"><span className="font-semibold text-[var(--app-text)]">{label}</span><span className="font-[var(--app-font-mono)] text-[var(--app-muted-soft)]">{count}</span></span> })}</div>
}

function DepotRow({ depot, last }: { depot: EmbarkPortExportSummary['vazios']['depots'][number]; last: boolean }) {
  return <div className={`flex items-center gap-3 py-2 ${last ? '' : 'border-b border-[var(--app-border)]'}`}><span className="inline-flex min-w-0 flex-1 items-center gap-2"><Box size={13} className="shrink-0 text-[var(--app-muted-soft)]" /><span className="truncate text-[13px] font-semibold text-[var(--app-text-strong)]">{depot.name ?? depot.code}</span><span className="shrink-0 font-[var(--app-font-mono)] text-xs text-[var(--app-muted-soft)]">{depot.code}</span></span><CountPills value={depot.types} /><span className="flex w-[62px] shrink-0 items-baseline justify-end gap-1"><span className="font-[var(--app-font-mono)] text-sm font-semibold text-[var(--app-text-strong)]">{formatMetric(depot.units)}</span><span className="text-xs text-[var(--app-muted-soft)]">un.</span></span></div>
}
