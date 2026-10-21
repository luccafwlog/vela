import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { BellOff, ChevronDown, ChevronRight, RotateCcw, Wrench } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { RowActionButton } from '../components/ui/RowActionButton'
import { NoValue } from '../components/ui/NoValue'
import { InlineError, PageHeader } from '../components/ui/Card'
import { Block, Fact, FactList } from '../components/ui/Block'
import { MetricCard } from '../components/ui/MetricCard'
import { Modal } from '../components/ui/Modal'
import { StatusText } from '../components/ui/StatusText'
import { Field, Input, Select, Textarea } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { useConfirmWithReason } from '../components/ui/ConfirmDialog'
import { useNarrowViewport } from '../components/bl/useNarrowViewport'
import { formatDate, formatDateTime } from '../lib/utils'
import {
  ALERT_DEPARTMENT_LABELS,
  alertEntityLink,
  alertEntityLinkLabel,
  alertRecord,
  canResolveWithJustification,
  dismissAlertItem,
  fetchAlertEntityLabels,
  formatAlertEntity,
  getAlertDepartmentSummary,
  getAlertTypeLabel,
  consigneesNearEta,
  hasNearEtaMark,
  getEffectiveAlertType,
  importEffectRetryTarget,
  invalidateAllAlertQueries,
  listAlerts,
  resolveAlertItemWithJustification,
  type AlertDepartmentSummary,
  type AlertEntityLabels,
  type AlertQueueRow,
} from '../services/alerts'
import { queryKeys } from '../services/queryKeys'
import { retryImportEffect } from '../services/importEffects'

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

/** Cartões que filtram a fila (lote 5a). Abre em Ativos; não há "Todos". */
type AlertLens = 'ativos' | 'criticos' | 'dispensados'

const DEPARTMENT_OPTIONS = [
  { value: 'all', label: 'Todos os setores' },
  { value: 'documentacao', label: 'Documentação' },
  { value: 'equipamentos', label: 'Equipamentos' },
  { value: 'operacoes', label: 'Operações' },
  { value: 'administrativo', label: 'Administrativo' },
  { value: 'sem_departamento', label: 'Sem setor' },
]

const SEVERITY_OPTIONS = [
  { value: 'all', label: 'Todas' },
  { value: 'critical', label: 'Crítico' },
  { value: 'normal', label: 'Normal' },
]

const ENTITY_OPTIONS = [
  { value: 'all', label: 'Todos' },
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

function sumSummary(summary: AlertDepartmentSummary[] | undefined, department: string, field: 'active_count' | 'dismissed_count') {
  if (!summary) return null
  return summary
    .filter((row) => department === 'all' || row.department === department)
    .reduce((total, row) => total + Number(row[field] ?? 0), 0)
}

export function Alertas() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawDept = searchParams.get('departamento') || searchParams.get('department') || 'all'
  const departmentFilter = DEPARTMENT_OPTIONS.some((opt) => opt.value === rawDept) ? rawDept : 'all'

  const [lens, setLens] = useState<AlertLens>('ativos')
  const statusFilter = lens === 'dispensados' ? 'dismissed' : 'active'
  const [searchQuery, setSearchQuery] = useState('')
  const [severityFilter, setSeverityFilter] = useState<string>('all')
  const [entityFilter, setEntityFilter] = useState<string>('all')
  const [openDismissedId, setOpenDismissedId] = useState<string | null>(null)
  const narrow = useNarrowViewport()

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
  const confirmWithReason = useConfirmWithReason()
  const navigate = useNavigate()

  const activeDepartment = departmentFilter === 'all' ? undefined : departmentFilter

  const { data, isLoading, isError, error } = useQuery<AlertQueueRow[]>({
    queryKey: queryKeys.alerts.list(statusFilter, page, departmentFilter),
    queryFn: () => listAlerts(statusFilter, undefined, page, activeDepartment),
  })

  // Ativos e Dispensados contam pelo resumo por setor (a fila inteira, não a
  // página); Críticos conta a página de ativos carregada.
  // ponytail: com mais de 100 ativos, "Críticos" conta só a primeira página;
  // o caminho é devolver a contagem por gravidade no resumo por setor.
  const { data: summary } = useQuery<AlertDepartmentSummary[]>({
    queryKey: queryKeys.alerts.departmentSummary(),
    queryFn: getAlertDepartmentSummary,
    staleTime: 60_000,
  })
  const { data: activePage } = useQuery<AlertQueueRow[]>({
    queryKey: queryKeys.alerts.list('active', 0, departmentFilter),
    queryFn: () => listAlerts('active', undefined, 0, activeDepartment),
  })
  const activeCount = sumSummary(summary, departmentFilter, 'active_count')
  const dismissedCount = sumSummary(summary, departmentFilter, 'dismissed_count')
  const criticalCount = activePage ? activePage.filter((alert) => alert.severity === 'critical').length : null
  // ponytail: o selo "ETA próximo" lê só a primeira página de ativos (100) do
  // setor; com mais que isso, o alerta crítico pode ficar fora e o selo some.
  // O caminho é a fila devolver o selo pronto.
  const nearEta = useMemo(() => consigneesNearEta(activePage), [activePage])

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

    if (lens === 'criticos') {
      list = list.filter((alert) => alert.severity === 'critical')
    }

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
  }, [data, lens, severityFilter, entityFilter, searchQuery, entityLabels])

  function closeDismissModal() {
    setDismissTarget(null)
    setDismissReason('')
  }

  const dismissMutation = useMutation({
    mutationFn: async () => {
      if (!dismissTarget?.item_id) {
        throw new Error('Este alerta é anterior à divisão por setor e não pode ser dispensado; ele sai da fila quando a pendência é resolvida.')
      }
      const trimmedReason = dismissReason.trim()
      if (!trimmedReason) {
        throw new Error('Informe o motivo da dispensa.')
      }
      if (!reviewBy) {
        throw new Error('Informe a data em que o alerta volta para a fila.')
      }
      const targetDate = new Date(`${reviewBy}T23:59:59Z`)
      if (Number.isNaN(targetDate.getTime()) || targetDate <= new Date()) {
        throw new Error('A data para voltar à fila deve ser futura.')
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
    setDismissReason('')
    setReviewBy(getDefaultReviewDateString())
    setDismissTarget(alert)
  }

  // Conferência sem fato de origem (ADR 0083, item 23): resolve de vez, com
  // motivo no histórico do alerta; os demais fecham sozinhos pela origem.
  const resolveMutation = useMutation({
    mutationFn: ({ itemId, reason }: { itemId: number; reason: string }) => resolveAlertItemWithJustification(itemId, reason),
    onSuccess: async () => {
      showToast('Alerta resolvido com justificativa.', 'success')
      await invalidateAllAlertQueries(queryClient)
    },
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Falha ao resolver o alerta.', 'error')
    },
  })

  async function requestResolution(alert: AlertQueueRow) {
    if (!alert.item_id) return
    const reason = await confirmWithReason({
      title: 'Resolver com justificativa',
      message: `Resolver o alerta "${getAlertTypeLabel(getEffectiveAlertType(alert))}"?`,
      consequence: 'O alerta sai da fila ativa como resolvido. A justificativa e o seu nome ficam no histórico do alerta.',
      reversibility: 'Se a situação voltar a acontecer, o sistema abre o alerta de novo.',
      reasonLabel: 'Justificativa (o que foi conferido)',
      confirmLabel: 'Resolver',
    })
    if (reason === null) return
    resolveMutation.mutate({ itemId: alert.item_id, reason })
  }

  // Efeito de importação bloqueado (ADR 0095, decisão 25): o alerta reprocessa
  // o efeito, com justificativa. O alerta fecha quando o efeito sai de
  // bloqueado e reabre se ele bloquear de novo (migrations 348 e 394).
  const reprocessMutation = useMutation({
    mutationFn: ({ effectId, reason }: { effectId: number; reason: string }) => retryImportEffect(effectId, reason),
    onSuccess: async () => {
      showToast('Efeito reenviado para a fila. Se falhar de novo, o alerta volta.', 'success')
      await Promise.all([
        invalidateAllAlertQueries(queryClient),
        queryClient.invalidateQueries({ queryKey: queryKeys.importEffects.all() }),
      ])
    },
    onError: (err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Falha ao reprocessar o efeito.', 'error')
    },
  })

  async function requestReprocess(alert: AlertQueueRow) {
    const target = importEffectRetryTarget(alert)
    if (!target) return
    const reason = await confirmWithReason({
      title: 'Reprocessar efeito de importação',
      message: `Reprocessar o efeito bloqueado${target.record ? ` de ${target.record}` : ''}?`,
      affected: {
        summary: 'Motivo do bloqueio:',
        items: [target.reason ?? 'Motivo não informado'],
      },
      consequence: 'O efeito volta para a fila e roda de novo na próxima passada. Corrija a causa antes de reprocessar.',
      reversibility: 'Se falhar de novo, o efeito volta a ficar bloqueado e o alerta reabre.',
      reasonLabel: 'Justificativa (o que foi corrigido)',
      confirmLabel: 'Reprocessar',
    })
    if (reason === null) return
    reprocessMutation.mutate({ effectId: target.effectId, reason })
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

  function selectLens(next: AlertLens) {
    setLens(next)
    setPage(0)
  }

  const hasActiveFilters = searchQuery.trim().length > 0 || severityFilter !== 'all' || entityFilter !== 'all' || departmentFilter !== 'all'

  function clearFilters() {
    setSearchQuery('')
    setSeverityFilter('all')
    setEntityFilter('all')
    handleDepartmentChange('all')
  }

  const isMutating = dismissMutation.isPending || resolveMutation.isPending || reprocessMutation.isPending
  const actions = {
    isMutating,
    onDismiss: requestDismissal,
    onResolve: (alert: AlertQueueRow) => void requestResolution(alert),
    onReprocess: (alert: AlertQueueRow) => void requestReprocess(alert),
    onNavigate: (to: string) => navigate(to),
  }
  const isDismissedLens = lens === 'dispensados'
  const blockTitle = isDismissedLens ? 'Dispensados' : lens === 'criticos' ? 'Alertas críticos' : 'Alertas ativos'
  const pluralAlerts = (count: number) => `${count} ${count === 1 ? 'alerta' : 'alertas'}`

  return (
    <>
      <PageHeader
        title="Alertas"
        action={(
          <Link to="/alertas/regras" className="app-btn app-btn--secondary">
            Regras de alertas
          </Link>
        )}
      />

      <div className="app-metric-row" role="group" aria-label="Recortes da fila">
        <MetricCard
          label="Ativos"
          value={activeCount ?? <NoValue label="Carregando" />}
          tone={(activeCount ?? 0) > 0 ? 'warning' : 'secondary'}
          detail="na fila"
          onSelect={() => selectLens('ativos')}
          selected={lens === 'ativos'}
        />
        <MetricCard
          label="Críticos"
          value={criticalCount ?? <NoValue label="Carregando" />}
          tone={(criticalCount ?? 0) > 0 ? 'warning' : 'secondary'}
          detail="entre os ativos"
          onSelect={() => selectLens('criticos')}
          selected={lens === 'criticos'}
        />
        <MetricCard
          label="Dispensados"
          value={dismissedCount ?? <NoValue label="Carregando" />}
          detail="voltam na data marcada"
          onSelect={() => selectLens('dispensados')}
          selected={lens === 'dispensados'}
        />
      </div>

      <div className="app-filter-grid mb-4">
        <Field label="Busca">
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="B/L, navio, Cliente, CNPJ ou mensagem"
            aria-label="Buscar alertas"
          />
        </Field>
        <Field label="Setor">
          <Select value={departmentFilter} onChange={(e) => handleDepartmentChange(e.target.value)}>
            {DEPARTMENT_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </Select>
        </Field>
        <Field label="Registro">
          <Select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}>
            {ENTITY_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </Select>
        </Field>
        <Field label="Gravidade">
          <Select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
            {SEVERITY_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </Select>
        </Field>
        {hasActiveFilters ? (
          <div><Button variant="ghost" onClick={clearFilters}>Limpar filtros</Button></div>
        ) : null}
      </div>

      {isError ? <InlineError message={error instanceof Error ? error.message : 'Erro ao carregar a fila de alertas.'} /> : null}

      <Block
        title={blockTitle}
        aside={isLoading ? null : pluralAlerts(filteredAlerts.length)}
        flush
      >
        {isLoading ? (
          <p className="px-4 py-8 text-center text-[var(--app-muted)]">Carregando alertas...</p>
        ) : filteredAlerts.length === 0 ? (
          <p className="px-4 py-8 text-center text-[var(--app-muted)]">
            {hasActiveFilters ? 'Nenhum alerta corresponde aos filtros aplicados.' : isDismissedLens ? 'Nenhum alerta dispensado.' : 'Nenhum alerta na fila.'}
          </p>
        ) : narrow ? (
          <ul className="grid gap-3 p-3" aria-label={blockTitle}>
            {filteredAlerts.map((alert) => (
              <li key={`${alert.id}:${alert.item_id ?? getEffectiveAlertType(alert)}`}>
                <AlertCard alert={alert} entityLabels={entityLabels} nearEta={nearEta} {...actions} />
              </li>
            ))}
          </ul>
        ) : isDismissedLens ? (
          <div className="app-table-scroll">
            <table className="app-table">
              <caption className="sr-only">Alertas dispensados</caption>
              <thead>
                <tr>
                  <th scope="col"><span className="sr-only">Abrir</span></th>
                  <th scope="col" className="app-table__text-head">Alerta</th>
                  <th scope="col" className="app-table__text-head">Registro</th>
                  <th scope="col">Dispensado até</th>
                  <th scope="col">Por</th>
                  <th scope="col">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredAlerts.map((alert) => {
                  const key = `${alert.id}:${alert.item_id ?? getEffectiveAlertType(alert)}`
                  const expanded = openDismissedId === key
                  return (
                    <DismissedRow
                      key={key}
                      alert={alert}
                      entityLabels={entityLabels}
                      expanded={expanded}
                      onToggle={() => setOpenDismissedId(expanded ? null : key)}
                      {...actions}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="app-table-scroll">
            <table className="app-table">
              <caption className="sr-only">Fila de alertas</caption>
              <thead>
                <tr>
                  <th scope="col">Gravidade</th>
                  <th scope="col" className="app-table__text-head">Alerta</th>
                  <th scope="col" className="app-table__text-head">Registro</th>
                  <th scope="col" className="app-table__text-head">Mensagem</th>
                  <th scope="col">Setor</th>
                  <th scope="col">Aberto em</th>
                  <th scope="col">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredAlerts.map((alert) => (
                  <AlertRow
                    key={`${alert.id}:${alert.item_id ?? getEffectiveAlertType(alert)}`}
                    alert={alert}
                    entityLabels={entityLabels}
                    nearEta={nearEta}
                    {...actions}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Block>

      <div className="mt-4 flex items-center justify-between text-xs text-[var(--app-muted)]">
        <span>Página {page + 1}</span>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>
            Anterior
          </Button>
          <Button variant="secondary" disabled={!data || data.length < 100} onClick={() => setPage((current) => current + 1)}>
            Próxima
          </Button>
        </div>
      </div>

      <Modal open={dismissTarget !== null} title="Dispensar alerta" onClose={closeDismissModal} size="sm">
        {dismissTarget ? (
          <div className="grid gap-4">
            <div>
              <p className="text-base font-bold text-[var(--app-text-strong)]">{getAlertTypeLabel(getEffectiveAlertType(dismissTarget))}</p>
              <p className="text-[var(--app-muted)]">{alertRecord(dismissTarget, entityLabels)?.label ?? dismissTarget.message}</p>
            </div>
            <Field label="Motivo">
              <Textarea
                rows={3}
                value={dismissReason}
                onChange={(e) => setDismissReason(e.target.value)}
                placeholder="Ex.: aguardando retorno da agência marítima até sexta."
              />
            </Field>
            <Field label="Volta para a fila em">
              <Input type="date" min={getTomorrowDateString()} value={reviewBy} onChange={(e) => setReviewBy(e.target.value)} />
            </Field>
            <p className="text-[var(--app-muted)]">O alerta sai da fila até essa data e volta sozinho se a pendência continuar. A dispensa não resolve a pendência.</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={closeDismissModal} disabled={dismissMutation.isPending}>Voltar</Button>
              <Button
                variant="primary"
                onClick={() => dismissMutation.mutate()}
                loading={dismissMutation.isPending}
                disabled={!dismissReason.trim() || !reviewBy}
              >
                {reviewBy ? `Dispensar até ${formatDate(`${reviewBy}T12:00:00`).slice(0, 5)}` : 'Dispensar'}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  )
}

type RowActions = {
  isMutating: boolean
  onDismiss: (alert: AlertQueueRow) => void
  onResolve: (alert: AlertQueueRow) => void
  onReprocess: (alert: AlertQueueRow) => void
  onNavigate: (to: string) => void
}

function Severity({ alert }: { alert: AlertQueueRow }) {
  return alert.severity === 'critical' ? <StatusText tone="danger">Crítico</StatusText> : <>Normal</>
}

function RecordCell({ alert, entityLabels }: { alert: AlertQueueRow; entityLabels?: AlertEntityLabels }) {
  const record = alertRecord(alert, entityLabels)
  if (!record) return <NoValue label="Sem registro" />
  return record.href ? <Link className="app-link" to={record.href}>{record.label}</Link> : <>{record.label}</>
}

function Department({ alert }: { alert: AlertQueueRow }) {
  return alert.department ? <>{ALERT_DEPARTMENT_LABELS[alert.department] ?? alert.department}</> : <NoValue label="Sem setor" />
}

/**
 * "Resolver" e "Dispensar", de largura fixa e alinhados em toda linha (lote
 * 5a). "Resolver" leva ao lugar onde a pendência se resolve (o nome do lugar
 * fica no `title`); nos alertas de conferência sem fato de origem (ADR 0083),
 * abre a justificativa. Dispensar só existe para o alerta por item. Na linha
 * da tabela, só os ícones (`iconOnly`, regra 9); no cartão, com texto.
 */
function AlertActions({ alert, isMutating, onDismiss, onResolve, onReprocess, onNavigate, dismissible = true, iconOnly = false, subject }: RowActions & {
  alert: AlertQueueRow
  dismissible?: boolean
  iconOnly?: boolean
  /** Alerta e registro da linha, para o nome do ícone dizer de qual linha é (leitor de tela). */
  subject?: string
}) {
  const effectiveType = getEffectiveAlertType(alert)
  const reprocess = importEffectRetryTarget(alert) !== null
  const byJustification = !reprocess && Boolean(alert.item_id) && canResolveWithJustification(effectiveType, alert.entity_type)
  const link = byJustification || reprocess ? null : alertEntityLink(alert)
  if (iconOnly) {
    const of = subject ? ` ${subject}` : ''
    const slot = <span className="app-btn--icon inline-block" aria-hidden="true" />
    return (
      <div className="flex items-center justify-center gap-2">
        {reprocess ? (
          <RowActionButton label={`Reprocessar${of}`} icon={RotateCcw} title="Reprocessar o efeito com justificativa" onClick={() => onReprocess(alert)} disabled={isMutating} />
        ) : byJustification ? (
          <RowActionButton label={`Resolver${of}`} icon={Wrench} title="Resolver com justificativa" onClick={() => onResolve(alert)} disabled={isMutating} />
        ) : link ? (
          <RowActionButton label={`Resolver${of}`} icon={Wrench} title={alertEntityLinkLabel(alert)} onClick={() => onNavigate(link)} />
        ) : slot}
        {dismissible && alert.item_id ? (
          <RowActionButton label={`Dispensar${of}`} icon={BellOff} title="Dispensar" onClick={() => onDismiss(alert)} disabled={isMutating} />
        ) : dismissible ? slot : null}
      </div>
    )
  }
  return (
    <div className="flex items-center justify-center gap-2">
      {reprocess ? (
        <Button variant="secondary" className="min-w-24" onClick={() => onReprocess(alert)} disabled={isMutating} title="Reprocessar o efeito com justificativa">
          Reprocessar
        </Button>
      ) : byJustification ? (
        <Button variant="secondary" className="min-w-24" onClick={() => onResolve(alert)} disabled={isMutating} title="Resolver com justificativa">
          Resolver
        </Button>
      ) : link ? (
        <Button variant="secondary" className="min-w-24" onClick={() => onNavigate(link)} title={alertEntityLinkLabel(alert)}>
          Resolver
        </Button>
      ) : <span className="inline-block min-w-24" aria-hidden="true" />}
      {dismissible && alert.item_id ? (
        <Button variant="secondary" className="min-w-24" onClick={() => onDismiss(alert)} disabled={isMutating}>
          Dispensar
        </Button>
      ) : dismissible ? <span className="inline-block min-w-24" aria-hidden="true" /> : null}
    </div>
  )
}

/** "Container vencendo · CNTR1": o alerta e o registro, que distinguem a linha. */
function rowSubject(alert: AlertQueueRow, entityLabels?: AlertEntityLabels) {
  return [getAlertTypeLabel(getEffectiveAlertType(alert)), alertRecord(alert, entityLabels)?.label].filter(Boolean).join(' · ')
}

function AlertTypeLabel({ alert, nearEta }: { alert: AlertQueueRow; nearEta?: ReadonlySet<string> }) {
  const label = getAlertTypeLabel(getEffectiveAlertType(alert))
  if (!nearEta || !hasNearEtaMark(alert, nearEta)) return <>{label}</>
  return <>{label} · <StatusText tone="warning">ETA próximo</StatusText></>
}

function AlertRow({ alert, entityLabels, nearEta, ...actions }: RowActions & { alert: AlertQueueRow; entityLabels?: AlertEntityLabels; nearEta?: ReadonlySet<string> }) {
  return (
    <tr>
      <td><Severity alert={alert} /></td>
      <td className="app-table__text"><AlertTypeLabel alert={alert} nearEta={nearEta} /></td>
      <td className="app-table__text"><RecordCell alert={alert} entityLabels={entityLabels} /></td>
      <td className="app-table__text app-table__text--wrap">{alert.message?.trim() ? alert.message : <NoValue label="Sem detalhe" />}</td>
      <td><Department alert={alert} /></td>
      <td className="whitespace-nowrap">{formatDate(alert.created_at)}</td>
      <td><AlertActions alert={alert} iconOnly subject={rowSubject(alert, entityLabels)} {...actions} /></td>
    </tr>
  )
}

function DismissedRow({ alert, entityLabels, expanded, onToggle, ...actions }: RowActions & { alert: AlertQueueRow; entityLabels?: AlertEntityLabels; expanded: boolean; onToggle: () => void }) {
  const label = getAlertTypeLabel(getEffectiveAlertType(alert))
  return (
    <>
      <tr>
        <td>
          <button type="button" className="app-table__icon-button" aria-expanded={expanded} aria-label={`${expanded ? 'Recolher' : 'Abrir'} ${label}`} onClick={onToggle}>
            {expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
          </button>
        </td>
        <td className="app-table__text">{label}</td>
        <td className="app-table__text"><RecordCell alert={alert} entityLabels={entityLabels} /></td>
        <td><StatusText tone="warning">{formatDate(alert.dismissed_until)}</StatusText></td>
        <td>{alert.dismissed_by_name ?? <NoValue label="Sem autor" />}</td>
        <td><AlertActions alert={alert} dismissible={false} iconOnly subject={rowSubject(alert, entityLabels)} {...actions} /></td>
      </tr>
      {expanded ? (
        <tr data-row-detail>
          <td colSpan={6}>
            <FactList columns={3}>
              <Fact label="Motivo">{alert.dismissal_reason ?? <NoValue label="Sem motivo" />}</Fact>
              <Fact label="Dispensado em">{alert.dismissed_at ? formatDateTime(alert.dismissed_at) : <NoValue label="Sem data" />}</Fact>
              <Fact label="Mensagem">{alert.message?.trim() ? alert.message : <NoValue label="Sem detalhe" />}</Fact>
            </FactList>
          </td>
        </tr>
      ) : null}
    </>
  )
}

function AlertCard({ alert, entityLabels, nearEta, ...actions }: RowActions & { alert: AlertQueueRow; entityLabels?: AlertEntityLabels; nearEta?: ReadonlySet<string> }) {
  const isDismissed = Boolean(alert.dismissed_until && new Date(alert.dismissed_until) > new Date())
  return (
    <Block headingLevel={3} title={<AlertTypeLabel alert={alert} nearEta={nearEta} />} aside={<Severity alert={alert} />}>
      <FactList columns={2}>
        <Fact label="Registro"><RecordCell alert={alert} entityLabels={entityLabels} /></Fact>
        <Fact label="Setor"><Department alert={alert} /></Fact>
        <Fact label="Mensagem">{alert.message?.trim() ? alert.message : <NoValue label="Sem detalhe" />}</Fact>
        <Fact label={isDismissed ? 'Dispensado até' : 'Aberto em'}>{formatDate(isDismissed ? alert.dismissed_until : alert.created_at)}</Fact>
      </FactList>
      <div className="mt-3"><AlertActions alert={alert} dismissible={!isDismissed} {...actions} /></div>
    </Block>
  )
}
