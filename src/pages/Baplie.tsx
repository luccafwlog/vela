import { useMemo, useState, type ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload, Download, Boxes } from 'lucide-react'
import { exportBaplieWorkbook } from '../services/exports'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Input'
import { TableFooterPagination } from '../components/ui/TableFooterPagination'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { VoyageCombobox } from '../components/shared/VoyageCombobox'
import { useAuth } from '../hooks/useAuth'
import { useVoyages } from '../hooks/useBls'
import { useCancellableFileRead } from '../hooks/useCancellableFileRead'
import { parseBaplieFile } from '../services/baplieParser'
import { importBaplieStaging } from '../services/baplieImport'
import { hasBlsForVoyage, listBaplieStaging } from '../services/baplieReadModel'
import {
  reconcileBaplieWithManifest,
  applyBapliePhysicalFlags,
  type BaplieReconciliationItem,
} from '../services/baplieReconciliation'
import {
  importVaziosFromBaplie,
  getBaplieManifestForVoyage,
  replaceVaziosFromBaplie,
} from '../services/vaziosImportacaoImport'
import type { BaplieContainer } from '../types/database'
import { formatDate } from '../lib/utils'
import { listVoyageEscalaSchedulesByVoyageIds } from '../services/voyageRouteSchedules'
import { buildVoyageRailItems, type VoyageRailItem } from '../services/voyageSummaries'
import { VoyageRail } from '../components/voyages/VoyageRail'
import { ImportIssuesPanel } from '../components/shared/ImportIssuesPanel'
import { ImportReadProgress } from '../components/shared/ImportReadProgress'
import { canImportPreview } from '../services/importValidation'

export function Baplie() {
  const [searchParams, setSearchParams] = useSearchParams()
  const voyageId = searchParams.get('voyage') ?? ''
  const { showToast } = useToast()
  const { user, profile, isAdmin } = useAuth()
  const canImportVazios = Boolean(profile || user)
  const canUploadManifests = isAdmin
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

  const { data: stagingData, isLoading: stagingLoading } = useQuery({
    queryKey: ['baplie-staging', voyageId],
    enabled: !!voyageId,
    queryFn: () => listBaplieStaging(Number(voyageId)),
  })

  const { data: blsExist } = useQuery({
    queryKey: ['baplie-bls-exist', voyageId],
    enabled: !!voyageId,
    queryFn: () => hasBlsForVoyage(Number(voyageId)),
  })

  const { data: existingVaziosManifest, isLoading: existingVaziosManifestLoading } = useQuery({
    queryKey: ['baplie-vazios-manifest', voyageId],
    enabled: !!voyageId,
    queryFn: () => getBaplieManifestForVoyage(Number(voyageId)),
    placeholderData: null,
  })

  const { data: reconciliationData } = useQuery({
    queryKey: ['baplie-reconciliation', voyageId],
    enabled: !!voyageId && !!blsExist && (stagingData?.length ?? 0) > 0,
    queryFn: () => reconcileBaplieWithManifest(Number(voyageId)),
  })

  const containers = stagingData ?? []
  const fullContainers = containers.filter((c) => c.status === 'full')
  const emptyContainers = containers.filter((c) => c.status === 'empty')
  const imoCount = fullContainers.filter((c) => c.is_imo).length
  const oogCount = fullContainers.filter((c) => c.is_oog).length
  const divergenceCount = reconciliationData?.items.length ?? 0

  const hasStaging = containers.length > 0
  const hasManifest = !!blsExist
  const stateC = hasStaging && hasManifest

  function handleVoyageChange(value: string) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set('voyage', value)
    else next.delete('voyage')
    setSearchParams(next)
  }

  async function handleConfirmarVazios() {
    if (!user || !voyageId) return
    if (existingVaziosManifest) return
    try {
      await importVaziosFromBaplie({ voyageId: Number(voyageId), uploadedBy: user.id })
      await queryClient.invalidateQueries({ queryKey: ['baplie-vazios-manifest', voyageId] })
      await queryClient.invalidateQueries({ queryKey: ['baplie-staging', voyageId] })
      await queryClient.invalidateQueries({ queryKey: ['baplie-reconciliation', voyageId] })
      await queryClient.invalidateQueries({ queryKey: ['vazios-importacao'] })
      await queryClient.invalidateQueries({ queryKey: ['vazios-importacao-stats'] })
      // P0-4: alimenta "Vazios descarregados" no ADR.
      await queryClient.invalidateQueries({ queryKey: ['agency-report'] })
      showToast(`${emptyContainers.length} container(s) vazio(s) cadastrados em Vazios Importacao.`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao cadastrar vazios.', 'error')
    }
  }

  async function handleSubstituirVazios() {
    if (!user || !voyageId || !existingVaziosManifest) return
    try {
      await replaceVaziosFromBaplie({ voyageId: Number(voyageId), uploadedBy: user.id })
      await queryClient.invalidateQueries({ queryKey: ['baplie-vazios-manifest', voyageId] })
      await queryClient.invalidateQueries({ queryKey: ['baplie-staging', voyageId] })
      await queryClient.invalidateQueries({ queryKey: ['baplie-reconciliation', voyageId] })
      await queryClient.invalidateQueries({ queryKey: ['vazios-importacao'] })
      await queryClient.invalidateQueries({ queryKey: ['vazios-importacao-stats'] })
      await queryClient.invalidateQueries({ queryKey: ['agency-report'] })
      showToast(`Manifesto de vazios substituido. ${emptyContainers.length} container(s) recadastrado(s).`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha ao substituir vazios.', 'error')
    }
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
        description="Gestão centralizada do arquivo Baplie EDI por viagem."
        action={voyageId && containers.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={exporting} onClick={handleExport}><Download size={16} /> Exportar Baplie EDI</Button>
            {canUploadManifests ? <Button variant="secondary" onClick={() => setUploadOpen(true)}><Upload size={16} /> Reimportar Baplie EDI</Button> : null}
          </div>
        ) : null}
      />

      <section className="mb-5 min-w-0">
        {voyagesLoading ? (
          <Card><div className="py-4 text-center text-sm text-slate-400">Carregando viagens...</div></Card>
        ) : (
          <VoyageRail
            items={voyageCards}
            selectedId={voyageId ? Number(voyageId) : null}
            onSelect={(id) => handleVoyageChange(String(id))}
          />
        )}
      </section>

      <Card className="mb-5">
        <VoyageCombobox
          clearable
          label="Viagem"
          selectedVoyageId={voyageId}
          onSelect={(id) => handleVoyageChange(id == null ? '' : String(id))}
        />
      </Card>

      {!voyageId ? (
        <Card>
          <div className="py-6 text-center text-sm text-slate-400">Selecione uma viagem para continuar.</div>
        </Card>
      ) : stagingLoading ? (
        <Card>
          <div className="py-6 text-center text-sm text-slate-400">Carregando...</div>
        </Card>
      ) : !hasStaging ? (
        <StateA canImport={canUploadManifests} onUpload={() => setUploadOpen(true)} />
      ) : (
        <>
          <StatsSection
            total={containers.length}
            full={fullContainers.length}
            empty={emptyContainers.length}
            imo={imoCount}
            oog={oogCount}
            divergences={stateC && reconciliationData?.source === 'reconciled' ? divergenceCount : null}
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

          {stateC && reconciliationData ? (
            <ReconciliacaoSection
              items={reconciliationData.items}
              source={reconciliationData.source}
              pendingRoutes={reconciliationData.pendingRoutes}
            />
          ) : stateC && !reconciliationData ? (
            <Card className="mb-5">
              <div className="py-4 text-center text-sm text-slate-400">Carregando divergencias...</div>
            </Card>
          ) : null}

          <ContainerFiltersBar containers={containers} filters={containerFilters} onChange={setContainerFilters} />
          <ContainerList containers={containers} filters={containerFilters} />
        </>
      )}

      <BaplieUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onImported={async () => {
          await queryClient.invalidateQueries({ queryKey: ['baplie-staging', voyageId] })
          // Baplie soberano: aplica automaticamente as flags físicas (IMO/OOG) aos
          // bl_containers da viagem, para contagem e EDI refletirem o Baplie (#306).
          if (voyageId && user) {
            try {
              const applied = await applyBapliePhysicalFlags(Number(voyageId), user.id)
              if (applied > 0) {
                await queryClient.invalidateQueries({ queryKey: ['containers'] })
                await queryClient.invalidateQueries({ queryKey: ['voyages'] })
                // Os badges IMO/OOG do container aparecem na ficha do B/L
                // (bl-detail); sem isso, o operador via o valor antigo até F5.
                await queryClient.invalidateQueries({ queryKey: ['bl-detail'] })
              }
            } catch {
              showToast('Baplie importado, mas falha ao aplicar flags físicas ao B/L.', 'error')
            }
          }
          await queryClient.invalidateQueries({ queryKey: ['baplie-reconciliation', voyageId] })
          // P0-4: reimportar Baplie muda a divergencia de existencia de Carga
          // descarregada e a contagem de Vazios descarregados no ADR — este e
          // o callback real do import (afterBaplieImportado/
          // invalidateBaplieDependentQueries nao tem chamador na aplicacao).
          await queryClient.invalidateQueries({ queryKey: ['agency-report'] })
        }}
        initialVoyageId={voyageId}
      />
    </>
  )
}

function StateA({ canImport, onUpload }: { canImport: boolean; onUpload: () => void }) {
  return (
    <Card>
      <div className="flex flex-col items-center gap-4 py-10">
        <div className="text-sm text-slate-400">Nenhum arquivo Baplie EDI importado para esta viagem.</div>
        {canImport ? (
          <Button onClick={onUpload}>
            <Upload size={16} />
            Importar Baplie EDI
          </Button>
        ) : (
          <div className="text-sm text-amber-200">A importação Baplie exige perfil administrativo.</div>
        )}
      </div>
    </Card>
  )
}

function StatsSection({
  total, full, empty, imo, oog, divergences,
}: {
  total: number; full: number; empty: number; imo: number; oog: number; divergences: number | null
}) {
  return (
    <div className="mb-5 grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
      <StatCard label="Total" value={total} />
      <StatCard label="Cheios" value={full} />
      <StatCard label="Vazios" value={empty} />
      <StatCard label="IMO" value={imo} />
      <StatCard label="OOG" value={oog} />
      {divergences !== null ? (
        <StatCard label="Divergencias" value={divergences} tone={divergences > 0 ? 'amber' : 'green'} />
      ) : null}
    </div>
  )
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: 'amber' | 'green' }) {
  const valueClass = tone === 'amber' ? 'text-amber-400' : tone === 'green' ? 'text-emerald-400' : 'text-white'
  return (
    <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${valueClass}`}>{value}</div>
    </div>
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
  const { showToast } = useToast()

  async function run(fn: () => Promise<void>) {
    setLoading(true)
    try { await fn() } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro.', 'error')
    } finally { setLoading(false) }
  }

  const isCountMismatch = existingManifest && existingManifest.total_containers !== emptyCount

  return (
    <Card className="mb-5">
      <div className="text-sm font-semibold text-white mb-3">Vazios de Importação</div>
      {loadingExistingManifest ? (
        <div className="rounded-xl border border-slate-500/30 bg-slate-500/5 p-4 text-sm text-slate-300">
          Verificando manifesto de vazios existente...
        </div>
      ) : existingManifest ? (
        <div className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
          isCountMismatch
            ? 'border-amber-500/30 bg-amber-500/10'
            : 'border-[var(--app-border)] bg-[var(--app-surface-muted)]'
        }`}>
          <div>
            <div className={`text-sm font-medium ${isCountMismatch ? 'text-amber-200' : 'text-slate-200'}`}>
              Manifesto de vazios Baplie cadastrado em{' '}
              <span className="font-semibold">{formatDate(existingManifest.imported_at)}</span> com{' '}
              {existingManifest.total_containers} container(s).
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {isCountMismatch
                ? `O arquivo Baplie atual possui ${emptyCount} container(s) vazio(s). Clique em atualizar para sincronizar.`
                : 'Containers vazios vinculados à operação de Vazios de Importação da viagem.'}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/vazios-importacao?voyage=${voyageId}`}
              className="app-btn app-btn--secondary text-xs"
            >
              Ver em Vazios
            </Link>
            {canWrite && isCountMismatch ? (
              <Button variant="secondary" loading={loading} onClick={() => run(onSubstituir)}>
                Atualizar Vazios do Baplie
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div className="text-sm text-slate-400">{emptyCount} container(s) vazio(s) aguardando cadastro em Vazios Importacao.</div>
          {canWrite ? (
            <Button disabled={loadingExistingManifest} loading={loading} onClick={() => run(onConfirmar)}>
              Confirmar cadastro de {emptyCount} vazio(s)
            </Button>
          ) : null}
        </div>
      )}
    </Card>
  )
}

function formatRouteKey(route: string) {
  const [pol, pod] = route.split('::')
  return `${pol} → ${pod}`
}

function PendingRoutesNote({ routes }: { routes: string[] }) {
  if (!routes.length) return null
  return (
    <p className="mt-1 text-xs text-slate-500">
      Rotas do Baplie ainda sem B/L com containers e por isso fora da conciliação:{' '}
      <span className="text-slate-400">{routes.map(formatRouteKey).join(', ')}</span>.
    </p>
  )
}

function ReconciliacaoSection({
  items,
  source,
  pendingRoutes = [],
}: {
  items: BaplieReconciliationItem[]
  source?: 'not_imported' | 'awaiting_route_coverage' | 'reconciled'
  pendingRoutes?: string[]
}) {
  if (source === 'awaiting_route_coverage') {
    return (
      <Card className="mb-5">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-blue-500/20 p-2 text-blue-400">
            <Boxes size={18} />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">Aguardando cobertura de rotas de B/L</div>
            <div className="text-xs text-slate-400 mt-0.5">
              Nenhuma rota de containers cheios prevista pelo EDI tem B/L com containers importado. Cada rota entra na conciliação assim que receber ao menos um B/L com containers.
            </div>
            <PendingRoutesNote routes={pendingRoutes} />
          </div>
        </div>
      </Card>
    )
  }

  const missing = items.filter(
    (item): item is Extract<BaplieReconciliationItem, { kind: 'missing_in_manifest' }> =>
      item.kind === 'missing_in_manifest',
  )
  const missingInBaplie = items.filter(
    (item): item is Extract<BaplieReconciliationItem, { kind: 'missing_in_baplie' }> =>
      item.kind === 'missing_in_baplie',
  )

  if (!items.length) {
    return (
      <Card className="mb-5">
        <div className="py-4 text-center text-sm text-emerald-400">Sem divergências de existência entre Baplie e B/Ls. Flags físicas (IMO/OOG) do Baplie aplicadas automaticamente.</div>
        <div className="text-center"><PendingRoutesNote routes={pendingRoutes} /></div>
      </Card>
    )
  }

  return (
    <Card className="mb-5 overflow-hidden p-0">
      <div className="border-b border-[#30363d] px-4 py-3">
        <div className="text-sm font-semibold text-white">
          Divergências de existência Baplie × B/L
          <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-normal text-amber-400">
            {items.length}
          </span>
        </div>
        <div className="text-xs text-slate-500 mt-0.5">Baplie é soberano nas flags físicas (IMO/OOG) e já foram aplicadas ao B/L. Aqui só aparecem containers presentes em uma fonte e ausentes na outra.</div>
        <PendingRoutesNote routes={pendingRoutes} />
      </div>

      {missing.length > 0 ? (
        <div className="border-b border-[#30363d] p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
            Containers no Baplie sem B/L ({missing.length})
          </div>
          <div className="max-h-[360px] overflow-auto rounded-xl border border-[#30363d]">
            <table className="app-table app-table--compact min-w-[400px] text-left text-sm">
              <thead className="sticky top-0 bg-[#0d1117] text-xs uppercase text-slate-500 z-10">
                <tr>
                  <th scope="col" className="px-3 py-2">Container</th>
                  <th scope="col" className="px-3 py-2">B/L ref. (Baplie)</th>
                  <th scope="col" className="px-3 py-2">Slot</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {missing.map((item) => (
                  <tr key={item.container_number}>
                    <td className="px-3 py-2 font-semibold text-white">{item.container_number}</td>
                    <td className="px-3 py-2">{item.baplie_bl_ref ?? '-'}</td>
                    <td className="px-3 py-2">{item.slot ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-slate-500">Acao necessaria: acionar armador para verificar manifesto.</p>
        </div>
      ) : null}

      {missingInBaplie.length > 0 ? (
        <div className="p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-400">
            Containers em B/L ausentes do Baplie ({missingInBaplie.length})
          </div>
          <div className="max-h-[360px] overflow-auto rounded-xl border border-[#30363d]">
            <table className="app-table app-table--compact min-w-[400px] text-left text-sm">
              <thead className="sticky top-0 bg-[#0d1117] text-xs uppercase text-slate-500 z-10">
                <tr>
                  <th scope="col" className="px-3 py-2">Container</th>
                  <th scope="col" className="px-3 py-2">B/L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]">
                {missingInBaplie.map((item) => (
                  <tr key={item.container_number}>
                    <td className="px-3 py-2 font-semibold text-white">{item.container_number}</td>
                    <td className="px-3 py-2">{item.bl_id ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-slate-500">Ação: conferir se o container foi embarcado / atualizar o Baplie.</p>
        </div>
      ) : null}
    </Card>
  )
}

type ContainerFilters = {
  container: string
  status: string
  type: string
  pol: string
  pod: string
  slot: string
  profile: string
}

const EMPTY_CONTAINER_FILTERS: ContainerFilters = {
  container: '', status: '', type: '', pol: '', pod: '', slot: '', profile: '',
}

function ContainerFiltersBar({
  containers,
  filters,
  onChange,
}: {
  containers: BaplieContainer[]
  filters: ContainerFilters
  onChange: (filters: ContainerFilters) => void
}) {
  const options = (field: keyof BaplieContainer) => Array.from(new Set(containers.map((container) => String(container[field] ?? '').trim()).filter(Boolean))).sort()
  const update = (field: keyof ContainerFilters, value: string) => onChange({ ...filters, [field]: value })
  return (
    <Card className="mb-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-white">Filtros de containers</div>
        <Button variant="ghost" onClick={() => onChange(EMPTY_CONTAINER_FILTERS)}>Limpar filtros</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Container"><Input value={filters.container} onChange={(event) => update('container', event.target.value)} placeholder="Buscar container" /></Field>
        <Field label="Status"><Select value={filters.status} onChange={(event) => update('status', event.target.value)}><option value="">Todos</option><option value="full">Cheio</option><option value="empty">Vazio</option></Select></Field>
        <Field label="Tipo"><Select value={filters.type} onChange={(event) => update('type', event.target.value)}><option value="">Todos</option>{options('size_type').map((value) => <option key={value} value={value}>{value}</option>)}</Select></Field>
        <Field label="POL"><Select value={filters.pol} onChange={(event) => update('pol', event.target.value)}><option value="">Todos</option>{options('pol').map((value) => <option key={value} value={value}>{value}</option>)}</Select></Field>
        <Field label="POD"><Select value={filters.pod} onChange={(event) => update('pod', event.target.value)}><option value="">Todos</option>{options('pod').map((value) => <option key={value} value={value}>{value}</option>)}</Select></Field>
        <Field label="Slot"><Input value={filters.slot} onChange={(event) => update('slot', event.target.value)} placeholder="Buscar slot" /></Field>
        <Field label="Perfil"><Select value={filters.profile} onChange={(event) => update('profile', event.target.value)}><option value="">Todos</option><option value="imo">IMO</option><option value="oog">OOG</option><option value="standard">Padrão</option></Select></Field>
      </div>
    </Card>
  )
}

function filterBaplieContainers(containers: BaplieContainer[], filters: ContainerFilters) {
  const normalized = (value: string) => value.trim().toLowerCase()
  return containers.filter((container) => {
    const profile = container.is_imo ? 'imo' : container.is_oog ? 'oog' : 'standard'
    return normalized(container.container_number).includes(normalized(filters.container))
      && (!filters.status || container.status === filters.status)
      && (!filters.type || container.size_type === filters.type)
      && (!filters.pol || container.pol === filters.pol)
      && (!filters.pod || container.pod === filters.pod)
      && normalized(container.slot ?? '').includes(normalized(filters.slot))
      && (!filters.profile || profile === filters.profile)
  })
}

function ContainerList({ containers, filters }: { containers: BaplieContainer[]; filters: ContainerFilters }) {
  const [page, setPage] = useState(1)
  const pageSize = 20
  const filtered = useMemo(() => filterBaplieContainers(containers, filters), [containers, filters])
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)
  const filterKey = JSON.stringify(filters)
  const [previousFilterKey, setPreviousFilterKey] = useState(filterKey)
  if (filterKey !== previousFilterKey) {
    setPreviousFilterKey(filterKey)
    setPage(1)
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-[#30363d] px-4 py-3">
        <div className="text-sm font-semibold text-white">Containers em staging</div>
        <div className="text-xs text-slate-500 mt-0.5">{filtered.length} de {containers.length} container(s) importado(s) do arquivo EDI</div>
      </div>
      <div className="app-table-scroll">
        <table className="app-table app-table--compact min-w-[760px] text-left text-sm whitespace-nowrap">
          <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-3">Container</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3">Tipo</th>
              <th scope="col" className="px-4 py-3">POL</th>
              <th scope="col" className="px-4 py-3">POD</th>
              <th scope="col" className="px-4 py-3">Slot</th>
              <th scope="col" className="px-4 py-3">Perfil</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#30363d]">
            {paginated.map((c) => (
              <tr key={c.id} className="hover:bg-[#21262d]/60">
                <td className="px-4 py-3 font-semibold text-white">{c.container_number}</td>
                <td className="px-4 py-3">
                  <Badge tone={c.status === 'empty' ? 'slate' : 'blue'}>
                    {c.status === 'empty' ? 'Vazio' : 'Cheio'}
                  </Badge>
                </td>
                <td className="px-4 py-3">{c.size_type ?? '-'}</td>
                <td className="px-4 py-3">{c.pol ?? '-'}</td>
                <td className="px-4 py-3">{c.pod ?? '-'}</td>
                <td className="px-4 py-3">{c.slot ?? '-'}</td>
                <td className="px-4 py-3">
                  {c.is_imo ? (
                    <Badge tone="red">IMO</Badge>
                  ) : c.is_oog ? (
                    <Badge tone="yellow">OOG</Badge>
                  ) : (
                    <Badge tone="blue">Padrao</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 ? (
        <TableFooterPagination
          page={page}
          pageSize={pageSize}
          totalCount={filtered.length}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      ) : null}
    </Card>
  )
}

function BaplieUploadModal({
  open,
  onClose,
  onImported,
  initialVoyageId,
}: {
  open: boolean
  onClose: () => void
  onImported: () => void
  initialVoyageId: string
}) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [voyageId, setVoyageId] = useState(initialVoyageId)
  const { preview: parsed, parsing, progress, readFile, cancel: cancelReading } = useCancellableFileRead<Awaited<ReturnType<typeof parseBaplieFile>>>(parseBaplieFile)
  const [submitting, setSubmitting] = useState(false)
  const [excludedPods, setExcludedPods] = useState<Set<string>>(new Set())

  // Re-baseia a viagem ao abrir o modal — ajuste durante o render,
  // mantendo o gatilho original (open ou initialVoyageId mudou).
  const [prevSync, setPrevSync] = useState({ open, initialVoyageId })
  if (open !== prevSync.open || initialVoyageId !== prevSync.initialVoyageId) {
    setPrevSync({ open, initialVoyageId })
    if (open) setVoyageId(initialVoyageId)
  }

  function handleClose() {
    cancelReading()
    setExcludedPods(new Set())
    onClose()
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const f = event.target.files?.[0] ?? null
    setExcludedPods(new Set())
    try {
      await readFile(f)
    } catch {
      showToast('Não foi possível ler o arquivo. Verifique o formato EDI.', 'error')
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

  const filteredContainers = (parsed?.containers ?? []).filter((c) => !c.pod || !excludedPods.has(c.pod))
  const canImport = Boolean(parsed && voyageId && canImportPreview(filteredContainers.length > 0, parsed.issues))

  async function handleImport() {
    if (!canImport || !user) return
    setSubmitting(true)
    try {
      const { staged } = await importBaplieStaging(Number(voyageId), filteredContainers, user.id)
      showToast(`Baplie importado: ${staged} container(s) em staging.`, 'success')
      onImported()
      handleClose()
    } catch {
      showToast('Falha ao importar Baplie EDI.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const pods = parsed?.pods ?? []
  return (
    <Modal open={open} onClose={handleClose} title="Importar Baplie EDI">
      <div className="grid gap-5">
        <VoyageCombobox
          required
          label="Viagem de destino"
          selectedVoyageId={voyageId}
          onSelect={(id) => setVoyageId(id == null ? '' : String(id))}
        />

        <Field label="Arquivo .edi ou .txt">
          <Input accept=".edi,.txt,.edi2" type="file" onChange={handleFile} />
        </Field>

        {parsing ? <ImportReadProgress progress={progress} /> : null}

        {parsed ? (
          <div className="grid gap-3">
            {parsed.vessel_name || parsed.voyage_number ? (
              <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm text-slate-300">
                <div className="text-xs uppercase tracking-wider text-slate-500">Detectado no arquivo</div>
                <div className="mt-1 font-semibold text-white">
                  {parsed.vessel_name ?? '-'} / {parsed.voyage_number ?? '-'}
                </div>
              </div>
            ) : null}

            {pods.length > 0 ? (
              <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
                <div className="mb-2 text-xs uppercase tracking-wider text-slate-500">
                  Portos de descarga — desmarque os que deseja ignorar
                </div>
                <div className="flex flex-wrap gap-3">
                  {pods.map((pod) => (
                    <label key={pod} className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={!excludedPods.has(pod)}
                        onChange={() => togglePod(pod)}
                        className="accent-blue-500"
                      />
                      {pod}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
                <div className="text-xs uppercase text-slate-500">Containers</div>
                <div className="mt-1 text-2xl font-bold text-white">{filteredContainers.length}</div>
                {excludedPods.size > 0 ? (
                  <div className="mt-1 text-xs text-slate-500">de {parsed.containers.length} no arquivo</div>
                ) : null}
              </div>
              <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
                <div className="text-xs uppercase text-slate-500">IMO</div>
                <div className="mt-1 text-2xl font-bold text-white">{filteredContainers.filter((c) => c.is_imo).length}</div>
              </div>
              <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
                <div className="text-xs uppercase text-slate-500">OOG</div>
                <div className="mt-1 text-2xl font-bold text-white">{filteredContainers.filter((c) => c.is_oog).length}</div>
              </div>
            </div>
            <ImportIssuesPanel issues={parsed.issues} filename="baplie-issues.csv" />
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={submitting} onClick={parsing ? cancelReading : handleClose}>{parsing ? 'Cancelar leitura' : 'Cancelar'}</Button>
          <Button
            disabled={!canImport}
            loading={submitting}
            onClick={handleImport}
          >
            Confirmar importação
            {excludedPods.size > 0 ? ` (${filteredContainers.length} containers)` : ''}
          </Button>
        </div>
        {!voyageId ? (
          <div className="text-sm text-amber-200">Selecione uma viagem de destino para habilitar a confirmação.</div>
        ) : null}
      </div>
    </Modal>
  )
}
