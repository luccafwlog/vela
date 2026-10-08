import type { ReactNode } from 'react'
import { Box, Mountain, ShieldCheck } from 'lucide-react'
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
      readyForBilling: totals.readyForBilling + embarkPort.granite.readyForBilling,
      invoiced: totals.invoiced + embarkPort.granite.invoiced,
    }),
    { manifests: 0, bls: 0, weightTon: 0, readyForBilling: 0, invoiced: 0 },
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
    ['Granito (B/Ls)', formatMetric(graniteTotals.bls)],
    ['Granito (ton)', `${formatMetric(graniteTotals.weightTon)} ton`],
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
        <section className="mt-1 grid gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-[var(--app-muted)]">Ações da exportação</div>
            <div className="mt-1 text-[13px] text-[var(--app-muted)]">Granito importa por planilha; vazios passam pelo Embarque, onde as unidades e as taxas de serviço vivem juntas.</div>
          </div>
          <VoyageImportActions voyageId={voyage.id} voyageLabel={voyageLabel} userId={userId} types={['granite', 'ceMercanteGranite', 'vaziosExp']} />
          <div className="flex items-start gap-2 text-[11px] leading-5 text-[var(--app-muted-soft)]">
            <ShieldCheck size={13} className="mt-0.5 shrink-0" />
            <span><b className="text-[var(--app-muted)]">Vazios EXP não é upload avulso.</b> O botão leva ao Embarque com a viagem travada; a planilha de unidades continua dentro dele, junto das taxas de serviço. CE Mercante (Granito) é o atalho escopado para o fluxo já existente em <code>/granito</code>.</span>
          </div>
        </section>
      ) : null}
    </div>
  )
}

function TotalStrip({ totals }: { totals: Array<[string, string]> }) {
  return <div className="flex flex-wrap items-center gap-y-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-4 py-3">
    <span className="mr-2 shrink-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--app-muted)]">Total da viagem</span>
    {totals.map(([label, value], index) => <span key={label} className={`flex items-baseline gap-1.5 px-4 ${index > 0 ? 'border-l border-[var(--app-border)]' : ''}`}><span className="font-[var(--app-font-mono)] text-[15px] font-semibold text-[var(--app-text-strong)]">{value}</span><span className="text-[11px] text-[var(--app-muted-soft)]">{label}</span></span>)}
  </div>
}

function SectionLabel({ label }: { label: string }) {
  return <div className="flex items-center gap-3"><span className="text-[11px] font-bold uppercase tracking-[0.09em] text-[var(--app-muted)]">{label}</span><span className="h-px flex-1 bg-[var(--app-border)]" /></div>
}

function EmbarkPortBlock({ summary }: { summary: EmbarkPortExportSummary }) {
  const summaryParts: string[] = []
  if (summary.vazios.units > 0) {
    summaryParts.push(`${formatMetric(summary.vazios.units)} vazios`)
    if (summary.vazios.depots.length > 1) summaryParts.push(`${summary.vazios.depots.length} depots`)
  }
  if (summary.granite.bls > 0) summaryParts.push(`${formatMetric(summary.granite.bls)} B/Ls de granito`)

  return <div className="grid gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3.5 px-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="inline-flex items-baseline gap-2"><span className="text-[15px] font-bold text-[var(--app-text-strong)]">{summary.embarkPort}</span><span className="text-xs text-[var(--app-muted-soft)]">{formatPortDisplayName(summary.embarkPort)}</span></span>
      <span className="text-xs text-[var(--app-muted)]">{summaryParts.join(' · ')}</span>
    </div>
    <div className="grid items-start gap-3 xl:grid-cols-2">
      {summary.vazios.units > 0 ? (
        <EmptyPanel summary={summary} />
      ) : (
        <EmptyPanel title="Vazios EXP" icon={<Box size={15} />} empty="Sem vazios embarcados neste terminal" />
      )}
      {summary.granite.manifests > 0 ? <GranitePanel summary={summary} /> : <EmptyPanel title="Granito" icon={<Mountain size={15} />} empty="Sem granito embarcado neste terminal" />}
    </div>
  </div>
}

function EmptyPanel({ summary, title = 'Vazios EXP', icon = <Box size={15} />, empty }: { summary?: EmbarkPortExportSummary; title?: string; icon?: ReactNode; empty?: string }) {
  if (empty) return <PanelShell title={title} icon={icon} empty={empty} />
  const vazios = summary!.vazios
  const multi = vazios.depots.length > 1
  return <PanelShell title={title} icon={icon} lead={vazios.units} leadUnit="embarcados">
    <MiniStats stats={[["CNTRs distintos", vazios.distinctContainers], [multi ? "Depots de origem" : "Depot de origem", vazios.depots.length]]} />
    {multi ? <div className="border-t border-[var(--app-border)] pt-1">
      <div className="flex items-center justify-between py-1.5"><span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--app-muted-soft)]">Por depot</span><CountPills value={vazios.types} /></div>
      {vazios.depots.map((depot, index) => <DepotRow key={depot.code} depot={depot} last={index === vazios.depots.length - 1} />)}
    </div> : <div className="flex items-center justify-between gap-2 border-t border-[var(--app-border)] pt-2.5"><span className="inline-flex min-w-0 items-center gap-2 truncate text-[13px] text-[var(--app-text)]"><Box size={13} className="shrink-0 text-[var(--app-muted-soft)]" />{vazios.depots[0]?.name ?? vazios.depots[0]?.code}</span><CountPills value={vazios.types} /></div>}
  </PanelShell>
}

function GranitePanel({ summary }: { summary: EmbarkPortExportSummary }) {
  const granite = summary.granite
  return <PanelShell title="Granito" icon={<Mountain size={15} />} lead={granite.weightTon} leadUnit="ton">
    <MiniStats stats={[["Manifestos", granite.manifests], ["B/Ls", granite.bls], ["Prontos", granite.readyForBilling], ["Faturados", granite.invoiced]]} tones={[null, null, 'green', granite.invoiced ? 'green' : 'muted']} />
  </PanelShell>
}

function PanelShell({ title, icon, lead, leadUnit, empty, children }: { title: string; icon: ReactNode; lead?: number; leadUnit?: string; empty?: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-[126px] flex-col gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-3.5 px-4">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-2 text-[13px] font-bold ${empty ? 'text-[var(--app-muted-soft)]' : 'text-[var(--app-text-strong)]'}`}>
          <span className="text-[var(--app-muted)]">{icon}</span>{title}
        </span>
        {empty ? null : <span className="inline-flex items-baseline gap-1.5"><span className="font-[var(--app-font-display)] text-[22px] font-bold leading-none tracking-[-0.03em] text-[var(--app-text-strong)]">{formatMetric(lead)}</span><span className="text-[11px] font-semibold text-[var(--app-muted-soft)]">{leadUnit}</span></span>}
      </div>
      {empty ? <div className="flex min-h-[68px] flex-1 items-center justify-center rounded-md border border-dashed border-[var(--app-border)] px-3.5 text-center text-xs text-[var(--app-muted-soft)]">{empty}</div> : children}
    </div>
  )
}

function MiniStats({ stats, tones = [] }: { stats: Array<[string, number]>; tones?: Array<'green' | 'muted' | null> }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {stats.map(([label, value], index) => (
        <div key={label} className="flex flex-col gap-0.5 border-l-2 border-[var(--app-border)] pl-2.5">
          <span className={`font-[var(--app-font-mono)] text-sm font-semibold ${tones[index] === 'green' ? 'text-[var(--app-green)]' : tones[index] === 'muted' ? 'text-[var(--app-muted-soft)]' : 'text-[var(--app-text-strong)]'}`}>{formatMetric(value)}</span>
          <span className="text-[10px] uppercase tracking-[0.05em] text-[var(--app-muted-soft)]">{label}</span>
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
  return <div className={`flex items-center gap-3 py-2 ${last ? '' : 'border-b border-[var(--app-border)]'}`}><span className="inline-flex min-w-0 flex-1 items-center gap-2"><Box size={13} className="shrink-0 text-[var(--app-muted-soft)]" /><span className="truncate text-[13px] font-semibold text-[var(--app-text-strong)]">{depot.name ?? depot.code}</span><span className="shrink-0 font-[var(--app-font-mono)] text-[10px] text-[var(--app-muted-soft)]">{depot.code}</span></span><CountPills value={depot.types} /><span className="flex w-[62px] shrink-0 items-baseline justify-end gap-1"><span className="font-[var(--app-font-mono)] text-sm font-semibold text-[var(--app-text-strong)]">{formatMetric(depot.units)}</span><span className="text-[10px] text-[var(--app-muted-soft)]">un.</span></span></div>
}
