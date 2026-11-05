import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { ManifestoBlsModal } from './ManifestoBlsModal'
import { MercanteEdiModal, type MercanteEdiRoute } from './MercanteEdiModal'
import { useVoyageTransshipments } from '../../hooks/useTransshipments'
import { useManifestosMercanteByVoyage } from '../../hooks/useManifestosMercante'
import { FileDown, FilePen, FilePlus2, List, Pencil } from 'lucide-react'
import { RowActionButton } from '../ui/RowActionButton'
import { Block } from '../ui/Block'
import { StatusText } from '../ui/StatusText'
import { NoValue } from '../ui/NoValue'
import { formatCountLabel, formatDate } from '../../lib/utils'
import type { VoyagePolSchedule } from '../../services/voyageRouteSchedules'
import { collectVoyageManifestBatchRows, countRouteManifestNumbers, formatPolDeparture, manifestosOfRoute, OMISSION_ROUTE_ROLE_LABELS, omissionRouteParts, type VoyageImportBatch } from './voyageCardHelpers'
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
  canGenerateMercanteEdi = false,
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
  /**
   * Gerar EDI Mercante só para a conta Dev (marca Dev, `useAuth().isDev`;
   * decisão do dono de 2026-11-03). A geração só lê o que todo usuário interno
   * já lê e não grava nada: esconder o botão é o controle, sem regra no banco.
   */
  canGenerateMercanteEdi?: boolean
  onEditPol: (payload: EditingPolPayload) => void
}) {
  const { data: transshipmentData } = useVoyageTransshipments(voyage.id)
  const [blsRoute, setBlsRoute] = useState<{ pol: string; pod: string; label: string; cargoMode: 'container' | 'carga_solta' } | null>(null)
  const [ediRoute, setEdiRoute] = useState<MercanteEdiRoute | null>(null)
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
  // Uma linha por rota e natureza (migration 592): a contagem do topo é de rotas.
  const routeCount = new Set(manifestRows.map((row) => `${row.pol}__${row.pod}`)).size
  type RowRef = Parameters<typeof manifestosOfRoute>[0]
  const manifestosOfRow = (row: RowRef) => manifestosOfRoute(row, dbManifestos)
  const hasRouteManifest = (row: RowRef) => countRouteManifestNumbers(row, dbManifestos) > 0
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
            {formatCountLabel(routeCount, 'rota', 'rotas')} · {formatCountLabel(totalBls, 'B/L', 'B/Ls')} · CE Mercante {ceCoverage.filled} de {ceCoverage.total}
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
                  // A mesma rota aparece numa linha por natureza: o nome acessível diz qual.
                  const rowLabel = `${row.routeLabel} (${row.isVazios ? 'vazios' : row.cargoMode === 'carga_solta' ? 'carga solta' : 'contêiner'})`
                  const routeManifestos = manifestosOfRow(row)
                  const manifestPending = !routeManifestos.length && !row.ceMaster && (row.blCount > 0 || row.isVazios)
                  const editPayload = { voyageId: voyage.id, voyageLabel, pol: row.pol, pod: row.pod, etd: row.etd, atd: row.atd, ceMaster: row.ceMaster, batchIds: row.batchIds, cargoMode: row.cargoMode }
                  const cannotEdit = !canEdit || !row.pol || row.pol === '-'
                  // EDI Mercante: cada linha gera o arquivo da sua natureza (migration 592).
                  // Contêiner e vazios têm arquivo completo; a carga solta (com os B/Ls
                  // mistos) tem arquivo próprio, parcial, que a equipe completa.
                  const canGenerateEdi = canGenerateMercanteEdi && (row.isVazios ? (row.containerCount ?? 0) > 0 : row.cargoMode === 'container' && row.blCount > 0)
                  const canGenerateBreakbulkEdi = canGenerateMercanteEdi && row.cargoMode === 'carga_solta' && row.blCount > 0
                  return (
                    <tr key={`${voyage.id}-manifest-${row.routeKey}`}>
                      <td className="app-table__text whitespace-nowrap">
                        <Link className="app-link" to={routeTargetUrl} aria-label={row.routeLabel} title={row.routeLabel}>
                          {row.omission ? (
                            omissionRouteParts(row.pol, row.pod, row.omission).map((part, index) => (
                              <Fragment key={`${part.port}-${part.role ?? 'pol'}`}>
                                {index > 0 ? ' → ' : null}
                                {part.role === 'omitted'
                                  ? <s className="text-[var(--app-muted)]" title={`POD omitido: ${part.port}`}>{part.port}</s>
                                  : part.port}
                                {part.role ? ` (${OMISSION_ROUTE_ROLE_LABELS[part.role]})` : null}
                              </Fragment>
                            ))
                          ) : `${row.pol} → ${row.pod}`}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap" title={row.hasMisto ? 'Carga solta, com B/L misto (contêiner e carga solta)' : undefined}>{row.modeLabel}</td>
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
                          routeManifestos.map((m) => <span key={m.id} className="block" title={`Manifesto Mercante de ${row.isVazios ? 'vazios' : row.cargoMode === 'carga_solta' ? 'carga solta' : 'contêiner'}: ${m.numero}`}>{m.numero}</span>)
                        ) : row.ceMaster ? row.ceMaster : manifestPending ? <StatusText tone="warning">A informar</StatusText> : <NoValue label="Sem Nº de manifesto Mercante" />}
                      </td>
                      <td className="whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          {!row.isVazios && row.blCount > 0 ? (
                            <RowActionButton
                              label={`Ver B/Ls de ${rowLabel}`}
                              icon={List}
                              title="Ver B/Ls: mover ou desvincular de Manifesto Mercante"
                              onClick={() => setBlsRoute({ pol: row.pol, pod: row.pod, label: rowLabel, cargoMode: row.cargoMode === 'carga_solta' ? 'carga_solta' : 'container' })}
                              disabled={!canEdit}
                            />
                          ) : null}
                          {canGenerateEdi ? (
                            <RowActionButton
                              label={`Gerar EDI Mercante de ${rowLabel}`}
                              icon={FileDown}
                              title="Gerar EDI Mercante"
                              onClick={() => setEdiRoute({ pol: row.pol, pod: row.pod, label: row.routeLabel, kind: row.isVazios ? 'vazio' : 'carga' })}
                              disabled={cannotEdit}
                            />
                          ) : null}
                          {canGenerateBreakbulkEdi ? (
                            <RowActionButton
                              label={`Gerar EDI Mercante de ${rowLabel} (parcial)`}
                              icon={FilePen}
                              title="Gerar EDI Mercante da carga solta (parcial, a equipe completa)"
                              onClick={() => setEdiRoute({ pol: row.pol, pod: row.pod, label: row.routeLabel, kind: 'carga_solta' })}
                              disabled={cannotEdit}
                            />
                          ) : null}
                          {manifestPending ? (
                            <RowActionButton
                              label={`Informar Nº de Manifesto Mercante de ${rowLabel}`}
                              icon={FilePlus2}
                              onClick={() => onEditPol(editPayload)}
                              disabled={cannotEdit}
                            />
                          ) : (
                            <RowActionButton
                              label={`Editar ETD previsto + ATD POL e Nº de Manifesto Mercante de ${rowLabel}`}
                              icon={Pencil}
                              title="Editar ETD previsto + ATD POL e Nº de Manifesto Mercante"
                              onClick={() => onEditPol(editPayload)}
                              disabled={cannotEdit}
                            />
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
      {ediRoute ? (
        <MercanteEdiModal voyageId={voyage.id} route={ediRoute} onClose={() => setEdiRoute(null)} />
      ) : null}
    </>
  )
}
