import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { ArrowUpRight, RotateCcw, Wrench } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { RowActionButton } from '../components/ui/RowActionButton'
import { NoValue } from '../components/ui/NoValue'
import { InlineError, PageHeader } from '../components/ui/Card'
import { Block, Fact, FactList } from '../components/ui/Block'
import { MetricCard } from '../components/ui/MetricCard'
import { StatusText } from '../components/ui/StatusText'
import { Field, Input, Select } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { useConfirmWithReason } from '../components/ui/ConfirmDialog'
import { useNarrowViewport } from '../components/bl/useNarrowViewport'
import { formatDate } from '../lib/utils'
import { userFacingErrorMessage } from '../lib/errors'
import {
  ALERT_DEPARTMENT_LABELS,
  alertEntityLink,
  alertEntityLinkLabel,
  alertRecord,
  canResolveWithJustification,
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
import { matchesAnyToken } from '../lib/searchTerms'

/**
 * Cartões que filtram a fila (lote 5a). Abre em Ativos; não há "Todos". A
 * dispensa saiu na migration 476 (ADR 0108): sem o cartão Dispensados.
 */
type AlertLens = 'ativos' | 'criticos'

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

function sumSummary(summary: AlertDepartmentSummary[] | undefined, department: string) {
  if (!summary) return null
  return summary
    .filter((row) => department === 'all' || row.department === department)
    .reduce((total, row) => total + Number(row.active_count ?? 0), 0)
}

/**
 * B/Ls do alerta que a lista colada também casa: o alerta por escala ou por
 * Cliente guarda os B/Ls em `metadata` (`bl_id`, `bl_ids`, `bls`), não no `entity_id`.
 */
function alertBlIds(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object') return []
  const record = metadata as { bl_id?: unknown; bl_ids?: unknown; bls?: unknown }
  const ids: unknown[] = [record.bl_id, ...(Array.isArray(record.bl_ids) ? record.bl_ids : [])]
  if (Array.isArray(record.bls)) {
    for (const bl of record.bls) ids.push(typeof bl === 'object' && bl ? (bl as { bl_id?: unknown }).bl_id : bl)
  }
  return ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
}

export function Alertas() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawDept = searchParams.get('departamento') || searchParams.get('department') || 'all'
  const departmentFilter = DEPARTMENT_OPTIONS.some((opt) => opt.value === rawDept) ? rawDept : 'all'

  const [lens, setLens] = useState<AlertLens>('ativos')
  const statusFilter = 'active'
  const [searchQuery, setSearchQuery] = useState('')
  const [severityFilter, setSeverityFilter] = useState<string>('all')
  const [entityFilter, setEntityFilter] = useState<string>('all')
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

  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirmWithReason = useConfirmWithReason()
  const navigate = useNavigate()

  const activeDepartment = departmentFilter === 'all' ? undefined : departmentFilter

  const { data, isLoading, isError, error } = useQuery<AlertQueueRow[]>({
    queryKey: queryKeys.alerts.list(statusFilter, page, departmentFilter),
    queryFn: () => listAlerts(statusFilter, undefined, page, activeDepartment),
  })

  // Ativos conta pelo resumo por setor (a fila inteira, não a página);
  // Críticos conta a página de ativos carregada.
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
  const activeCount = sumSummary(summary, departmentFilter)
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

        return messageMatch || entityIdMatch || typeLabelMatch || entityLabelMatch || metadataMatch || matchesAnyToken(q, [alert.entity_id, ...alertBlIds(alert.metadata)])
      })
    }

    return list
  }, [data, lens, severityFilter, entityFilter, searchQuery, entityLabels])

  // Conferência sem fato de origem (ADR 0083, item 23): resolve de vez, com
  // motivo no histórico do alerta; os demais fecham sozinhos pela origem.
  const resolveMutation = useMutation({
    mutationFn: ({ itemId, reason }: { itemId: number; reason: string }) => resolveAlertItemWithJustification(itemId, reason),
    onSuccess: async () => {
      showToast('Alerta resolvido com justificativa.', 'success')
      await invalidateAllAlertQueries(queryClient)
    },
    // ALE-D18: a recusa do banco chega com o motivo (alerta já fechado, sem permissão).
    onError: (err: unknown) => {
      showToast(userFacingErrorMessage(err, 'Falha ao resolver o alerta.'), 'error')
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
  // o efeito, com justificativa. O alerta fica aberto como "Reprocessando…"
  // e fecha só quando o efeito conclui; se bloquear de novo, o mesmo alerta
  // volta ao bloqueado com o novo motivo (migrations 348, 394 e 395).
  const reprocessMutation = useMutation({
    mutationFn: ({ effectId, reason }: { effectId: number; reason: string }) => retryImportEffect(effectId, reason),
    onSuccess: async () => {
      showToast('Efeito reenviado para a fila. O alerta fecha quando o efeito concluir.', 'success')
      await Promise.all([
        invalidateAllAlertQueries(queryClient),
        queryClient.invalidateQueries({ queryKey: queryKeys.importEffects.all() }),
      ])
    },
    onError: (err: unknown) => {
      showToast(userFacingErrorMessage(err, 'Não foi possível reprocessar o efeito. Atualize a lista e tente de novo.'), 'error')
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
      reversibility: 'Se falhar de novo, o efeito volta a ficar bloqueado e o alerta mostra o novo motivo.',
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

  const isMutating = resolveMutation.isPending || reprocessMutation.isPending
  const actions = {
    isMutating,
    onResolve: (alert: AlertQueueRow) => void requestResolution(alert),
    onReprocess: (alert: AlertQueueRow) => void requestReprocess(alert),
    onNavigate: (to: string) => navigate(to),
  }
  const blockTitle = lens === 'criticos' ? 'Alertas críticos' : 'Alertas ativos'
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
            {hasActiveFilters ? 'Nenhum alerta corresponde aos filtros aplicados.' : 'Nenhum alerta na fila.'}
          </p>
        ) : narrow ? (
          <ul className="grid gap-3 p-3" aria-label={blockTitle}>
            {filteredAlerts.map((alert) => (
              <li key={`${alert.id}:${alert.item_id ?? getEffectiveAlertType(alert)}`}>
                <AlertCard alert={alert} entityLabels={entityLabels} nearEta={nearEta} {...actions} />
              </li>
            ))}
          </ul>
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

    </>
  )
}

type RowActions = {
  isMutating: boolean
  onResolve: (alert: AlertQueueRow) => void
  onReprocess: (alert: AlertQueueRow) => void
  onNavigate: (to: string) => void
}

/** ALE-D06: a abertura da ocorrência atual; reaberto, o alerta mostra a data da reabertura. */
function openedAt(alert: AlertQueueRow) {
  return alert.opened_at ?? alert.created_at
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
 * "Resolver", de largura fixa e alinhado em toda linha (lote 5a). Leva ao
 * lugar onde a pendência se resolve (o nome do lugar fica no `title`); nos
 * alertas de conferência sem fato de origem (ADR 0083), abre a justificativa.
 * A dispensa saiu na migration 476 (ADR 0108). Na linha da tabela, só o ícone
 * (`iconOnly`, regra 9); no cartão, com texto.
 */
function AlertActions({ alert, isMutating, onResolve, onReprocess, onNavigate, iconOnly = false, subject }: RowActions & {
  alert: AlertQueueRow
  iconOnly?: boolean
  /** Alerta e registro da linha, para o nome do ícone dizer de qual linha é (leitor de tela). */
  subject?: string
}) {
  const effectiveType = getEffectiveAlertType(alert)
  const retryTarget = importEffectRetryTarget(alert)
  const reprocess = retryTarget !== null
  const reprocessing = retryTarget?.reprocessing === true
  const byJustification = !reprocess && Boolean(alert.item_id) && canResolveWithJustification(effectiveType, alert.entity_type)
  const placeLink = reprocess ? null : alertEntityLink(alert)
  const link = byJustification ? null : placeLink
  // Tipos com justificativa que também levam a uma tela (Consulta de Pix do
  // Itaú parada → Conciliação, ALE-D05): o atalho fica ao lado de Resolver.
  const justifiedPlace = byJustification && placeLink && placeLink !== '/alertas' ? placeLink : null
  if (iconOnly) {
    const of = subject ? ` ${subject}` : ''
    const slot = <span className="app-btn--icon inline-block" aria-hidden="true" />
    return (
      <div className="flex items-center justify-center gap-2">
        {reprocess ? (
          <RowActionButton label={reprocessing ? `Reprocessando…${of}` : `Reprocessar${of}`} icon={RotateCcw} title={reprocessing ? 'Reprocessando… o alerta fecha quando o efeito concluir' : 'Reprocessar o efeito com justificativa'} onClick={() => onReprocess(alert)} disabled={isMutating || reprocessing} />
        ) : byJustification ? (
          <>
            {justifiedPlace ? <RowActionButton label={`${alertEntityLinkLabel(alert)}${of}`} icon={ArrowUpRight} title={alertEntityLinkLabel(alert)} onClick={() => onNavigate(justifiedPlace)} /> : null}
            <RowActionButton label={`Resolver${of}`} icon={Wrench} title="Resolver com justificativa" onClick={() => onResolve(alert)} disabled={isMutating} />
          </>
        ) : link ? (
          <RowActionButton label={`Resolver${of}`} icon={Wrench} title={alertEntityLinkLabel(alert)} onClick={() => onNavigate(link)} />
        ) : slot}
      </div>
    )
  }
  return (
    <div className="flex items-center justify-center gap-2">
      {reprocess ? (
        <Button variant="secondary" className="min-w-24" onClick={() => onReprocess(alert)} disabled={isMutating || reprocessing} title={reprocessing ? 'Reprocessando… o alerta fecha quando o efeito concluir' : 'Reprocessar o efeito com justificativa'}>
          {reprocessing ? 'Reprocessando…' : 'Reprocessar'}
        </Button>
      ) : byJustification ? (
        <>
          {justifiedPlace ? (
            <Button variant="secondary" onClick={() => onNavigate(justifiedPlace)} title={alertEntityLinkLabel(alert)}>
              {alertEntityLinkLabel(alert)}
            </Button>
          ) : null}
          <Button variant="secondary" className="min-w-24" onClick={() => onResolve(alert)} disabled={isMutating} title="Resolver com justificativa">
            Resolver
          </Button>
        </>
      ) : link ? (
        <Button variant="secondary" className="min-w-24" onClick={() => onNavigate(link)} title={alertEntityLinkLabel(alert)}>
          Resolver
        </Button>
      ) : <span className="inline-block min-w-24" aria-hidden="true" />}
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
      <td className="whitespace-nowrap">{formatDate(openedAt(alert))}</td>
      <td><AlertActions alert={alert} iconOnly subject={rowSubject(alert, entityLabels)} {...actions} /></td>
    </tr>
  )
}

function AlertCard({ alert, entityLabels, nearEta, ...actions }: RowActions & { alert: AlertQueueRow; entityLabels?: AlertEntityLabels; nearEta?: ReadonlySet<string> }) {
  return (
    <Block headingLevel={3} title={<AlertTypeLabel alert={alert} nearEta={nearEta} />} aside={<Severity alert={alert} />}>
      <FactList columns={2}>
        <Fact label="Registro"><RecordCell alert={alert} entityLabels={entityLabels} /></Fact>
        <Fact label="Setor"><Department alert={alert} /></Fact>
        <Fact label="Mensagem">{alert.message?.trim() ? alert.message : <NoValue label="Sem detalhe" />}</Fact>
        <Fact label="Aberto em">{formatDate(openedAt(alert))}</Fact>
      </FactList>
      <div className="mt-3"><AlertActions alert={alert} {...actions} /></div>
    </Block>
  )
}
