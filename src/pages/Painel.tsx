import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowRight,
  Download,
  Monitor,
  RefreshCw,
  Ship,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { useToast } from '../components/ui/Toast'
import { SkeletonTable } from '../components/ui/Skeleton'
import { LineUpTable } from '../components/lineup/LineUpTable'
import { LineUpFilters } from '../components/lineup/LineUpFilters'
import { countActiveLineUpFilters, emptyLineUpFilters, filterLineUpRows, type LineUpFilters as LineUpFiltersState } from '../lib/lineupFilters'
import { fetchLineUpSnapshot } from '../services/lineup'
import { exportLineUpWorkbook } from '../services/exports'
import { markStartupStage } from '../lib/telemetry'
import { getAlertDepartmentSummary, type AlertDepartmentSummary } from '../services/alerts'
import { queryKeys } from '../services/queryKeys'
import { AGENCY_REPORT_DEPARTMENT_LABELS } from '../services/agencyDepartureReport'

const KNOWN_DEPARTMENTS = ['documentacao', 'equipamentos', 'operacoes'] as const

export function Painel() {
  const { showToast } = useToast()
  const [filters, setFilters] = useState<LineUpFiltersState>(emptyLineUpFilters)
  const [isExporting, setIsExporting] = useState(false)
  const [voyageWindow, setVoyageWindow] = useState(60)
  const {
    data: lineup,
    isLoading: isLineUpLoading,
    error: lineUpError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['lineup-tv-v3', voyageWindow],
    queryFn: () => fetchLineUpSnapshot(voyageWindow),
    staleTime: 60_000,
    refetchInterval: 90_000,
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
  const activeFilterCount = countActiveLineUpFilters(filters)

  useEffect(() => {
    if (lineup) markStartupStage('route-data')
  }, [lineup])

  async function handleExport() {
    setIsExporting(true)
    try {
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

  const mainDeptCards = KNOWN_DEPARTMENTS.map((dept) => {
    const item = summaryByDept.get(dept)
    return {
      department: dept,
      label: AGENCY_REPORT_DEPARTMENT_LABELS[dept] ?? dept,
      activeCount: Number(item?.active_count ?? 0),
      dismissedCount: Number(item?.dismissed_count ?? 0),
    }
  })

  const legacyItem = summaryByDept.get('sem_departamento')
  const legacyActiveCount = Number(legacyItem?.active_count ?? 0)
  const legacyDismissedCount = Number(legacyItem?.dismissed_count ?? 0)

  return (
    <>
      <PageHeader
        title="Painel"
        description="Quadro Line Up consolidado com navegação direta aos dados operacionais."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/chegadas-saidas" className="app-btn app-btn--secondary">
              <Ship size={14} />
              Chegadas e Saídas
            </Link>
            <Link to="/line-up-tv/display" target="_blank" rel="noreferrer" className="app-btn app-btn--secondary">
              <Monitor size={14} />
              Abrir tela TV
            </Link>
            <button type="button" onClick={() => void refetch()} className="app-btn app-btn--secondary">
              <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
              Atualizar
            </button>
            {lineup?.hasMore ? (
              <button type="button" onClick={() => setVoyageWindow((current) => Math.min(current + 60, 500))} className="app-btn app-btn--secondary">
                Carregar mais viagens
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void handleExport()}
              className="app-btn app-btn--secondary"
              disabled={rows.length === 0 || isExporting}
            >
              <Download size={14} />
              Exportar Excel
            </button>
          </div>
        }
      />

      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-400" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--app-muted)]">
              Pendências por Setor Responsável
            </h2>
          </div>
          <Link to="/alertas" className="inline-flex items-center gap-1 text-xs text-[var(--app-link)] hover:underline">
            <span>Fila completa de alertas</span>
            <ArrowRight size={12} />
          </Link>
        </div>

        {departmentSummaryError ? (
          <InlineError message="Erro ao carregar pendências por setor." />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {mainDeptCards.map((card) => (
              <Link
                key={card.department}
                to={`/alertas?departamento=${encodeURIComponent(card.department)}`}
                className="flex flex-col justify-between rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-strong)] p-3 transition-all hover:border-[var(--app-link)] hover:bg-[var(--app-surface-hover)]"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--app-muted)]">{card.label}</span>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      card.activeCount > 0
                        ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20'
                        : 'bg-slate-500/10 text-[var(--app-muted)]'
                    }`}
                  >
                    {card.activeCount} {card.activeCount === 1 ? 'pendência' : 'pendências'}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--app-muted)]">
                  <span>{card.dismissedCount > 0 ? `+ ${card.dismissedCount} dispensada(s)` : 'Nenhuma dispensa'}</span>
                  <span className="text-[var(--app-link)]">Ver fila →</span>
                </div>
              </Link>
            ))}

            {legacyActiveCount > 0 || legacyDismissedCount > 0 ? (
              <Link
                to="/alertas?departamento=sem_departamento"
                className="flex flex-col justify-between rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-strong)] p-3 transition-all hover:border-[var(--app-link)] hover:bg-[var(--app-surface-hover)]"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--app-muted)]">Sem setor / Legado</span>
                  <span className="inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-400 border border-amber-500/20">
                    {legacyActiveCount}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--app-muted)]">
                  <span>{legacyDismissedCount > 0 ? `+ ${legacyDismissedCount} dispensado(s)` : 'Linhas históricas'}</span>
                  <span className="text-[var(--app-link)]">Ver fila →</span>
                </div>
              </Link>
            ) : null}
          </div>
        )}
      </div>

      <LineUpFilters
        filters={filters}
        onChange={setFilters}
        onClear={() => setFilters(emptyLineUpFilters())}
        activeCount={activeFilterCount}
        visibleCount={rows.length}
        totalCount={lineup?.totalVoyages ?? lineup?.rows.length ?? 0}
        loading={isLineUpLoading}
      />

      {lineUpError ? <InlineError message="Erro ao carregar o Line Up TV." /> : null}

      {isLineUpLoading ? (
        <Card className="p-0 overflow-hidden">
          <SkeletonTable rows={6} cols={8} />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <LineUpTable
            rows={rows}
            emptyTitle="Nenhuma escala encontrada."
            emptyDescription="Ajuste os filtros ou aguarde o próximo ciclo de atualização."
          />
          <p className="border-t border-[var(--app-border)] px-4 py-2 text-[11px] text-[var(--app-muted)]">
            Terminal = importação/exportação · TBC = sem atribuição · Linha com barra verde = navio atracado no terminal · VIN = veículos · VIN CNTR = containers com veículos · CG = carga geral · MTY = vazios · RTW = restow ·
            BB = break-bulk (máquinas/pacotes) · CEs = status dos CEs Mercante · Linked = manifesto vinculado
          </p>
        </Card>
      )}
    </>
  )
}
