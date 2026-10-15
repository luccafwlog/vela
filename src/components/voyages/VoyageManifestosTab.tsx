import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ManifestoBlsModal } from './ManifestoBlsModal'
import { useVoyageTransshipments } from '../../hooks/useTransshipments'
import { useManifestosMercanteByVoyage } from '../../hooks/useManifestosMercante'
import { Button } from '../ui/Button'
import { Block } from '../ui/Block'
import { StatusText } from '../ui/StatusText'
import { NoValue } from '../ui/NoValue'
import { formatCountLabel, formatDate } from '../../lib/utils'
import type { VoyagePolSchedule } from '../../services/voyageRouteSchedules'
import { collectVoyageManifestBatchRows, countRouteManifestNumbers, formatPolDeparture, manifestosOfRoute, type VoyageImportBatch } from './voyageCardHelpers'
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
  const [blsRoute, setBlsRoute] = useState<{ pol: string; pod: string; label: string } | null>(null)
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
  const manifestosOfRow = (row: { pol: string; pod: string; isVazios: boolean; ceMaster: string | null }) =>
    manifestosOfRoute(row, dbManifestos)
  const hasRouteManifest = (row: { pol: string; pod: string; isVazios: boolean; ceMaster: string | null }) =>
    countRouteManifestNumbers(row, dbManifestos) > 0
  const pendingManifestCount = manifestRows.filter(
    (row) => (row.blCount > 0 || row.isVazios) && !hasRouteManifest(row),
  ).length

  const pendingCe = ceCoverage.total - ceCoverage.filled
  const columnCount = 7

  return (
    <>
      <Block
        title="Rotas da viagem"
        flush
        aside={(
          <>
            {formatCountLabel(manifestRows.length, 'rota', 'rotas')} · {formatCountLabel(totalBls, 'B/L', 'B/Ls')} · CE Mercante {ceCoverage.filled} de {ceCoverage.total}
            {pendingManifestCount ? <> · <StatusText tone="warning">{formatCountLabel(pendingManifestCount, 'manifesto a informar', 'manifestos a informar')}</StatusText></> : null}
          </>
        )}
      >
        <div className="app-table-scroll">
          <table className="app-table app-table--compact">
            <caption className="sr-only">Rotas e manifestos da viagem{pendingCe > 0 ? `; ${pendingCe} CE Mercante a informar` : ''}</caption>
            <thead>
              <tr>
                <th scope="col" className="app-table__text-head">Rota</th>
                <th scope="col">Carga</th>
                <th scope="col">ATD no POL</th>
                <th scope="col">B/Ls</th>
                <th scope="col">CE Mercante</th>
                <th scope="col">Nº de manifesto Mercante</th>
                <th scope="col"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {manifestRows.length ? (
                manifestRows.map((row) => {
                  const departure = formatPolDeparture(row.etd, row.atd)
                  const routeTargetUrl = row.isVazios
                    ? `/vazios-importacao?voyage=${voyage.id}&pod=${encodeURIComponent(row.pod)}`
                    : `/bls?voyage=${voyage.id}&pol=${encodeURIComponent(row.pol)}&pod=${encodeURIComponent(row.pod)}`
                  const routeManifestos = manifestosOfRow(row)
                  const manifestPending = !routeManifestos.length && !row.ceMaster && (row.blCount > 0 || row.isVazios)
                  const editPayload = { voyageId: voyage.id, voyageLabel, pol: row.pol, pod: row.pod, etd: row.etd, atd: row.atd, ceMaster: row.ceMaster, batchIds: row.batchIds, cargoMode: row.cargoMode }
                  const cannotEdit = !canEdit || !row.pol || row.pol === '-'
                  return (
                    <tr key={`${voyage.id}-manifest-${row.routeKey}`}>
                      <td className="app-table__text whitespace-nowrap">
                        <Link className="app-link" to={routeTargetUrl} aria-label={row.routeLabel} title={row.routeLabel}>
                          {row.omission ? (
                            <>
                              {row.pol} → <s className="text-[var(--app-muted)]" title={`POD omitido: ${row.omission.omittedPod}`}>{row.omission.omittedPod}</s> → {row.omission.dischargePod}
                            </>
                          ) : `${row.pol} → ${row.pod}`}
                        </Link>
                        {row.omission ? <span className="text-[var(--app-muted)]"> · Omissão</span> : null}
                      </td>
                      <td className="whitespace-nowrap">{row.modeLabel}</td>
                      <td className="whitespace-nowrap tabular-nums">
                        {!departure.value ? <NoValue label="Sem ATD nem ETD" /> : departure.isActual ? formatDate(departure.value) : (
                          <span className="text-[var(--app-muted)]" title="ETD previsto">{formatDate(departure.value)}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap tabular-nums">{row.isVazios ? `${row.containerCount ?? 0} cntr` : row.blCount}</td>
                      <td className="whitespace-nowrap tabular-nums">
                        {row.isVazios || row.ceTotal === 0 ? <NoValue label="Sem CE Mercante nesta rota" /> : row.ceFilled < row.ceTotal
                          ? <StatusText tone="warning">{row.ceFilled} de {row.ceTotal}</StatusText>
                          : `${row.ceFilled} de ${row.ceTotal}`}
                      </td>
                      <td className="whitespace-nowrap tabular-nums">
                        {routeManifestos.length ? (
                          routeManifestos.map((m) => <span key={m.id} className="block" title={`Manifesto Mercante: ${m.numero} (${m.natureza})`}>{m.numero}</span>)
                        ) : row.ceMaster ? row.ceMaster : manifestPending ? <StatusText tone="warning">A informar</StatusText> : <NoValue label="Sem Nº de manifesto Mercante" />}
                      </td>
                      <td className="whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          {!row.isVazios && row.blCount > 0 ? (
                            <Button
                              variant="secondary"
                              className="app-btn--sm"
                              aria-label={`Ver B/Ls de ${row.routeLabel}`}
                              title="Ver B/Ls: mover ou desvincular de Manifesto Mercante"
                              onClick={() => setBlsRoute({ pol: row.pol, pod: row.pod, label: row.routeLabel })}
                              disabled={!canEdit}
                            >
                              Ver B/Ls
                            </Button>
                          ) : null}
                          {manifestPending ? (
                            <Button
                              variant="secondary"
                              className="app-btn--sm"
                              aria-label={`Informar Nº de Manifesto Mercante de ${row.routeLabel}`}
                              onClick={() => onEditPol(editPayload)}
                              disabled={cannotEdit}
                            >
                              Informar manifesto
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              className="app-btn--sm"
                              aria-label={`Editar ETD previsto + ATD POL e Nº de Manifesto Mercante de ${row.routeLabel}`}
                              title="Editar ETD previsto + ATD POL e Nº de Manifesto Mercante"
                              onClick={() => onEditPol(editPayload)}
                              disabled={cannotEdit}
                            >
                              Editar
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={columnCount} className="text-[var(--app-muted)]">Nenhuma rota de B/L identificada nesta viagem.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Block>

      {blsRoute ? (
        <ManifestoBlsModal open voyageId={voyage.id} route={blsRoute} onClose={() => setBlsRoute(null)} />
      ) : null}
    </>
  )
}
