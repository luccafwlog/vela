import { Link } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import { useVoyageTransshipments } from '../../hooks/useTransshipments'
import { useManifestosMercanteByVoyage } from '../../hooks/useManifestosMercante'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { formatDate } from '../../lib/utils'
import { formatPortDisplayName } from '../../lib/voyageFormat'
import type { VoyagePolSchedule } from '../../services/voyageRouteSchedules'
import { collectVoyageManifestBatchRows, formatPolDeparture, renderCeCoverage, type VoyageImportBatch } from './voyageCardHelpers'
import type { EditingPolPayload, Voyage } from './voyageCardTypes'

export function VoyageManifestosTab({
  voyage,
  voyageLabel,
  importBatches,
  polSchedules,
  routeCeMasters,
  ceCoverage,
  vaziosRoutes,
  canEdit = true,
  onEditPol,
}: {
  voyage: Voyage
  voyageLabel: string
  importBatches: VoyageImportBatch[]
  polSchedules: Map<string, VoyagePolSchedule> | undefined
  routeCeMasters: Map<string, string> | undefined
  ceCoverage: { filled: number; total: number }
  vaziosRoutes?: Array<{ pol: string; pod: string; containerCount: number }> | undefined
  canEdit?: boolean
  onEditPol: (payload: EditingPolPayload) => void
}) {
  const { data: transshipmentData } = useVoyageTransshipments(voyage.id)
  const { data: dbManifestos } = useManifestosMercanteByVoyage(voyage.id)
  const manifestRows = collectVoyageManifestBatchRows({
    voyageId: voyage.id,
    batches: importBatches,
    bls: voyage.bls,
    polSchedules,
    routeCeMasters,
    omissions: transshipmentData?.omissions,
    transshipments: transshipmentData?.transshipments,
    vaziosRoutes,
  })
  const totalBls = manifestRows.reduce((total, row) => total + row.blCount, 0)
  const hasRouteManifest = (pol: string, pod: string, ceMaster: string | null) => {
    if (ceMaster) return true
    return (dbManifestos ?? []).some((m) => m.pol === pol && m.pod === pod)
  }
  const pendingManifestCount = manifestRows.filter(
    (row) => (row.blCount > 0 || row.isVazios) && !hasRouteManifest(row.pol, row.pod, row.ceMaster),
  ).length

  return (
    <>
      <TotalStrip totals={[
        ['Rotas', String(manifestRows.length)],
        ['B/Ls vinculados', String(totalBls)],
        ['CE Mercante', `${ceCoverage.filled}/${ceCoverage.total}`],
        ['Nº de manifesto a informar', String(pendingManifestCount)],
      ]} />
      <SectionLabel label="Rotas da viagem" note="uma linha por par POL / POD" />

      <div className="app-voyage-table-frame">
          <div className="app-table-scroll">
            <table className="app-table app-table--compact app-table--dense w-full table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[46%]" />
                <col className="w-[13%]" />
                <col className="w-[8%]" />
                <col className="w-[13%]" />
                <col className="w-[13%]" />
                <col className="w-[7%]" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" rowSpan={2} className="px-3 py-2 text-center">Rota</th>
                  <th scope="col" rowSpan={2} className="px-3 py-2 text-center">ATD no POL</th>
                  <th scope="col" rowSpan={2} className="px-3 py-2 text-center">B/Ls</th>
                  <th scope="colgroup" colSpan={2} className="border-b border-white/15 px-3 py-2 text-center">Mercante</th>
                  <th scope="col" rowSpan={2} aria-label="Ações" className="px-3 py-2 text-center" />
                </tr>
                <tr>
                  <th scope="col" className="px-3 py-1.5 text-center text-[10px] uppercase tracking-[0.08em] text-white/70">CE Mercante · cobertura</th>
                  <th scope="col" className="px-3 py-1.5 text-center text-[10px] uppercase tracking-[0.08em] text-white/70">Nº de manifesto Mercante</th>
                </tr>
              </thead>
              <tbody>
                {manifestRows.length ? (
                  manifestRows.map((row) => {
                    const departure = formatPolDeparture(row.etd, row.atd)
                    const modeTone = row.modeLabel === 'BB' ? 'yellow' : row.modeLabel === 'VAZIOS' ? 'slate' : row.modeLabel === 'CNTR/BB' ? 'slate' : 'blue'
                    const routeTargetUrl = row.isVazios
                      ? `/vazios-importacao?voyage=${voyage.id}&pod=${encodeURIComponent(row.pod)}`
                      : `/bls?voyage=${voyage.id}&pol=${encodeURIComponent(row.pol)}&pod=${encodeURIComponent(row.pod)}`
                    return (
                    <tr key={`${voyage.id}-manifest-${row.routeKey}`}>
                      <td className="px-3 py-2 align-middle">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={modeTone} className="px-2 py-0.5 text-[10px]">{row.modeLabel}</Badge>
                          <Link
                            className="font-semibold text-[var(--app-blue-btn)] hover:underline"
                            to={routeTargetUrl}
                            aria-label={row.routeLabel}
                          >
                            {row.omission ? (
                              <>
                                <span>{formatPortDisplayName(row.pol)} → </span>
                                <span className="line-through text-[var(--app-muted-soft)]" title={`POD omitido: ${row.omission.omittedPod}`}>
                                  {formatPortDisplayName(row.omission.omittedPod)}
                                </span>
                                <span> → {formatPortDisplayName(row.omission.dischargePod)}</span>
                                <Badge tone="yellow" className="ml-2 px-2 py-0.5 text-[10px]">Omissão</Badge>
                              </>
                            ) : row.routeLabel}
                          </Link>
                        </div>
                      </td>
                      <td className={`px-3 py-2 text-center${departure.isActual ? ' font-medium text-[var(--app-blue)]' : ''}`}>
                        <span className="font-mono text-xs font-semibold tabular-nums">{formatDate(departure.value)}</span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="font-mono text-xs font-semibold text-[var(--app-text-strong)]">
                          {row.isVazios ? `${row.containerCount ?? 0} cntr` : row.blCount}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.isVazios ? (
                          <span className="text-[var(--app-muted-soft)]">-</span>
                        ) : (
                          renderCeCoverage(row.ceFilled, row.ceTotal)
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {(() => {
                          const routeManifestos = (dbManifestos ?? []).filter(
                            (m) => m.pol === row.pol && m.pod === row.pod,
                          )
                          if (routeManifestos.length > 0) {
                            return (
                              <div className="flex flex-wrap items-center justify-center gap-1.5">
                                {routeManifestos.map((m) => (
                                  <span
                                    key={m.id}
                                    className="inline-flex items-center gap-1 rounded bg-[var(--app-surface-hover)] px-1.5 py-0.5 font-mono text-xs text-[var(--app-text-strong)]"
                                    title={`Manifesto Mercante: ${m.numero} (${m.natureza})`}
                                  >
                                    <span>{m.numero}</span>
                                    <Badge tone={m.natureza === 'vazio' ? 'slate' : 'blue'} className="px-1 py-0 text-[9px] font-sans">
                                      {m.natureza}
                                    </Badge>
                                  </span>
                                ))}
                              </div>
                            )
                          }
                          if (row.ceMaster) {
                            return <span className="font-mono text-xs text-[var(--app-text-strong)]">{row.ceMaster}</span>
                          }
                          if (row.blCount > 0 || row.isVazios) {
                            return (
                              <button
                                type="button"
                                className="app-badge app-badge--yellow cursor-pointer gap-1 px-2 py-0.5 text-[10px] transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                                aria-label={`Informar Nº de Manifesto Mercante de ${row.routeLabel}`}
                                title="Informar Nº de Manifesto Mercante"
                                onClick={() => onEditPol({ voyageId: voyage.id, voyageLabel, pol: row.pol, pod: row.pod, etd: row.etd, atd: row.atd, ceMaster: row.ceMaster, batchIds: row.batchIds, cargoMode: row.cargoMode })}
                                disabled={!canEdit || !row.pol || row.pol === '-'}
                              >
                                <Pencil size={11} aria-hidden="true" />
                                <span>Informar</span>
                              </button>
                            )
                          }
                          return <span className="text-[var(--app-muted-soft)]">-</span>
                        })()}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Button
                          variant="secondary"
                          className="app-voyage-icon-btn"
                          aria-label={`Editar ETD previsto + ATD POL e Nº de Manifesto Mercante de ${row.routeLabel}`}
                          title="Editar ETD previsto + ATD POL e Nº de Manifesto Mercante"
                          onClick={() => onEditPol({ voyageId: voyage.id, voyageLabel, pol: row.pol, pod: row.pod, etd: row.etd, atd: row.atd, ceMaster: row.ceMaster, batchIds: row.batchIds, cargoMode: row.cargoMode })}
                          disabled={!canEdit || !row.pol || row.pol === '-'}
                        >
                          <Pencil size={15} />
                        </Button>
                      </td>
                    </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="px-3 py-3 text-[var(--app-muted)]">
                      Nenhuma rota de B/L identificada nesta viagem.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      <div className="flex flex-wrap items-center gap-3 px-0.5 text-[11px] leading-5 text-[var(--app-muted-soft)]">
        <span><b className="text-[var(--app-muted)]">CE Mercante</b> é a cobertura por B/L; o <b className="text-[var(--app-muted)]">Nº de manifesto Mercante</b> agrupa a rota. São coisas diferentes.</span>
        <span className="h-3 w-px bg-[var(--app-border)]" />
        <span>ATD em escuro é realizado; em cinza, o ETD previsto.</span>
      </div>
    </>
  )
}

function TotalStrip({ totals }: { totals: Array<[string, string]> }) {
  return (
    <div className="flex flex-wrap items-center gap-y-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-4 py-3">
      <span className="mr-2 shrink-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--app-muted)]">Total da viagem</span>
      {totals.map(([label, value], index) => (
        <span key={label} className={`flex items-baseline gap-1.5 px-4 ${index > 0 ? 'border-l border-[var(--app-border)]' : ''}`}>
          <span className="font-[var(--app-font-mono)] text-[15px] font-semibold text-[var(--app-text-strong)]">{value}</span>
          <span className="text-[11px] text-[var(--app-muted-soft)]">{label}</span>
        </span>
      ))}
    </div>
  )
}

function SectionLabel({ label, note }: { label: string; note: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-[var(--app-muted)]">{label}</span>
      <span className="h-px flex-1 bg-[var(--app-border)]" />
      <span className="text-[11px] text-[var(--app-muted-soft)]">{note}</span>
    </div>
  )
}
