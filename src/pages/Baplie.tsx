import { afterBaplieImportado } from '../services/cacheEffects'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Clock3, Download, Upload, XCircle } from 'lucide-react'
import { exportBaplieWorkbook } from '../services/exports'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, EmptyState, PageHeader } from '../components/ui/Card'
import { FilterBar } from '../components/ui/FilterBar'
import { Field, Input, Select } from '../components/ui/Input'
import { SkeletonTable } from '../components/ui/Skeleton'
import { SummaryStrip } from '../components/ui/SummaryStrip'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { CargoProfileBadge, ContainerOwnershipBadge } from '../components/shared/OperationalBadges'
import { ImportFilePicker, ImportFootnote, ImportGuide, ImportNotice, ImportSection } from '../components/shared/ImportParts'
import { plural } from '../components/shared/importPresentation'
import { useNarrowViewport } from '../components/bl/useNarrowViewport'
import { useAuth } from '../hooks/useAuth'
import { useVoyages } from '../hooks/useBls'
import { useCancellableFileRead } from '../hooks/useCancellableFileRead'
import { parseBaplieFile } from '../services/baplieParser'
import { baplieImportToast, baplieReplacementConfirmOptions, reimportBaplie } from '../services/baplieImport'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { hasBlsForVoyage, listBaplieStaging } from '../services/baplieReadModel'
import {
  reconcileBaplieWithManifest,
  type BaplieReconciliationItem,
} from '../services/baplieReconciliation'
import {
  importVaziosFromBaplie,
  getBaplieManifestForVoyage,
  replaceVaziosFromBaplie,
} from '../services/vaziosImportacaoImport'
import type { BaplieContainer } from '../types/database'
import { formatDate, formatDateTimeBR } from '../lib/utils'
import { listVoyageEscalaSchedulesByVoyageIds } from '../services/voyageRouteSchedules'
import { buildVoyageRailItems, type VoyageRailItem } from '../services/voyageSummaries'
import { VoyageRail } from '../components/voyages/VoyageRail'
import { ImportIssuesPanel } from '../components/shared/ImportIssuesPanel'
import { ImportReadProgress } from '../components/shared/ImportReadProgress'
import { canImportPreview } from '../services/importValidation'
import {
  buildReconciliationOverview,
  describeRowCoverage,
  formatRouteKey,
  indexReconciliation,
  type CoverageFilter,
  type ReconciliationOverview,
} from './bapliePresentation'

type VoyageOption = { id: number; voyage_number: string | null; vessel?: { name?: string | null } | null }

function voyageLabel(voyages: readonly VoyageOption[], voyageId: string) {
  const voyage = voyages.find((item) => String(item.id) === voyageId)
  return voyage ? `${voyage.vessel?.name ?? 'Navio'} / ${voyage.voyage_number ?? '—'}` : null
}

export function Baplie() {
  const [searchParams, setSearchParams] = useSearchParams()
  const voyageId = searchParams.get('voyage') ?? ''
  const { showToast } = useToast()
  const { user, profile } = useAuth()
  const canImportVazios = Boolean(profile || user)
  const canUploadManifests = Boolean(profile || user)
  const queryClient = useQueryClient()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [containerFilters, setContainerFilters] = useState<ContainerFilters>(EMPTY_CONTAINER_FILTERS)

  // O rail reaproveita a projeção resumida de Viagens. A presença de Baplie
  // também vem do agregado server-side, portanto a tela não precisa varrer
  // `baplie_containers` inteiro apenas para desenhar os cards.
  const { data: voyageRows = [], isLoading: voyagesLoading } = useVoyages()
  const voyageIds = useMemo(() => voyageRows.map((voyage) => voyage.id), [voyageRows])
  const { data: schedulesByVoyage = new Map() } = useQuery({
    queryKey: ['baplie-voyage-card-schedules', voyageIds],
    enabled: voyageIds.length > 0,
    queryFn: () => listVoyageEscalaSchedulesByVoyageIds(voyageIds),
  })
  const voyageCards = useMemo(() => {
    const items = buildVoyageRailItems(
      voyageRows,
      schedulesByVoyage,
    )
    return items.map((item): VoyageRailItem => ({
      ...item,
      modules: {
        ...item.modules,
        container: item.modules.container || (voyageRows.find((voyage) => voyage.id === item.id)?.baplieCount ?? 0) > 0,
      },
    }))
  }, [schedulesByVoyage, voyageRows])

  const stagingQuery = useQuery({
    queryKey: ['baplie-staging', voyageId],
    enabled: !!voyageId,
    queryFn: () => listBaplieStaging(Number(voyageId)),
  })
  const stagingData = stagingQuery.data

  const blsQuery = useQuery({
    queryKey: ['baplie-bls-exist', voyageId],
    enabled: !!voyageId,
    queryFn: () => hasBlsForVoyage(Number(voyageId)),
  })
  const blsExist = blsQuery.data

  const { data: existingVaziosManifest, isLoading: existingVaziosManifestLoading } = useQuery({
    queryKey: ['baplie-vazios-manifest', voyageId],
    enabled: !!voyageId,
    queryFn: () => getBaplieManifestForVoyage(Number(voyageId)),
    placeholderData: null,
  })

  const reconciliationQuery = useQuery({
    queryKey: ['baplie-reconciliation', voyageId],
    enabled: !!voyageId && !!blsExist && (stagingData?.length ?? 0) > 0,
    queryFn: () => reconcileBaplieWithManifest(Number(voyageId)),
  })
  const reconciliationData = reconciliationQuery.data

  const containers = useMemo(() => stagingData ?? [], [stagingData])
  const emptyContainers = containers.filter((c) => c.status === 'empty')
  const hasStaging = containers.length > 0
  const importedAt = containers.reduce<string | null>((latest, row) => (!latest || (row.imported_at && row.imported_at > latest) ? row.imported_at : latest), null)

  const overview = buildReconciliationOverview({
    staged: containers,
    blsExist,
    reconciliation: reconciliationData?.source === 'not_imported' ? undefined : reconciliationData,
    loading: blsQuery.isLoading || reconciliationQuery.isLoading,
    failed: blsQuery.isError || reconciliationQuery.isError,
  })

  function handleVoyageChange(value: string) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set('voyage', value)
    else next.delete('voyage')
    setSearchParams(next)
    setContainerFilters(EMPTY_CONTAINER_FILTERS)
  }

  async function handleConfirmarVazios() {
    if (!user || !voyageId) return
    if (existingVaziosManifest) return
    await importVaziosFromBaplie({ voyageId: Number(voyageId), uploadedBy: user.id })
    await afterBaplieImportado(queryClient, { voyageId })
    showToast(`${plural(emptyContainers.length, 'vazio cadastrado', 'vazios cadastrados')} em Vazios de importação.`, 'success')
  }

  async function handleSubstituirVazios() {
    if (!user || !voyageId || !existingVaziosManifest) return
    await replaceVaziosFromBaplie({ voyageId: Number(voyageId), uploadedBy: user.id })
    await afterBaplieImportado(queryClient, { voyageId })
    showToast(`Vazios de importação atualizados: ${plural(emptyContainers.length, 'container', 'containers')}.`, 'success')
  }

  async function handleExport() {
    if (!containers.length) return
    setExporting(true)
    try {
      await exportBaplieWorkbook(containers)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao exportar Baplie EDI.', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Baplie EDI"
        action={voyageId && hasStaging ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={exporting} loadingLabel="Exportando…" onClick={handleExport}><Download size={16} aria-hidden="true" /> Exportar</Button>
            {canUploadManifests ? <Button variant="secondary" onClick={() => setUploadOpen(true)}><Upload size={16} aria-hidden="true" /> Reimportar Baplie</Button> : null}
          </div>
        ) : null}
      />

      <section className="app-cargo-voyage" aria-label="Viagem">
        {voyagesLoading ? (
          <p className="app-cargo-voyage__loading" role="status">Carregando viagens…</p>
        ) : (
          <VoyageRail
            items={voyageCards}
            selectedId={voyageId ? Number(voyageId) : null}
            onSelect={(id) => handleVoyageChange(String(id))}
          />
        )}
        <div className="app-cargo-voyage__search">
          <VoyageCombobox
            clearable
            label="Buscar viagem"
            selectedVoyageId={voyageId}
            onSelect={(id) => handleVoyageChange(id == null ? '' : String(id))}
          />
        </div>
      </section>

      {!voyageId ? (
        <Card className="overflow-hidden p-0">
          <EmptyState title="Escolha uma viagem" description="O Baplie é importado e conferido com os B/Ls por viagem. Escolha na faixa acima ou busque pelo navio." />
        </Card>
      ) : stagingQuery.isError ? (
        <Card>
          <div className="app-cargo-state" role="alert">
            <p className="app-cargo-state__title">Não foi possível ler o Baplie desta viagem.</p>
            <p className="app-cargo-state__text">Isto não significa que a viagem está sem Baplie.</p>
            <Button variant="secondary" onClick={() => void stagingQuery.refetch()}>Tentar novamente</Button>
          </div>
        </Card>
      ) : stagingQuery.isLoading ? (
        <Card className="overflow-hidden p-0">
          <SkeletonTable rows={6} cols={6} label="Carregando Baplie" />
        </Card>
      ) : !hasStaging ? (
        <StateA canImport={canUploadManifests} onUpload={() => setUploadOpen(true)} />
      ) : (
        <>
          <BaplieOverviewSection containers={containers} importedAt={importedAt} />

          <ReconciliacaoSection
            overview={overview}
            items={reconciliationData?.items ?? []}
            voyageId={voyageId}
            onRetry={() => {
              if (blsQuery.isError) void blsQuery.refetch()
              else void reconciliationQuery.refetch()
            }}
          />

          {emptyContainers.length > 0 ? (
            <VaziosSection
              emptyCount={emptyContainers.length}
              existingManifest={existingVaziosManifestLoading ? null : (existingVaziosManifest ?? null)}
              loadingExistingManifest={existingVaziosManifestLoading}
              voyageId={voyageId}
              canWrite={canImportVazios}
              onConfirmar={handleConfirmarVazios}
              onSubstituir={handleSubstituirVazios}
            />
          ) : null}

          <ContainerList
            containers={containers}
            filters={containerFilters}
            onFiltersChange={setContainerFilters}
            overview={overview}
            reconciliation={reconciliationData}
          />
        </>
      )}

      {uploadOpen ? (
        <BaplieUploadModal
          voyages={voyageRows}
          onClose={() => setUploadOpen(false)}
          onImported={async (importedVoyageId) => {
            // O seletor do modal pode apontar para outra viagem que a página.
            await afterBaplieImportado(queryClient, { voyageId: importedVoyageId })
          }}
          initialVoyageId={voyageId}
        />
      ) : null}
    </>
  )
}

function StateA({ canImport, onUpload }: { canImport: boolean; onUpload: () => void }) {
  return (
    <Card className="overflow-hidden p-0">
      <EmptyState
        icon={Upload}
        title="Esta viagem ainda não tem Baplie"
        description="O Baplie EDI traz a carga física a bordo: container, slot, IMO e OOG. Ao importar, IMO e OOG passam aos containers dos B/Ls e a conciliação compara as duas fontes."
        action={canImport ? (
          <Button onClick={onUpload}>
            <Upload size={16} aria-hidden="true" />
            Importar Baplie EDI
          </Button>
        ) : (
          <p className="app-cargo-state__text">A importação do Baplie exige um usuário interno ativo.</p>
        )}
      />
    </Card>
  )
}

function BaplieOverviewSection({ containers, importedAt }: { containers: BaplieContainer[]; importedAt: string | null }) {
  const full = containers.filter((c) => c.status !== 'empty')
  return (
    <Card className="app-cargo-panel p-0">
      <div className="app-cargo-panel__head">
        <div>
          <h2 className="app-cargo-panel__title">Carga física no Baplie</h2>
          <p className="app-cargo-panel__meta">{importedAt ? `Importado em ${formatDateTimeBR(importedAt)}` : 'Data de importação não registrada'}</p>
        </div>
        <SummaryStrip
          label="Resumo do Baplie"
          items={[
            { label: containers.length === 1 ? 'container' : 'containers', value: containers.length.toLocaleString('pt-BR') },
            { label: 'cheios', value: full.length.toLocaleString('pt-BR') },
            { label: 'vazios', value: (containers.length - full.length).toLocaleString('pt-BR') },
            { label: 'IMO', value: full.filter((c) => c.is_imo).length.toLocaleString('pt-BR') },
            { label: 'OOG', value: full.filter((c) => c.is_oog).length.toLocaleString('pt-BR') },
          ]}
        />
      </div>
      <p className="app-cargo-panel__note">
        O Baplie vale para IMO, classe, ONU e OOG: cada importação aplica esses dados aos containers dos B/Ls e, se a aplicação falhar, avisa na hora; importar o mesmo arquivo de novo refaz a aplicação. Para SOC/COC, vale o B/L.
      </p>
    </Card>
  )
}

const STATE_ICON = {
  error: XCircle,
  loading: Clock3,
  no_bls: Clock3,
  awaiting_route_coverage: Clock3,
  divergent: AlertTriangle,
  clean: CheckCircle2,
} as const

function reconciliationHeadline(overview: ReconciliationOverview, divergences: number): { title: string; text: ReactNode; tone: 'danger' | 'warning' | 'success' | 'neutral' } {
  switch (overview.state) {
    case 'error':
      return { title: 'Não foi possível conferir com os B/Ls', text: 'A conciliação não carregou. Isto não significa que não há divergência.', tone: 'danger' }
    case 'loading':
      return { title: 'Conferindo com os B/Ls…', text: 'Comparando os containers do Baplie com os dos B/Ls da viagem.', tone: 'neutral' }
    case 'no_bls':
      return {
        title: 'Viagem sem B/L para conferir',
        text: `Os ${plural(overview.full, 'container cheio', 'containers cheios')} do Baplie ficam fora da conciliação até os B/Ls da viagem serem importados.`,
        tone: 'neutral',
      }
    case 'awaiting_route_coverage':
      return {
        title: 'Aguardando B/L das rotas do Baplie',
        text: 'Nenhuma rota de cheios do Baplie tem B/L com containers. Cada rota entra na conciliação quando receber o primeiro B/L com containers.',
        tone: 'neutral',
      }
    case 'divergent':
      return { title: `${plural(divergences, 'divergência para resolver', 'divergências para resolver')}`, text: 'Cada grupo abaixo diz o que a diferença significa e o que fazer.', tone: 'warning' }
    case 'clean':
      return { title: 'Baplie e B/Ls conferem', text: 'Todo container cheio em conciliação está nos dois lados, sem SOC/COC divergente.', tone: 'success' }
  }
}

function ReconciliacaoSection({
  overview,
  items,
  voyageId,
  onRetry,
}: {
  overview: ReconciliationOverview
  items: BaplieReconciliationItem[]
  voyageId: string
  onRetry: () => void
}) {
  const missing = items.filter(
    (item): item is Extract<BaplieReconciliationItem, { kind: 'missing_in_manifest' }> => item.kind === 'missing_in_manifest',
  )
  const missingInBaplie = items.filter(
    (item): item is Extract<BaplieReconciliationItem, { kind: 'missing_in_baplie' }> => item.kind === 'missing_in_baplie',
  )
  const ownershipMismatch = items.filter(
    (item): item is Extract<BaplieReconciliationItem, { kind: 'ownership_mismatch' }> => item.kind === 'ownership_mismatch',
  )
  const headline = reconciliationHeadline(overview, items.length)
  const Icon = STATE_ICON[overview.state]
  const showCoverage = overview.state === 'divergent' || overview.state === 'clean'

  return (
    <Card className="app-cargo-panel p-0">
      <section aria-labelledby="baplie-conciliacao-title">
        <div className="app-cargo-panel__head">
          <h2 id="baplie-conciliacao-title" className="app-cargo-panel__title">Conciliação Baplie × B/L</h2>
        </div>
        <div className={`app-cargo-verdict app-cargo-verdict--${headline.tone}`} role={overview.state === 'error' ? 'alert' : 'status'}>
          <Icon size={18} aria-hidden="true" className="app-cargo-verdict__icon" />
          <div className="app-cargo-verdict__body">
            <p className="app-cargo-verdict__title">{headline.title}</p>
            <p className="app-cargo-verdict__text">{headline.text}</p>
            {overview.state === 'error' ? <Button variant="secondary" className="app-btn--sm" onClick={onRetry}>Tentar novamente</Button> : null}
            {overview.state === 'no_bls' ? <Link className="app-cargo-link" to={`/viagens/${voyageId}`}>Abrir a viagem para importar B/Ls →</Link> : null}
          </div>
        </div>

        {showCoverage ? (
          <dl className="app-cargo-facts" aria-label="Cobertura documental">
            <div className="app-cargo-facts__item">
              <dt>Cheios com B/L</dt>
              <dd>{overview.covered.toLocaleString('pt-BR')} de {overview.inScope.toLocaleString('pt-BR')}</dd>
            </div>
            <CoverageFact label="No Baplie, sem B/L" count={missing.length} anchor="baplie-sem-bl" />
            <CoverageFact label="Em B/L, fora do Baplie" count={missingInBaplie.length} anchor="baplie-fora" />
            <CoverageFact label="SOC/COC diverge" count={ownershipMismatch.length} anchor="baplie-soc-coc" />
          </dl>
        ) : null}

        {overview.pendingRoutes.length ? (
          <p className="app-cargo-panel__note">
            {overview.state === 'awaiting_route_coverage' ? 'Rotas aguardando B/L' : `Fora da conciliação até chegar o B/L (${plural(overview.onPendingRoutes, 'cheio', 'cheios')})`}:{' '}
            <strong>{overview.pendingRoutes.map(formatRouteKey).join(', ')}</strong>
          </p>
        ) : null}

        {missing.length > 0 ? (
          <DivergenceGroup
            id="baplie-sem-bl"
            title={`No Baplie, sem B/L (${missing.length})`}
            meaning="Container cheio a bordo sem documento na viagem. Não conta como carga no ADR nem gera cobrança."
            action="Pedir ao armador o B/L ou a correção do manifesto; quando o B/L for importado, a divergência some."
          >
            <table className="app-table app-cargo-table app-cargo-table--sub">
              <caption className="sr-only">Containers no Baplie sem B/L</caption>
              <thead>
                <tr>
                  <th scope="col">Container</th>
                  <th scope="col">B/L citado no Baplie</th>
                  <th scope="col">Slot</th>
                </tr>
              </thead>
              <tbody>
                {missing.map((item) => (
                  <tr key={item.container_number}>
                    <td className="app-cargo-code app-cargo-id">{item.container_number}</td>
                    <td className="app-cargo-code">{item.baplie_bl_ref ?? <span className="app-cargo-cell__muted" aria-label="Não citado">—</span>}</td>
                    <td className="app-cargo-code">{item.slot ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DivergenceGroup>
        ) : null}

        {missingInBaplie.length > 0 ? (
          <DivergenceGroup
            id="baplie-fora"
            title={`Em B/L, fora do Baplie (${missingInBaplie.length})`}
            meaning="O B/L declara um container que o Baplie não mostra a bordo. A cobrança continua pelo B/L."
            action="Confirmar o embarque com o armador; se embarcou, reimportar o Baplie corrigido."
          >
            <table className="app-table app-cargo-table app-cargo-table--sub">
              <caption className="sr-only">Containers em B/L ausentes do Baplie</caption>
              <thead>
                <tr>
                  <th scope="col">Container</th>
                  <th scope="col">B/L</th>
                </tr>
              </thead>
              <tbody>
                {missingInBaplie.map((item) => (
                  <tr key={item.container_number}>
                    <td className="app-cargo-code app-cargo-id">{item.container_number}</td>
                    <td>{item.bl_id ? <Link className="app-cargo-link app-cargo-id" to={`/bls/${item.bl_id}?tab=carga`}>{item.bl_id}</Link> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DivergenceGroup>
        ) : null}

        {ownershipMismatch.length > 0 ? (
          <DivergenceGroup
            id="baplie-soc-coc"
            title={`SOC/COC diverge (${ownershipMismatch.length})`}
            meaning="O B/L e o Baplie informam donos diferentes. Vale o B/L nas taxas e na Demurrage; nada é trocado sozinho."
            action="Confirmar com o armador; se o B/L estiver errado, corrigir na aba Carga do B/L, com justificativa."
          >
            <table className="app-table app-cargo-table app-cargo-table--sub">
              <caption className="sr-only">SOC/COC divergente entre B/L e Baplie</caption>
              <thead>
                <tr>
                  <th scope="col">Container</th>
                  <th scope="col">B/L</th>
                  <th scope="col">No B/L (vale)</th>
                  <th scope="col">No Baplie</th>
                </tr>
              </thead>
              <tbody>
                {ownershipMismatch.map((item) => (
                  <tr key={item.container_number}>
                    <td className="app-cargo-code app-cargo-id">{item.container_number}</td>
                    <td>{item.bl_id ? <Link className="app-cargo-link app-cargo-id" to={`/bls/${item.bl_id}?tab=carga`}>{item.bl_id}</Link> : '—'}</td>
                    <td><ContainerOwnershipBadge ownership={item.bl_ownership} /></td>
                    <td><ContainerOwnershipBadge ownership={item.baplie_ownership} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DivergenceGroup>
        ) : null}
      </section>
    </Card>
  )
}

function CoverageFact({ label, count, anchor }: { label: string; count: number; anchor: string }) {
  return (
    <div className={`app-cargo-facts__item${count > 0 ? ' app-cargo-facts__item--warning' : ''}`}>
      <dt>{label}</dt>
      <dd>{count > 0 ? <a className="app-cargo-link" href={`#${anchor}`}>{count.toLocaleString('pt-BR')}</a> : '0'}</dd>
    </div>
  )
}

function DivergenceGroup({ id, title, meaning, action, children }: { id: string; title: string; meaning: string; action: string; children: ReactNode }) {
  return (
    <section id={id} className="app-cargo-divergence" aria-labelledby={`${id}-title`} tabIndex={-1}>
      <h3 id={`${id}-title`} className="app-cargo-divergence__title">
        <AlertTriangle size={15} aria-hidden="true" /> {title}
      </h3>
      <p className="app-cargo-divergence__text">{meaning}</p>
      <p className="app-cargo-divergence__text"><strong>O que fazer:</strong> {action}</p>
      <div className="app-table-scroll app-cargo-divergence__table">{children}</div>
    </section>
  )
}

function VaziosSection({
  emptyCount,
  existingManifest,
  loadingExistingManifest,
  voyageId,
  canWrite,
  onConfirmar,
  onSubstituir,
}: {
  emptyCount: number
  existingManifest: { id: string; total_containers: number; imported_at: string } | null
  loadingExistingManifest: boolean
  voyageId: string
  canWrite: boolean
  onConfirmar: () => Promise<void>
  onSubstituir: () => Promise<void>
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(fn: () => Promise<void>) {
    setLoading(true)
    setError(null)
    try { await fn() } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível gravar os vazios.')
    } finally { setLoading(false) }
  }

  const isCountMismatch = Boolean(existingManifest && existingManifest.total_containers !== emptyCount)
  const vaziosLink = <Link className="app-cargo-link" to={`/vazios-importacao?voyage=${voyageId}`}>Abrir Vazios de importação →</Link>

  return (
    <Card className="app-cargo-panel p-0">
      <section aria-labelledby="baplie-vazios-title">
        <div className="app-cargo-panel__head">
          <div>
            <h2 id="baplie-vazios-title" className="app-cargo-panel__title">Vazios de importação</h2>
            <p className="app-cargo-panel__meta">{plural(emptyCount, 'container vazio', 'containers vazios')} neste Baplie · fora da conciliação com B/L</p>
          </div>
        </div>
        <div className="app-cargo-panel__body">
          {loadingExistingManifest ? (
            <p className="app-cargo-state__text" role="status">Verificando o cadastro de vazios…</p>
          ) : existingManifest ? (
            <div className="app-cargo-row">
              <p className={`app-cargo-row__text${isCountMismatch ? ' app-cargo-row__text--warning' : ''}`}>
                {isCountMismatch ? <AlertTriangle size={15} aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}
                <span>
                  Cadastrados em {formatDate(existingManifest.imported_at)} com {plural(existingManifest.total_containers, 'container', 'containers')}.
                  {isCountMismatch ? ` O Baplie atual tem ${emptyCount}; atualizar substitui os containers do cadastro pelos vazios deste Baplie.` : ''}
                </span>
              </p>
              <span className="app-cargo-row__actions">
                {vaziosLink}
                {canWrite && isCountMismatch ? (
                  <Button variant="secondary" loading={loading} loadingLabel="Atualizando…" onClick={() => run(onSubstituir)}>
                    Atualizar vazios do Baplie
                  </Button>
                ) : null}
              </span>
            </div>
          ) : (
            <div className="app-cargo-row">
              <p className="app-cargo-row__text">
                <Clock3 size={15} aria-hidden="true" />
                <span>Ainda não cadastrados. Entram sem Nº de manifesto Mercante; o número é informado depois em Rotas e Manifestos da viagem.</span>
              </p>
              {canWrite ? (
                <Button disabled={loadingExistingManifest} loading={loading} loadingLabel="Cadastrando…" onClick={() => run(onConfirmar)}>
                  Cadastrar {plural(emptyCount, 'vazio', 'vazios')}
                </Button>
              ) : null}
            </div>
          )}
          {error ? (
            <ImportNotice tone="danger" role="alert" title="Os vazios não foram gravados">
              <p>{error}</p>
            </ImportNotice>
          ) : null}
        </div>
      </section>
    </Card>
  )
}

type ContainerFilters = {
  container: string
  coverage: '' | CoverageFilter
  status: string
  type: string
  pol: string
  pod: string
  profile: string
  ownership: string
}

const EMPTY_CONTAINER_FILTERS: ContainerFilters = {
  container: '', coverage: '', status: '', type: '', pol: '', pod: '', profile: '', ownership: '',
}

function ContainerList({
  containers,
  filters,
  onFiltersChange,
  overview,
  reconciliation,
}: {
  containers: BaplieContainer[]
  filters: ContainerFilters
  onFiltersChange: (filters: ContainerFilters) => void
  overview: ReconciliationOverview
  reconciliation: Parameters<typeof describeRowCoverage>[2]
}) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const narrow = useNarrowViewport()
  const index = useMemo(() => indexReconciliation(reconciliation), [reconciliation])
  const rows = useMemo(
    () => containers.map((container) => ({ container, coverage: describeRowCoverage(container, overview, reconciliation, index) })),
    [containers, overview, reconciliation, index],
  )
  const filtered = useMemo(() => {
    const term = filters.container.trim().toLowerCase()
    return rows.filter(({ container, coverage }) => {
      const profile = container.is_imo ? 'imo' : container.is_oog ? 'oog' : 'standard'
      return (!term || container.container_number.toLowerCase().includes(term) || (container.slot ?? '').toLowerCase().includes(term) || (container.bl_ref ?? '').toLowerCase().includes(term))
        && (!filters.coverage || coverage?.key === filters.coverage)
        && (!filters.status || (container.status === 'empty' ? 'empty' : 'full') === filters.status)
        && (!filters.type || container.size_type === filters.type)
        && (!filters.pol || container.pol === filters.pol)
        && (!filters.pod || container.pod === filters.pod)
        && (!filters.profile || profile === filters.profile)
        && (!filters.ownership || (container.ownership ?? 'none') === filters.ownership)
    })
  }, [rows, filters])
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)
  const filterKey = JSON.stringify(filters)
  const [previousFilterKey, setPreviousFilterKey] = useState(filterKey)
  if (filterKey !== previousFilterKey) {
    setPreviousFilterKey(filterKey)
    setPage(1)
  }

  const options = (field: keyof BaplieContainer) => Array.from(new Set(containers.map((container) => String(container[field] ?? '').trim()).filter(Boolean))).sort()
  const update = (field: keyof ContainerFilters, value: string) => onFiltersChange({ ...filters, [field]: value })
  const activeCount = Object.values(filters).filter(Boolean).length

  return (
    <>
      <FilterBar title="Filtros dos containers" activeCount={activeCount} onClear={() => onFiltersChange(EMPTY_CONTAINER_FILTERS)}>
        <div className="app-filter-grid">
          <Field label="Buscar"><Input type="search" value={filters.container} onChange={(event) => update('container', event.target.value)} placeholder="Container, slot ou B/L citado" /></Field>
          <Field label="Conciliação">
            <Select value={filters.coverage} onChange={(event) => update('coverage', event.target.value)}>
              <option value="">Todas</option>
              <option value="covered">Com B/L</option>
              <option value="missing">Sem B/L</option>
              <option value="ownership">SOC/COC diverge</option>
              <option value="out_of_scope">Fora da conciliação (sem B/L na rota)</option>
              <option value="empty">Vazios</option>
            </Select>
          </Field>
          <Field label="Status"><Select value={filters.status} onChange={(event) => update('status', event.target.value)}><option value="">Todos</option><option value="full">Cheio</option><option value="empty">Vazio</option></Select></Field>
          <Field label="Tipo"><Select value={filters.type} onChange={(event) => update('type', event.target.value)}><option value="">Todos</option>{options('size_type').map((value) => <option key={value} value={value}>{value}</option>)}</Select></Field>
          <Field label="POL"><Select value={filters.pol} onChange={(event) => update('pol', event.target.value)}><option value="">Todos</option>{options('pol').map((value) => <option key={value} value={value}>{value}</option>)}</Select></Field>
          <Field label="POD"><Select value={filters.pod} onChange={(event) => update('pod', event.target.value)}><option value="">Todos</option>{options('pod').map((value) => <option key={value} value={value}>{value}</option>)}</Select></Field>
          <Field label="IMO / OOG"><Select value={filters.profile} onChange={(event) => update('profile', event.target.value)}><option value="">Todos</option><option value="imo">IMO</option><option value="oog">OOG</option><option value="standard">Sem IMO nem OOG</option></Select></Field>
          <Field label="SOC/COC"><Select value={filters.ownership} onChange={(event) => update('ownership', event.target.value)}><option value="">Todos</option><option value="SOC">SOC</option><option value="COC">COC</option><option value="none">Não informado</option></Select></Field>
        </div>
      </FilterBar>

      <Card className="overflow-hidden p-0">
        <div className="app-cargo-toolbar">
          <h2 className="app-cargo-panel__title">Containers do Baplie</h2>
          <span className="app-cargo-toolbar__hint">{filtered.length === containers.length ? plural(containers.length, 'container', 'containers') : `${filtered.length.toLocaleString('pt-BR')} de ${plural(containers.length, 'container', 'containers')}`}</span>
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            title="Nenhum container neste recorte"
            description="Nenhum container do Baplie atende aos filtros aplicados."
            action={<Button variant="secondary" onClick={() => onFiltersChange(EMPTY_CONTAINER_FILTERS)}>Limpar filtros</Button>}
          />
        ) : narrow ? (
          <ul className="app-cargo-cards" aria-label="Containers do Baplie">
            {paginated.map(({ container: c, coverage }) => (
              <li key={c.id} className="app-cargo-card">
                <div className="app-cargo-card__head">
                  <div className="app-cargo-card__id">
                    <span className="app-cargo-code app-cargo-id">{c.container_number}</span>
                    <span className="app-cargo-cell__sub">{[c.status === 'empty' ? 'Vazio' : 'Cheio', c.size_type, `${c.pol ?? '—'} → ${c.pod ?? '—'}`, c.slot ? `slot ${c.slot}` : null].filter(Boolean).join(' · ')}</span>
                  </div>
                </div>
                <span className="app-cargo-card__status">
                  <CoverageTag coverage={coverage} />
                  <ProfileTag container={c} />
                  <ContainerOwnershipBadge ownership={c.ownership} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="app-table-scroll app-table-scroll--sticky">
            <table className="app-table app-cargo-table">
              <caption className="sr-only">Containers do Baplie da viagem</caption>
              <thead>
                <tr>
                  <th scope="col" className="app-cargo-table__id">Container</th>
                  <th scope="col">Conciliação</th>
                  <th scope="col">Status</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Trecho</th>
                  <th scope="col">Slot</th>
                  <th scope="col">IMO / OOG</th>
                  <th scope="col">SOC/COC</th>
                  <th scope="col">B/L citado</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(({ container: c, coverage }) => (
                  <tr key={c.id}>
                    <td className="app-cargo-table__id"><span className="app-cargo-code app-cargo-id">{c.container_number}</span></td>
                    <td><CoverageTag coverage={coverage} /></td>
                    <td>{c.status === 'empty' ? 'Vazio' : 'Cheio'}</td>
                    <td>{c.size_type ?? '—'}</td>
                    <td className="whitespace-nowrap">{c.pol ?? '—'} → {c.pod ?? '—'}</td>
                    <td className="app-cargo-code">{c.slot ?? '—'}</td>
                    <td><ProfileTag container={c} /></td>
                    <td><ContainerOwnershipBadge ownership={c.ownership} /></td>
                    <td className="app-cargo-code">{c.bl_ref ?? <span className="app-cargo-cell__muted" aria-label="Não citado">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > 0 ? (
          <TableFooterPagination
            page={page}
            pageSize={pageSize}
            totalCount={filtered.length}
            totalPages={totalPages}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
          />
        ) : null}
      </Card>
    </>
  )
}

function CoverageTag({ coverage }: { coverage: ReturnType<typeof describeRowCoverage> }) {
  if (!coverage) return <span className="app-cargo-cell__muted" aria-label="Conciliação indisponível">—</span>
  return <Badge tone={coverage.tone}>{coverage.label}</Badge>
}

function ProfileTag({ container }: { container: BaplieContainer }) {
  if (!container.is_imo && !container.is_oog) return <span className="app-cargo-cell__muted" aria-label="Sem IMO nem OOG">—</span>
  const detail = container.is_imo ? [container.imo_class ? `classe ${container.imo_class}` : null, container.un_number ? `ONU ${container.un_number}` : null].filter(Boolean).join(' · ') : ''
  return (
    <span className="app-cargo-cell__stack">
      <CargoProfileBadge isImo={Boolean(container.is_imo)} isOog={Boolean(container.is_oog)} />
      {detail ? <span className="app-cargo-cell__sub">{detail}</span> : null}
    </span>
  )
}

function BaplieUploadModal({
  voyages,
  onClose,
  onImported,
  initialVoyageId,
}: {
  voyages: readonly VoyageOption[]
  onClose: () => void
  onImported: (importedVoyageId: string) => Promise<void>
  initialVoyageId: string
}) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [voyageId, setVoyageId] = useState(initialVoyageId)
  const { file, preview: parsed, parsing, progress, readFile, cancel: cancelReading } = useCancellableFileRead<Awaited<ReturnType<typeof parseBaplieFile>>>(parseBaplieFile)
  const [submitting, setSubmitting] = useState(false)
  const [excludedPods, setExcludedPods] = useState<Set<string>>(new Set())
  const [readError, setReadError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  // Baplie gravado, mas IMO/OOG não aplicados aos B/Ls: falha parcial que fica à vista.
  const [partial, setPartial] = useState<{ message: string; summary: string } | null>(null)

  function handleClose() {
    cancelReading()
    onClose()
  }

  async function handleFiles(files: File[]) {
    setExcludedPods(new Set())
    setReadError(null)
    setImportError(null)
    try {
      await readFile(files[0] ?? null)
    } catch (err) {
      setReadError(err instanceof Error ? err.message : 'Não foi possível ler o arquivo. Verifique o formato EDI.')
    }
  }

  function togglePod(pod: string) {
    setExcludedPods((prev) => {
      const next = new Set(prev)
      if (next.has(pod)) next.delete(pod)
      else next.add(pod)
      return next
    })
  }

  const pods = parsed?.pods ?? []
  const filteredContainers = (parsed?.containers ?? []).filter((c) => !c.pod || !excludedPods.has(c.pod))
  const issues = parsed?.issues ?? []
  const canImport = Boolean(parsed && voyageId && canImportPreview(filteredContainers.length > 0, issues))
  const destination = voyageLabel(voyages, voyageId)

  async function handleImport() {
    if (!canImport || !user) return
    setSubmitting(true)
    setImportError(null)
    try {
      const result = await reimportBaplie({
        voyageId: Number(voyageId),
        containers: filteredContainers,
        actorId: user.id,
        confirmReplacement: (plan) => confirm(baplieReplacementConfirmOptions(plan, filteredContainers.length)),
      })
      if (result.status === 'cancelled') return
      await onImported(voyageId)
      if (result.flagsError) {
        setPartial({ message: result.flagsError, summary: baplieImportToast(result) })
        return
      }
      showToast(baplieImportToast(result), 'success')
      handleClose()
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Falha ao importar Baplie EDI.')
      await onImported(voyageId)
    } finally {
      setSubmitting(false)
    }
  }

  let footnote = 'Nada é gravado antes de você conferir a prévia e confirmar.'
  if (partial) footnote = 'Baplie gravado; falta aplicar IMO/OOG aos B/Ls.'
  else if (parsing) footnote = 'Lendo o arquivo. Nada foi gravado.'
  else if (parsed && !voyageId) footnote = 'Escolha a viagem de destino para importar.'
  else if (parsed && !canImport) footnote = filteredContainers.length ? 'Há erro na prévia; corrija o arquivo e escolha de novo.' : 'Nenhum container selecionado para importar.'
  else if (parsed) footnote = `${plural(filteredContainers.length, 'container será gravado', 'containers serão gravados')}. Se a viagem já tem Baplie, você confere a diferença antes de substituir.`

  return (
    <Modal open onClose={handleClose} title="Importar Baplie EDI">
      <div className="app-import">
        <VoyageCombobox
          required
          label="Viagem de destino"
          disabled={submitting || Boolean(partial)}
          selectedVoyageId={voyageId}
          onSelect={(id) => setVoyageId(id == null ? '' : String(id))}
        />
        <ImportGuide
          requiredLabel="Formato"
          required="Baplie EDIFACT do plano de estiva da viagem."
          details={<p>Reimportar substitui o Baplie inteiro da viagem. Com diferença, a lista do que entra, sai ou muda aparece antes de confirmar; sem diferença, o arquivo é aceito direto e os vazios ficam como estão.</p>}
        />
        <ImportFilePicker accept=".edi,.txt,.edi2,.bpl" files={file ? [file] : []} onFiles={(files) => void handleFiles(files)} disabled={submitting || Boolean(partial)} />
        {parsing ? <ImportReadProgress progress={progress} /> : null}
        {readError ? (
          <ImportNotice tone="danger" role="alert" title="Não foi possível ler o arquivo">
            <p>{readError}</p>
            <p>Confira se é o Baplie EDIFACT da viagem e escolha de novo.</p>
          </ImportNotice>
        ) : null}
        {parsed ? (
          <ImportSection
            title="Prévia"
            aside={
              <SummaryStrip
                label="Resumo do Baplie"
                items={[
                  { label: filteredContainers.length === 1 ? 'container' : 'containers', value: filteredContainers.length },
                  { label: 'cheios', value: filteredContainers.filter((c) => c.status === 'full').length },
                  { label: 'IMO', value: filteredContainers.filter((c) => c.is_imo).length },
                  { label: 'OOG', value: filteredContainers.filter((c) => c.is_oog).length },
                ]}
              />
            }
          >
            <p className="app-import-inspection app-import-inspection__line">
              <span>No arquivo: <strong>{parsed.vessel_name || parsed.voyage_number ? `${parsed.vessel_name ?? '—'} / ${parsed.voyage_number ?? '—'}` : 'navio e viagem não informados'}</strong></span>
              <span>Destino: <strong>{destination ?? (voyageId ? 'viagem escolhida' : 'escolha a viagem')}</strong></span>
            </p>
            {pods.length > 0 ? (
              <fieldset className="app-import-pods">
                <legend>Portos de descarga a importar (desmarque os que não são desta operação)</legend>
                {pods.map((pod) => (
                  <label key={pod}>
                    <input type="checkbox" checked={!excludedPods.has(pod)} onChange={() => togglePod(pod)} disabled={Boolean(partial)} />
                    {pod}
                  </label>
                ))}
              </fieldset>
            ) : null}
            <ImportIssuesPanel issues={issues} filename="baplie-issues.csv" />
          </ImportSection>
        ) : null}
        {importError ? (
          <ImportNotice tone="danger" role="alert" title="A importação não foi concluída">
            <p>{importError}</p>
            <p>A prévia continua aqui; confirme de novo quando o problema for resolvido.</p>
          </ImportNotice>
        ) : null}
        {partial ? (
          <ImportNotice tone="warning" role="alert" title="Baplie importado, mas IMO/OOG não foram aplicados aos B/Ls">
            <p>{partial.summary}</p>
            <p>{partial.message}</p>
            <p>Para tentar de novo, importe o mesmo arquivo: sem diferença, ele é aceito direto e a aplicação é refeita.</p>
          </ImportNotice>
        ) : null}
        <div className="app-modal__actions">
          <ImportFootnote tone={partial || (parsed && !canImport) ? 'warning' : 'default'}>{footnote}</ImportFootnote>
          {partial ? (
            <Button onClick={handleClose}>Concluir</Button>
          ) : (
            <>
              <Button variant="secondary" disabled={submitting} onClick={parsing ? cancelReading : handleClose}>{parsing ? 'Interromper leitura' : 'Voltar'}</Button>
              <Button disabled={!canImport || parsing} loading={submitting} loadingLabel="Importando…" onClick={() => void handleImport()}>
                {canImport ? `Importar Baplie (${plural(filteredContainers.length, 'container', 'containers')})` : 'Importar Baplie'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
