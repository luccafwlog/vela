import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BookOpen, ExternalLink, FilterX, History, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { useToast } from '../components/ui/Toast'
import { formatDate } from '../lib/utils'
import {
  alertEntityLink,
  alertEntityLinkLabel,
  dismissAlertItem,
  fetchAlertEntityLabels,
  formatAlertEntity,
  getAlertTypeLabel,
  getEffectiveAlertType,
  invalidateAllAlertQueries,
  listAlerts,
  ENTITY_TYPE_LABELS,
  type AlertEntityLabels,
  type AlertQueueRow,
  type AlertStatusFilter,
} from '../services/alerts'
import { queryKeys } from '../services/queryKeys'
import { AGENCY_REPORT_DEPARTMENT_LABELS } from '../services/agencyDepartureReport'

function getTomorrowDateString(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

function getDefaultReviewDateString(): string {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return d.toISOString().slice(0, 10)
}

const FILTER_TABS: { value: AlertStatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Ativos' },
  { value: 'dismissed', label: 'Dispensados' },
]

const DEPARTMENT_OPTIONS = [
  { value: 'all', label: 'Todos os setores' },
  { value: 'documentacao', label: 'Documentação' },
  { value: 'equipamentos', label: 'Equipamentos' },
  { value: 'operacoes', label: 'Operações' },
  { value: 'administrativo', label: 'Administrativo' },
  { value: 'sem_departamento', label: 'Sem setor / Legado' },
]

const SEVERITY_OPTIONS = [
  { value: 'all', label: 'Todas as severidades' },
  { value: 'critical', label: 'Crítico' },
  { value: 'normal', label: 'Normal' },
]

const ENTITY_OPTIONS = [
  { value: 'all', label: 'Todas as entidades' },
  { value: 'bl', label: 'B/L' },
  { value: 'customer', label: 'Cliente' },
  { value: 'voyage', label: 'Viagem' },
  { value: 'voyage_pod_schedule', label: 'Escala' },
  { value: 'voyage_escala_terminal', label: 'Terminal da escala' },
  { value: 'agency_departure_report', label: 'ADR' },
  { value: 'invoice', label: 'Fatura' },
  { value: 'demurrage_invoice', label: 'Invoice Demurrage' },
  { value: 'container', label: 'Container' },
  { value: 'granite_bl', label: 'Granito' },
  { value: 'pix_transaction', label: 'Transação PIX' },
]

export function Alertas() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawDept = searchParams.get('departamento') || searchParams.get('department') || 'all'
  const departmentFilter = DEPARTMENT_OPTIONS.some((opt) => opt.value === rawDept) ? rawDept : 'all'

  const [statusFilter, setStatusFilter] = useState<AlertStatusFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [severityFilter, setSeverityFilter] = useState<string>('all')
  const [entityFilter, setEntityFilter] = useState<string>('all')

  const [pagination, setPagination] = useState({ department: departmentFilter, page: 0 })
  const page = pagination.department === departmentFilter ? pagination.page : 0

  function setPage(nextPage: number | ((currentPage: number) => number)) {
    setPagination((current) => {
      const currentPage = current.department === departmentFilter ? current.page : 0
      return {
        department: departmentFilter,
        page: typeof nextPage === 'function' ? nextPage(currentPage) : nextPage,
      }
    })
  }
  const [dismissTarget, setDismissTarget] = useState<AlertQueueRow | null>(null)
  const [dismissReason, setDismissReason] = useState('')
  const [reviewBy, setReviewBy] = useState(() => getDefaultReviewDateString())

  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const activeDepartment = departmentFilter === 'all' ? undefined : departmentFilter

  const { data, isLoading, isError, error, refetch } = useQuery<AlertQueueRow[]>({
    queryKey: queryKeys.alerts.list(statusFilter, page, departmentFilter),
    queryFn: () => listAlerts(statusFilter, undefined, page, activeDepartment),
  })

  // A fila guarda a chave surrogate da entidade; o operador reconhece o
  // navio/viagem, o número da fatura ou o nome do cliente. A tradução é uma
  // consulta separada para não bloquear a lista: enquanto ela não volta, a
  // coluna mostra o id.
  const { data: entityLabels } = useQuery<AlertEntityLabels>({
    queryKey: queryKeys.alerts.entityLabels(statusFilter, page, departmentFilter),
    queryFn: () => fetchAlertEntityLabels(data ?? []),
    enabled: Boolean(data?.length),
    staleTime: 5 * 60_000,
  })

  const filteredAlerts = useMemo(() => {
    if (!data) return []
    let list = data

    if (severityFilter !== 'all') {
      list = list.filter((alert) => alert.severity === severityFilter)
    }

    if (entityFilter !== 'all') {
      list = list.filter((alert) => alert.entity_type === entityFilter)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter((alert) => {
        const messageMatch = (alert.message ?? '').toLowerCase().includes(q)
        const entityIdMatch = (alert.entity_id ?? '').toLowerCase().includes(q)
        const typeLabelMatch = getAlertTypeLabel(getEffectiveAlertType(alert)).toLowerCase().includes(q)
        const entityFormatted = formatAlertEntity(alert.entity_type, alert.entity_id, entityLabels)
        const entityLabelMatch = entityFormatted ? entityFormatted.toLowerCase().includes(q) : false
        const metadataStr = alert.metadata ? JSON.stringify(alert.metadata).toLowerCase() : ''
        const metadataMatch = metadataStr.includes(q)

        return messageMatch || entityIdMatch || typeLabelMatch || entityLabelMatch || metadataMatch
      })
    }

    return list
  }, [data, severityFilter, entityFilter, searchQuery, entityLabels])

  function closeDismissModal() {
    setDismissTarget(null)
    setDismissReason('')
  }

  const dismissMutation = useMutation({
    mutationFn: async () => {
      if (!dismissTarget?.item_id) {
        throw new Error('Alerta legado sem item não suporta dispensa estruturada.')
      }
      const trimmedReason = dismissReason.trim()
      if (!trimmedReason) {
        throw new Error('Informe o motivo da dispensa.')
      }
      if (!reviewBy) {
        throw new Error('Informe a data de revisão futura.')
      }
      const targetDate = new Date(`${reviewBy}T23:59:59Z`)
      if (Number.isNaN(targetDate.getTime()) || targetDate <= new Date()) {
        throw new Error('A data de revisão deve ser uma data futura.')
      }
      await dismissAlertItem(
        dismissTarget.item_id,
        trimmedReason,
        targetDate.toISOString(),
      )
    },
    onSuccess: async () => {
      showToast('Alerta dispensado temporariamente', 'success')
      closeDismissModal()
      await invalidateAllAlertQueries(queryClient)
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Falha ao dispensar alerta.'
      showToast(message, 'error')
    },
  })

  const requestDismissal = (alert: AlertQueueRow) => {
    if (!alert.item_id) {
      showToast(
        'Alertas legados anteriores à migração 318 são históricos e saem da fila quando a pendência é sanada.',
        'error',
      )
      return
    }
    setDismissReason('')
    setReviewBy(getDefaultReviewDateString())
    setDismissTarget(alert)
  }

  function handleDepartmentChange(newDept: string) {
    setPage(0)
    const newParams = new URLSearchParams(searchParams)
    if (newDept === 'all') {
      newParams.delete('departamento')
      newParams.delete('department')
    } else {
      newParams.set('departamento', newDept)
      newParams.delete('department')
    }
    setSearchParams(newParams)
  }

  const hasActiveFilters = searchQuery.trim().length > 0 || severityFilter !== 'all' || entityFilter !== 'all' || departmentFilter !== 'all'

  function clearFilters() {
    setSearchQuery('')
    setSeverityFilter('all')
    setEntityFilter('all')
    handleDepartmentChange('all')
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fila de Alertas Operacionais"
        description="Pendências de auditoria e operacionais com ações corretivas no sistema."
        action={(
          <Link to="/alertas/regras" className="app-btn app-btn--secondary inline-flex items-center gap-2">
            <BookOpen size={15} aria-hidden="true" />
            Regras de Alertas
          </Link>
        )}
      />

      {/* Barra de Filtros e Busca */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-1">
            {FILTER_TABS.map((tab) => (
              <Button
                key={tab.value}
                variant={statusFilter === tab.value ? 'primary' : 'secondary'}
                onClick={() => {
                  setStatusFilter(tab.value)
                  setPage(0)
                }}
              >
                {tab.label}
              </Button>
            ))}
          </div>

          <Button variant="secondary" onClick={() => void refetch()} loading={isLoading}>
            Atualizar
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-3 pt-1 border-t border-[var(--app-border)]">
          <label className="w-full sm:w-72 md:w-80">
            <span className="mb-1 block text-xs font-medium text-[var(--app-muted)]">
              Buscar (B/L, navio, cliente, CNPJ...)
            </span>
            <span className="relative block">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-muted)]" aria-hidden="true" />
              <input
                className="app-input app-alerts-search__input w-full text-xs"
                style={{ paddingLeft: '38px' }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Ex.: COSCO SHIPPING, CNPJ, BL123..."
                aria-label="Buscar alertas"
              />
            </span>
          </label>

          <div>
            <span className="mb-1 block text-xs font-medium text-[var(--app-muted)]">Setor</span>
            <select
              className="app-input app-select text-xs py-1.5 px-3 w-full sm:w-44"
              value={departmentFilter}
              aria-label="Filtrar por setor"
              onChange={(e) => handleDepartmentChange(e.target.value)}
            >
              {DEPARTMENT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="mb-1 block text-xs font-medium text-[var(--app-muted)]">Entidade</span>
            <select
              className="app-input app-select text-xs py-1.5 px-3 w-full sm:w-48"
              value={entityFilter}
              aria-label="Filtrar por tipo de entidade"
              onChange={(e) => setEntityFilter(e.target.value)}
            >
              {ENTITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="mb-1 block text-xs font-medium text-[var(--app-muted)]">Severidade</span>
            <select
              className="app-input app-select text-xs py-1.5 px-3 w-full sm:w-48"
              value={severityFilter}
              aria-label="Filtrar por severidade"
              onChange={(e) => setSeverityFilter(e.target.value)}
            >
              {SEVERITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {hasActiveFilters ? (
            <button
              type="button"
              className="app-btn app-btn--ghost inline-flex items-center gap-1 text-xs text-[var(--app-muted)] hover:text-[var(--app-text)]"
              onClick={clearFilters}
              title="Limpar todos os filtros"
            >
              <FilterX size={14} aria-hidden="true" />
              Limpar
            </button>
          ) : null}
        </div>
      </Card>

      <Card>
        {isError ? (
          <div className="p-4">
            <InlineError message={error instanceof Error ? error.message : 'Erro ao carregar fila de alertas.'} />
          </div>
        ) : null}

        <div className="app-table-scroll rounded-xl border border-[var(--app-border)]">
          <table className="app-table text-xs">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3">Severidade</th>
                <th scope="col" className="px-4 py-3">Tipo</th>
                <th scope="col" className="px-4 py-3">Responsável</th>
                <th scope="col" className="px-4 py-3">Mensagem</th>
                <th scope="col" className="px-4 py-3">Entidade</th>
                <th scope="col" className="px-4 py-3">Criação</th>
                <th scope="col" className="px-4 py-3">Status / Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--app-border)]">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[var(--app-muted)]">
                    Carregando alertas...
                  </td>
                </tr>
              ) : null}
              {!isLoading && filteredAlerts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[var(--app-muted)]">
                    {hasActiveFilters
                      ? 'Nenhum alerta corresponde aos filtros aplicados.'
                      : 'Nenhum alerta encontrado no filtro selecionado.'}
                  </td>
                </tr>
              ) : null}
              {filteredAlerts.map((alert) => (
                <AlertRow
                  key={`${alert.id}:${alert.item_id ?? getEffectiveAlertType(alert)}`}
                  alert={alert}
                  entityLabels={entityLabels}
                  isMutating={dismissMutation.isPending}
                  onDismiss={() => requestDismissal(alert)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex items-center justify-between text-xs text-[var(--app-muted)]">
        <span>
          Página {page + 1} · {filteredAlerts.length} {filteredAlerts.length === 1 ? 'item exibido' : 'itens exibidos'}
          {data && filteredAlerts.length !== data.length ? ` (de ${data.length} carregados)` : ''}
        </span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            Anterior
          </Button>
          <Button
            variant="secondary"
            disabled={!data || data.length < 100}
            onClick={() => setPage((current) => current + 1)}
          >
            Próxima
          </Button>
        </div>
      </div>

      {dismissTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dismiss-alert-modal-title"
        >
          <Card className="w-full max-w-md p-6">
            <h2 id="dismiss-alert-modal-title" className="text-base font-semibold text-[var(--app-text)]">
              Dispensar alerta temporariamente
            </h2>
            <p className="mt-1 text-xs text-[var(--app-muted)]">{dismissTarget.message}</p>

            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="dismiss-reason-input" className="block text-xs font-medium text-[var(--app-muted)]">
                  Motivo da dispensa (obrigatório para auditoria)
                </label>
                <textarea
                  id="dismiss-reason-input"
                  className="mt-1 w-full rounded border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-xs text-[var(--app-text)]"
                  rows={3}
                  value={dismissReason}
                  onChange={(e) => setDismissReason(e.target.value)}
                  placeholder="Ex.: Aguardando retorno da agência marítima até sexta."
                />
              </div>

              <div>
                <label htmlFor="dismiss-review-by-input" className="block text-xs font-medium text-[var(--app-muted)]">
                  Revisar até (o alerta reaparece após esta data)
                </label>
                <input
                  id="dismiss-review-by-input"
                  type="date"
                  min={getTomorrowDateString()}
                  className="mt-1 w-full rounded border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-xs text-[var(--app-text)]"
                  value={reviewBy}
                  onChange={(e) => setReviewBy(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={closeDismissModal}
                disabled={dismissMutation.isPending}
              >
                Voltar
              </Button>
              <Button
                variant="primary"
                onClick={() => dismissMutation.mutate()}
                loading={dismissMutation.isPending}
                disabled={!dismissReason.trim() || !reviewBy}
              >
                Confirmar dispensa
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

function AlertRow({
  alert,
  entityLabels,
  isMutating,
  onDismiss,
}: {
  alert: AlertQueueRow
  entityLabels?: AlertEntityLabels
  isMutating: boolean
  onDismiss: () => void
}) {
  const isDismissed = Boolean(alert.dismissed_until && new Date(alert.dismissed_until) > new Date())
  const effectiveType = getEffectiveAlertType(alert)
  const link = alertEntityLink(alert)
  const linkLabel = alertEntityLinkLabel(alert)

  const entityFormatted = formatAlertEntity(alert.entity_type, alert.entity_id, entityLabels)

  return (
    <tr>
      <td className="px-4 py-3">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
            alert.severity === 'critical'
              ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20'
              : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20'
          }`}
        >
          {alert.severity === 'critical' ? 'Crítico' : 'Normal'}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={14} className="shrink-0 text-amber-700 dark:text-amber-400" />
          <span className="text-xs text-[var(--app-text)]">{getAlertTypeLabel(effectiveType)}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-[var(--app-muted)] whitespace-nowrap">
        {alert.department ? (
          <span>{AGENCY_REPORT_DEPARTMENT_LABELS[alert.department] ?? alert.department}</span>
        ) : (
          <span className="text-[var(--app-muted-soft)]">—</span>
        )}
      </td>
      <td className="max-w-sm px-4 py-3 text-[var(--app-text)]">{alert.message}</td>
      <td className="px-4 py-3 text-[var(--app-muted)]">
        {entityFormatted ? (
          <span className="text-xs">{entityFormatted}</span>
        ) : alert.entity_type ? (
          <span className="font-mono text-xs">
            {ENTITY_TYPE_LABELS[alert.entity_type] ?? alert.entity_type}
            {alert.entity_id ? ` ${alert.entity_id}` : ''}
          </span>
        ) : (
          <span className="text-[var(--app-muted)]">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-[var(--app-muted)]">{formatDate(alert.created_at)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {link ? (
            <Link
              to={link}
              className="app-btn app-btn--secondary inline-flex items-center gap-1.5 text-xs whitespace-nowrap"
            >
              <span>{linkLabel}</span>
              <ExternalLink size={12} className="shrink-0 text-[var(--app-muted)]" />
            </Link>
          ) : null}
          {isDismissed ? (
            <div className="flex flex-col gap-0.5">
              <span
                className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400"
                title={alert.dismissal_reason ?? ''}
              >
                <History size={12} />
                <span>Dispensado até {formatDate(alert.dismissed_until)}</span>
              </span>
              {alert.dismissal_reason ? (
                <span className="text-[10px] text-[var(--app-muted)] max-w-xs truncate" title={alert.dismissal_reason}>
                  Motivo: {alert.dismissal_reason}
                </span>
              ) : null}
              {alert.dismissed_by_name || alert.dismissed_by ? (
                <span className="text-[10px] text-[var(--app-muted)]">
                  Por: {alert.dismissed_by_name ?? alert.dismissed_by}
                </span>
              ) : null}
            </div>
          ) : alert.item_id ? (
            <Button variant="secondary" onClick={onDismiss} disabled={isMutating}>
              Dispensar
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  )
}
