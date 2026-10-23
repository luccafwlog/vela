import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Download, Monitor, Ship } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { InlineError, PageHeader } from '../components/ui/Card'
import { Block } from '../components/ui/Block'
import { MetricCard } from '../components/ui/MetricCard'
import { StatusText } from '../components/ui/StatusText'
import { useNarrowViewport } from '../components/bl/useNarrowViewport'
import { useToast } from '../components/ui/Toast'
import { SkeletonTable } from '../components/ui/Skeleton'
import { LineUpTable } from '../components/lineup/LineUpTable'
import { LineUpFilters } from '../components/lineup/LineUpFilters'
import { countActiveLineUpFilters, emptyLineUpFilters, filterLineUpRows, type LineUpFilters as LineUpFiltersState } from '../lib/lineupFilters'
import { fetchLineUpSnapshot, type LineUpUnassignedMty } from '../services/lineup'
import { markStartupStage } from '../lib/telemetry'
import { ALERT_DEPARTMENT_LABELS, getAlertDepartmentSummary, type AlertDepartmentSummary } from '../services/alerts'
import { queryKeys } from '../services/queryKeys'

const KNOWN_DEPARTMENTS = ['documentacao', 'equipamentos', 'operacoes', 'administrativo'] as const

function deptCard(department: string, label: string, item: AlertDepartmentSummary | undefined, fallbackDetail?: string) {
  const activeCount = Number(item?.active_count ?? 0)
  const dismissedCount = Number(item?.dismissed_count ?? 0)
  const detail = dismissedCount > 0 ? `${dismissedCount} ${dismissedCount === 1 ? 'dispensado' : 'dispensados'}` : fallbackDetail
  return { department, label, activeCount, dismissedCount, detail }
}

export function Painel() {
  const { showToast } = useToast()
  const navigate = useNavigate()
  const narrow = useNarrowViewport()
  const [filters, setFilters] = useState<LineUpFiltersState>(emptyLineUpFilters)
  const [isExporting, setIsExporting] = useState(false)
  const [voyageWindow, setVoyageWindow] = useState(60)
  const {
    data: lineup,
    isLoading: isLineUpLoading,
    error: lineUpError,
  } = useQuery({
    queryKey: ['lineup-tv-v3', voyageWindow],
    queryFn: () => fetchLineUpSnapshot(voyageWindow),
    staleTime: 60_000,
    refetchInterval: 90_000,
    // "Carregar mais viagens" mantém a tabela atual até a janela maior chegar.
    placeholderData: keepPreviousData,
  })

  const { data: departmentSummary, error: departmentSummaryError } = useQuery<AlertDepartmentSummary[]>({
    queryKey: queryKeys.alerts.departmentSummary(),
    queryFn: getAlertDepartmentSummary,
    staleTime: 60_000,
    refetchInterval: 90_000,
  })

  const rows = useMemo(() => {
    // ponytail: o snapshot cobre só as 60 viagens mais recentes; paginar ou ampliar a query quando o painel precisar de histórico maior.
    return filterLineUpRows(lineup?.rows ?? [], filters)
  }, [lineup, filters])
  // Vazios sem escala seguem os filtros pela Viagem: só os das Viagens que a tabela mostra.
  // Viagem sem nenhuma linha no Line Up não tem como ser filtrada e continua no aviso.
  const unassignedMty = useMemo(() => {
    const all = new Set((lineup?.rows ?? []).map((row) => row.voyageId))
    const visible = new Set(rows.filter((row) => row.rowType !== 'export').map((row) => row.voyageId))
    return (lineup?.unassignedMty ?? []).filter((item) => visible.has(item.voyageId) || !all.has(item.voyageId))
  }, [lineup, rows])
  const activeFilterCount = countActiveLineUpFilters(filters)

  useEffect(() => {
    if (lineup) markStartupStage('route-data')
  }, [lineup])

  async function handleExport() {
    setIsExporting(true)
    try {
      // A planilha (zod, billing) só carrega no clique: fora do chunk da tela inicial.
      const { exportLineUpWorkbook } = await import('../services/exports')
      await exportLineUpWorkbook(rows)
    } catch {
      showToast('Falha ao exportar o Line Up.', 'error')
    } finally {
      setIsExporting(false)
    }
  }

  // Mapear departamentos garantindo presença dos 3 setores principais
  const summaryByDept = useMemo(() => {
    const map = new Map<string, AlertDepartmentSummary>()
    if (Array.isArray(departmentSummary)) {
      for (const item of departmentSummary) {
        map.set(item.department, item)
      }
    }
    return map
  }, [departmentSummary])

  // Um cartão por setor, inclusive o Administrativo, responsável por parte do
  // catálogo de alertas (lote 5a, achado A1). "Sem setor" (alertas anteriores
  // à divisão por setor) só aparece quando tem alerta.
  const deptCards = [
    ...KNOWN_DEPARTMENTS.map((dept) => deptCard(dept, ALERT_DEPARTMENT_LABELS[dept] ?? dept, summaryByDept.get(dept))),
    ...(summaryByDept.has('sem_departamento') ? [deptCard('sem_departamento', 'Sem setor', summaryByDept.get('sem_departamento'), 'anteriores aos setores')] : []),
  ].filter((card) => card.department !== 'sem_departamento' || card.activeCount > 0 || card.dismissedCount > 0)

  return (
    <>
      <PageHeader
        title="Painel"
        action={
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/chegadas-saidas" className="app-btn app-btn--secondary h-auto gap-3 py-2 text-left">
              <Ship size={18} aria-hidden="true" />
              <span className="flex flex-col">
                <span>Chegadas e Saídas</span>
                <span className="text-xs font-normal text-[var(--app-muted)]">programação por porto</span>
              </span>
            </Link>
            <Link to="/line-up-tv/display" target="_blank" rel="noreferrer" className="app-btn app-btn--secondary h-auto gap-3 py-2 text-left">
              <Monitor size={18} aria-hidden="true" />
              <span className="flex flex-col">
                <span>Tela TV</span>
                <span className="text-xs font-normal text-[var(--app-muted)]">abre em outra janela</span>
              </span>
            </Link>
            <button
              type="button"
              onClick={() => void handleExport()}
              className="app-btn app-btn--secondary"
              disabled={rows.length === 0 || isExporting}
            >
              <Download size={14} />
              Exportar
            </button>
          </div>
        }
      />

      {departmentSummaryError ? (
        <InlineError message="Erro ao carregar os alertas por setor." />
      ) : (
        <div className="app-metric-row" aria-label="Alertas por setor">
          {deptCards.map((card) => (
            <MetricCard
              key={card.department}
              label={card.label}
              value={card.activeCount === 0 ? 'Nenhum' : `${card.activeCount} ${card.activeCount === 1 ? 'alerta' : 'alertas'}`}
              tone={card.activeCount > 0 ? 'warning' : 'secondary'}
              detail={card.detail}
              onSelect={() => navigate(`/alertas?departamento=${encodeURIComponent(card.department)}`)}
            />
          ))}
        </div>
      )}

      <LineUpFilters
        filters={filters}
        onChange={setFilters}
        onClear={() => setFilters(emptyLineUpFilters())}
        activeCount={activeFilterCount}
      />

      {lineUpError ? <InlineError message="Erro ao carregar o Line Up." /> : null}

      <Block
        title="Line Up"
        aside={(
          <span className="flex flex-wrap items-center gap-3">
            <span>{isLineUpLoading ? '—' : `${rows.length} de ${lineup?.totalVoyages ?? lineup?.rows.length ?? 0} escalas`}</span>
            {lineup?.hasMore ? (
              <button type="button" onClick={() => setVoyageWindow((current) => Math.min(current + 60, 500))} className="app-btn app-btn--secondary app-btn--sm">
                Carregar mais viagens
              </button>
            ) : null}
          </span>
        )}
        flush
      >
        {isLineUpLoading ? (
          <SkeletonTable rows={6} cols={8} />
        ) : (
          <>
            <LineUpTable
              rows={rows}
              cards={narrow}
              emptyTitle="Nenhuma escala encontrada."
              emptyDescription="Ajuste os filtros ou aguarde o próximo ciclo de atualização."
            />
            {unassignedMty.length ? <UnassignedMtyNote items={unassignedMty} /> : null}
            <p className="border-t border-[var(--app-border-soft)] px-4 py-2 text-xs text-[var(--app-muted)]">
              Faixa verde à esquerda: navio atracado · ✓ data efetiva (ATA na coluna ETA, ATB na coluna ETB) · TBC: terminal sem atribuição ·
              VIN veículos · VIN CNTR containers com veículos · CG carga geral · MTY vazios · RTW restow · BB máquinas / packages ·
              Vinculada: manifesto vinculado à escala. Cada número abre a lista filtrada.
            </p>
          </>
        )}
      </Block>
    </>
  )
}

// Vazios de importação cujo porto não tem linha no Line Up: ficam fora das
// linhas (nunca entram no MTY de outro porto) e são listados aqui.
function UnassignedMtyNote({ items }: { items: LineUpUnassignedMty[] }) {
  const total = items.reduce((sum, item) => sum + item.count, 0)
  return (
    <p className="border-t border-[var(--app-border-soft)] px-4 py-2 text-sm">
      <StatusText tone="warning">
        {total} {total === 1 ? 'vazio de importação sem escala' : 'vazios de importação sem escala'} no Line Up:
      </StatusText>{' '}
      {items.map((item, index) => (
        <span key={`${item.voyageId}::${item.pod ?? ''}`}>
          {index > 0 ? ' · ' : null}
          <Link className="app-link" to={`/vazios-importacao?voyage=${item.voyageId}${item.pod ? `&pod=${encodeURIComponent(item.pod)}` : ''}`}>
            {item.vesselName} / {item.voyageNumber}
          </Link>{' '}
          {item.count} em {item.pod ?? 'porto não informado'}
        </span>
      ))}
    </p>
  )
}
