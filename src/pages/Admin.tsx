import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Card, EmptyState, InlineError, PageHeader } from '../components/ui/Card'
import { MetricCard } from '../components/ui/MetricCard'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { useToast } from '../components/ui/Toast'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { TabButton } from '../components/ui/TabButton'
import { NaoEncontrado } from './NaoEncontrado'
import { ADMIN_TABS, DEFAULT_ADMIN_TAB, isAdminTab, type AdminTab } from './adminTabs'
import { NovoUsuarioModal } from '../components/admin/NovoUsuarioModal'
import { EditarAcessoModal } from '../components/admin/EditarAcessoModal'
import {
  MANAGED_PROFILES,
  PROFILE_LABELS,
  PROFILE_SCOPES,
  createUser,
  deactivateUser,
  listAllUserProfiles,
  updateUserCredentials,
  updateUserProfile,
  type AdminUserRow,
} from '../services/adminUsers'
import {
  LOG_PAGE_SIZE,
  fetchAuditLogs,
  fetchRoutingFailures,
  fetchSystemMetrics,
  type LogFilters,
} from '../services/adminObservability'
import { alertEntityLink, alertEntityLinkLabel, getAlertTypeLabel } from '../services/alerts'
import { useAgencyReportSla } from '../hooks/useAgencyReport'
import { summarizeAgencyReportSlaByDepartment, type AgencyReportSlaDateRange } from '../services/agencyReportSla'
import { AGENCY_REPORT_DEPARTMENT_LABELS } from '../services/agencyDepartureReport'
import { formatAppVersion } from '../lib/appVersion'
import { formatDate } from '../lib/utils'
import type { UserProfileRole } from '../types/database'



export function Admin() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  // A aba vive na URL: `/admin/logs` é compartilhável e sobrevive ao refresh.
  // `/admin` sem sufixo cai na aba padrão via redirect declarado no App.
  const { tab: tabParam } = useParams<{ tab?: string }>()
  // `/admin` sem sufixo abre a aba padrão; `/admin/<aba-inexistente>` não é
  // silenciosamente corrigido — ver o retorno de NaoEncontrado mais abaixo.
  const tab: AdminTab = isAdminTab(tabParam) ? tabParam : DEFAULT_ADMIN_TAB
  const unknownTab = tabParam !== undefined && !isAdminTab(tabParam)
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [novoAberto, setNovoAberto] = useState(false)
  const [editando, setEditando] = useState<AdminUserRow | null>(null)
  const [logFilters, setLogFilters] = useState<LogFilters>({
    entityType: '', changedBy: '', dateFrom: '', dateTo: '', page: 0,
  })
  const [failurePage, setFailurePage] = useState(0)
  const [slaFilters, setSlaFilters] = useState<{ from: string; to: string }>({ from: '', to: '' })

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-users'],
    queryFn: listAllUserProfiles,
  })

  const { data: failuresResult, isLoading: failuresLoading, error: failuresError } = useQuery({
    queryKey: ['admin-routing-failures', failurePage],
    queryFn: () => fetchRoutingFailures(failurePage),
    enabled: tab === 'falhas',
    staleTime: 30_000,
  })
  const failures = failuresResult?.rows ?? []
  const failuresTotal = failuresResult?.count ?? 0
  const failuresTotalPages = Math.max(1, Math.ceil(failuresTotal / LOG_PAGE_SIZE))

  const { data: auditLogsResult, isLoading: logsLoading, error: logsError } = useQuery({
    queryKey: ['admin-audit-logs', logFilters],
    queryFn: () => fetchAuditLogs(logFilters),
    enabled: tab === 'logs',
    staleTime: 30_000,
  })
  const auditLogs = auditLogsResult?.rows ?? []
  const auditLogsTotal = auditLogsResult?.count ?? 0
  const auditLogsTotalPages = Math.max(1, Math.ceil(auditLogsTotal / LOG_PAGE_SIZE))

  const { data: metrics, error: metricsError } = useQuery({
    queryKey: ['admin-metrics'],
    queryFn: fetchSystemMetrics,
    enabled: tab === 'metricas',
    staleTime: 60_000,
  })

  const slaRange: AgencyReportSlaDateRange = {
    from: slaFilters.from || undefined,
    to: slaFilters.to || undefined,
  }
  const { data: slaRows, isLoading: slaLoading, error: slaError } = useAgencyReportSla(slaRange, tab === 'prazo-adr')
  const slaSummary = summarizeAgencyReportSlaByDepartment(slaRows ?? [])

  const mutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Parameters<typeof updateUserProfile>[1] }) =>
      updateUserProfile(id, updates),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      showToast('Usuário atualizado.', 'success')
      setPendingId(null)
    },
    onError: () => {
      showToast('Erro ao atualizar usuário.', 'error')
      setPendingId(null)
    },
  })

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      showToast('Usuário criado.', 'success')
      setNovoAberto(false)
    },
    onError: (err: Error) => showToast(err.message, 'error'),
  })

  const credentialsMutation = useMutation({
    mutationFn: ({ userId, updates }: { userId: string; updates: { email?: string; password?: string } }) =>
      updateUserCredentials({ user_id: userId, ...updates }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      showToast('Acesso atualizado.', 'success')
      setEditando(null)
    },
    onError: (err: Error) => showToast(err.message, 'error'),
  })

  const deactivateMutation = useMutation({
    mutationFn: deactivateUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      showToast('Usuário desativado e sessão encerrada.', 'success')
      setPendingId(null)
    },
    onError: (err: Error) => { showToast(err.message, 'error'); setPendingId(null) },
  })

  async function handleToggleActive(id: string, current: boolean) {
    const confirmed = await confirm({
      title: current ? 'Desativar usuário' : 'Ativar usuário',
      message: current
        ? 'Desativar este usuário revoga o acesso e encerra a sessão dele imediatamente. Confirmar?'
        : 'Reativar este usuário restaura o acesso dele ao sistema. Confirmar?',
      confirmLabel: current ? 'Desativar' : 'Ativar',
      tone: current ? 'danger' : 'primary',
    })
    if (!confirmed) return
    setPendingId(id)
    if (current) {
      deactivateMutation.mutate(id)
      return
    }
    mutation.mutate({ id, updates: { active: true } })
  }

  async function handleSetProfile(user: AdminUserRow, role: UserProfileRole) {
    const confirmed = await confirm({
      title: 'Alterar setor',
      message: `${user.full_name} passa a ter o acesso de ${PROFILE_LABELS[role]}: ${PROFILE_SCOPES[role]}`,
      confirmLabel: 'Alterar setor',
      tone: 'primary',
    })
    if (!confirmed) return
    setPendingId(user.id)
    mutation.mutate({ id: user.id, updates: { role } })
  }

  const users = data ?? []
  const term = search.trim().toLowerCase()
  const visibleUsers = term
    ? users.filter((u) =>
        u.full_name.toLowerCase().includes(term) || (u.email ?? '').toLowerCase().includes(term))
    : users

  if (unknownTab) return <NaoEncontrado />

  return (
    <>
      <PageHeader
        title="Administração"
        description="Painel administrativo: usuários, falhas de roteamento, logs de ações e métricas operacionais."
      />

      <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Seções da administração">
        {ADMIN_TABS.map((entry) => (
          <TabButton
            key={entry.slug}
            active={tab === entry.slug}
            label={entry.label}
            onClick={() => navigate(`/admin/${entry.slug}`)}
          />
        ))}
      </div>

      {tab === 'usuarios' ? (
        <>
          {error ? <InlineError message="Erro ao carregar usuários." /> : null}

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              className="app-input w-72"
              placeholder="Buscar por nome ou e-mail"
              aria-label="Buscar por nome ou e-mail"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button className="ml-auto" onClick={() => setNovoAberto(true)}>Novo usuário</Button>
          </div>

          {isLoading ? (
            <div className="py-16 text-center text-[var(--app-muted)]">Carregando usuários...</div>
          ) : (
            <Card className="overflow-hidden p-0">
              <div className="app-table-scroll">
              <table className="app-table app-table--compact min-w-[760px] text-left text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="px-4 py-3">Nome</th>
                    <th scope="col" className="px-4 py-3">Perfil de acesso</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="px-4 py-3">Último acesso</th>
                    <th scope="col" className="px-4 py-3">Criado em</th>
                    <th scope="col" className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-0">
                        <EmptyState title="Nenhum usuário encontrado." />
                      </td>
                    </tr>
                  ) : null}
                  {visibleUsers.map((u) => {
                    const isBusy = pendingId === u.id && (mutation.isPending || deactivateMutation.isPending)
                    const normalizedRole = u.role === 'operator' ? 'documentacao' : u.role
                    const legacyRoleTitle = u.role !== normalizedRole ? `Perfil legado: ${PROFILE_LABELS[u.role] ?? u.role}` : undefined
                    return (
                      <tr key={u.id} className={!u.active ? 'opacity-60' : undefined}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-[var(--app-text-strong)]">{u.full_name}</div>
                          <div className="text-xs text-[var(--app-muted)]">{u.email ?? '—'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            disabled={isBusy}
                            value={normalizedRole}
                            title="Setor de acesso"
                            aria-description={legacyRoleTitle}
                            onChange={(e) => void handleSetProfile(u, e.target.value as UserProfileRole)}
                            className="app-input app-select w-44 text-xs disabled:opacity-40"
                          >
                            {MANAGED_PROFILES.map((p) => (
                              <option key={p} value={p}>{PROFILE_LABELS[p]}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={u.active ? 'green' : 'red'}>{u.active ? 'Ativo' : 'Inativo'}</Badge>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-[var(--app-muted)]">
                          {u.last_sign_in_at
                            ? formatDateTime(u.last_sign_in_at)
                            : <Badge tone="yellow">Nunca acessou</Badge>}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-[var(--app-muted)]">
                          {u.created_at
                            ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(u.created_at))
                            : '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setEditando(u)}
                              className="app-table__action text-xs disabled:opacity-40"
                            >
                              Editar acesso
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleToggleActive(u.id, u.active)}
                              className="app-table__action text-xs disabled:opacity-40"
                            >
                              {u.active ? 'Desativar' : 'Ativar'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            </Card>
          )}

          <div className="mt-6 app-panel app-panel--padded text-sm space-y-4">
            <div>
              <div className="mb-2 app-panel__title">Descrição dos perfis de acesso</div>
              <div className="grid gap-2 text-[var(--app-muted)]">
                {MANAGED_PROFILES.map((profile) => (
                  <div key={profile}>
                    <span className="font-semibold text-[var(--app-text-strong)]">{PROFILE_LABELS[profile]}:</span>{' '}
                    {PROFILE_SCOPES[profile]}
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-[var(--app-border)] pt-3 text-xs text-[var(--app-muted)] space-y-1">
              <div className="font-semibold text-[var(--app-text-strong)]">Audiência de Alertas e Notificações</div>
              <p>
                Os papéis que recebem Notificações Internas diretamente das regras ativas do catálogo são{' '}
                <strong className="text-[var(--app-text-strong)]">Documentação</strong>,{' '}
                <strong className="text-[var(--app-text-strong)]">Equipamentos</strong> e{' '}
                <strong className="text-[var(--app-text-strong)]">Operações</strong>.
              </p>
              <p>
                Os papéis <strong className="text-[var(--app-text-strong)]">Administrativo</strong> e{' '}
                <strong className="text-[var(--app-text-strong)]">Administrador</strong> recebem notificações
                exclusivamente por <em className="text-amber-400">fallback</em> quando um alerta crítico não encontra nenhum usuário ativo no setor responsável. Usuários inativos ou fora dessas audiências não recebem entregas e não têm pendências atribuídas individualmente.
              </p>
            </div>
          </div>

          {novoAberto ? (
            <NovoUsuarioModal
              open
              onClose={() => setNovoAberto(false)}
              onSubmit={(input) => createMutation.mutate(input)}
              submitting={createMutation.isPending}
            />
          ) : null}
          {editando ? (
            <EditarAcessoModal
              open
              userName={editando.full_name}
              currentEmail={editando.email}
              onClose={() => setEditando(null)}
              onSubmit={(updates) => credentialsMutation.mutate({ userId: editando.id, updates })}
              submitting={credentialsMutation.isPending}
            />
          ) : null}
        </>
      ) : null}

      {tab === 'falhas' ? (
        <>
          <p className="mb-3 text-sm text-[var(--app-muted)]">
            Registro de ocorrências em que uma notificação não pôde ser entregue devido à ausência de usuários ativos
            na audiência configurada no catálogo (incluindo esgotamento do fallback de Administrativo). A correção é
            operacional: ativar um usuário ou atribuir o setor correspondente na aba Usuários.
          </p>

          {failuresError ? <InlineError message="Erro ao carregar falhas de roteamento." /> : null}

          <Card className="overflow-hidden p-0">
            {failuresLoading ? (
              <div className="py-12 text-center text-[var(--app-muted)]">Carregando falhas...</div>
            ) : (
              <div className="app-table-scroll">
                <table className="app-table app-table--compact min-w-[800px] text-left text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="px-4 py-3">Data/Hora</th>
                      <th scope="col" className="px-4 py-3">Tipo do Alerta</th>
                      <th scope="col" className="px-4 py-3">Setor Esperado</th>
                      <th scope="col" className="px-4 py-3">Motivo da Falha</th>
                      <th scope="col" className="px-4 py-3 text-right">Alerta de Origem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!failures.length ? (
                      <tr>
                        <td colSpan={5} className="p-0">
                          <EmptyState title="Nenhuma falha de roteamento registrada." />
                        </td>
                      </tr>
                    ) : null}
                    {failures.map((f) => {
                      const link = alertEntityLink({
                        type: f.item_type,
                        entity_type: f.entity_type ?? null,
                        entity_id: f.entity_id ?? null,
                      })
                      const linkLabel = alertEntityLinkLabel({
                        type: f.item_type,
                        entity_type: f.entity_type ?? null,
                      })

                      return (
                        <tr key={f.id}>
                          <td className="px-4 py-2 tabular-nums text-[var(--app-muted)] whitespace-nowrap">
                            {formatDateTime(f.created_at)}
                          </td>
                          <td className="px-4 py-2 font-medium text-[var(--app-text-strong)]">
                            {getAlertTypeLabel(f.item_type)}
                          </td>
                          <td className="px-4 py-2 text-[var(--app-muted)]">
                            {AGENCY_REPORT_DEPARTMENT_LABELS[f.department] ?? f.department}
                          </td>
                          <td className="px-4 py-2 text-rose-400 text-xs">
                            {f.reason}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {link ? (
                              <Link
                                to={link}
                                className="inline-flex items-center gap-1 text-xs text-[var(--app-link)] hover:underline"
                              >
                                <span>{linkLabel}</span>
                                <ExternalLink size={12} />
                              </Link>
                            ) : (
                              <span className="text-xs text-[var(--app-muted)]">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {failuresTotalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <button
                type="button"
                disabled={failurePage === 0}
                onClick={() => setFailurePage((p) => p - 1)}
                className="app-btn app-btn--secondary disabled:opacity-30"
              >
                ← Anterior
              </button>
              <span className="text-[var(--app-muted)]">
                Pág. {failurePage + 1} de {failuresTotalPages}
              </span>
              <button
                type="button"
                disabled={failurePage >= failuresTotalPages - 1}
                onClick={() => setFailurePage((p) => p + 1)}
                className="app-btn app-btn--secondary disabled:opacity-30"
              >
                Próximo →
              </button>
            </div>
          )}
        </>
      ) : null}

      {tab === 'logs' ? (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block app-field__label">Modulo</label>
              <input
                className="app-input w-44"
                placeholder="ex: bl, invoice..."
                value={logFilters.entityType}
                onChange={(e) => setLogFilters((f) => ({ ...f, entityType: e.target.value, page: 0 }))}
              />
            </div>
            <div>
              <label htmlFor="audit-log-author" className="mb-1 block app-field__label">Autor (ID)</label>
              <input
                id="audit-log-author"
                className="app-input w-44"
                aria-label="Autor por ID"
                value={logFilters.changedBy}
                onChange={(e) => setLogFilters((f) => ({ ...f, changedBy: e.target.value, page: 0 }))}
              />
            </div>
            <div>
              <label htmlFor="audit-log-date-from" className="mb-1 block app-field__label">De</label>
              <input
                id="audit-log-date-from"
                type="date"
                className="app-input"
                aria-label="Data inicial (De)"
                value={logFilters.dateFrom}
                onChange={(e) => setLogFilters((f) => ({ ...f, dateFrom: e.target.value, page: 0 }))}
              />
            </div>
            <div>
              <label htmlFor="audit-log-date-to" className="mb-1 block app-field__label">Ate</label>
              <input
                id="audit-log-date-to"
                type="date"
                className="app-input"
                aria-label="Data final (Até)"
                value={logFilters.dateTo}
                onChange={(e) => setLogFilters((f) => ({ ...f, dateTo: e.target.value, page: 0 }))}
              />
            </div>
            {(logFilters.entityType || logFilters.changedBy || logFilters.dateFrom || logFilters.dateTo) && (
              <button
                type="button"
                className="app-btn app-btn--secondary"
                onClick={() => setLogFilters({ entityType: '', changedBy: '', dateFrom: '', dateTo: '', page: 0 })}
              >
                Limpar filtros
              </button>
            )}
            {auditLogsTotal > 0 && (
              <span className="ml-auto text-xs text-[var(--app-muted)]">{auditLogsTotal} registros</span>
            )}
          </div>

          {logsError ? <InlineError message="Erro ao carregar logs de ações." /> : null}

          <Card className="overflow-hidden p-0">
            {logsLoading ? (
              <div className="py-12 text-center text-[var(--app-muted)]">Carregando logs...</div>
            ) : (
              <div className="app-table-scroll">
              <table className="app-table app-table--compact min-w-[920px] text-left text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="px-4 py-3">Data/Hora</th>
                    <th scope="col" className="px-4 py-3">Usuário</th>
                    <th scope="col" className="px-4 py-3">Módulo</th>
                    <th scope="col" className="px-4 py-3">Ação</th>
                    <th scope="col" className="px-4 py-3">Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {!auditLogs.length ? (
                    <tr>
                      <td colSpan={5} className="p-0">
                        <EmptyState title="Nenhum log encontrado." />
                      </td>
                    </tr>
                  ) : null}
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="px-4 py-2 tabular-nums text-[var(--app-muted)] whitespace-nowrap">
                        {new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(log.changed_at))}
                      </td>
                      <td className="px-4 py-2 font-medium text-[var(--app-text-strong)]">{log.changer_name ?? log.changed_by ?? '-'}</td>
                      <td className="px-4 py-2 text-[var(--app-muted)]">{log.entity_type}</td>
                      <td className="px-4 py-2">{log.field_name ?? '-'}</td>
                      <td className="px-4 py-2">
                        <span className="app-table__truncate app-table__truncate--xl text-[var(--app-muted)]" title={log.new_value ?? undefined}>
                          {log.new_value ?? log.justification ?? '-'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </Card>

          {auditLogsTotalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <button
                type="button"
                disabled={logFilters.page === 0}
                onClick={() => setLogFilters((f) => ({ ...f, page: f.page - 1 }))}
                className="app-btn app-btn--secondary disabled:opacity-30"
              >
                ← Anterior
              </button>
              <span className="text-[var(--app-muted)]">
                Pag. {logFilters.page + 1} de {auditLogsTotalPages}
              </span>
              <button
                type="button"
                disabled={logFilters.page >= auditLogsTotalPages - 1}
                onClick={() => setLogFilters((f) => ({ ...f, page: f.page + 1 }))}
                className="app-btn app-btn--secondary disabled:opacity-30"
              >
                Próximo →
              </button>
            </div>
          )}
        </>
      ) : null}

      {tab === 'metricas' ? (
        <>
          <div className="mb-6 app-panel app-panel--padded">
            <div className="app-metric-tile__label">Informações do sistema</div>
            <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
              <div className="app-metric-tile grid-cols-[auto_1fr]">
                <span className="text-[var(--app-muted)]">Versão</span>
                <span className="text-right font-semibold text-[var(--app-text-strong)]">{formatAppVersion()}</span>
              </div>
              <div className="app-metric-tile grid-cols-[auto_1fr]">
                <span className="text-[var(--app-muted)]">Ambiente</span>
                <span className="text-right font-semibold text-[var(--app-text-strong)]">Produção</span>
              </div>
              <div className="app-metric-tile grid-cols-[auto_1fr]">
                <span className="text-[var(--app-muted)]">Status</span>
                <Badge tone="green">Operacional</Badge>
              </div>
            </div>
          </div>
          {metricsError ? (
            <InlineError message="Erro ao carregar métricas do sistema." />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
              <MetricCard label="Última alteração em Viagens" value={metrics?.lastVoyageAt ? formatDateTime(metrics.lastVoyageAt) : '-'} />
              <MetricCard label="Última conciliação Pix" value={metrics?.lastPixReconAt ? formatDateTime(metrics.lastPixReconAt) : '-'} />
              <MetricCard label="Ultimo faturamento" value={metrics?.lastInvoiceAt ? formatDateTime(metrics.lastInvoiceAt) : '-'} />
            </div>
          )}
        </>
      ) : null}

      {tab === 'prazo-adr' ? (
        <>
          <p className="mb-3 text-sm text-[var(--app-muted)]">
            Uma linha por (viagem, porto) de ADR fechado, com o ATD, a assinatura de cada departamento e o cumprimento
            do Prazo de Conclusão do ADR. Cumprimento é medido por departamento, nunca por pessoa. Escalas omitidas e
            ADRs fechados antes desta medição existir são excluídos.
          </p>

          <div className="mb-4 flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block app-field__label">Fechado de</label>
              <input
                type="date"
                className="app-input"
                value={slaFilters.from}
                onChange={(e) => setSlaFilters((f) => ({ ...f, from: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block app-field__label">Fechado até</label>
              <input
                type="date"
                className="app-input"
                value={slaFilters.to}
                onChange={(e) => setSlaFilters((f) => ({ ...f, to: e.target.value }))}
              />
            </div>
            {(slaFilters.from || slaFilters.to) && (
              <button
                type="button"
                className="app-btn app-btn--secondary"
                onClick={() => setSlaFilters({ from: '', to: '' })}
              >
                Limpar filtros
              </button>
            )}
          </div>

          {slaError ? <InlineError message="Erro ao carregar o agregado de Prazo do ADR." /> : null}

          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3">
            {slaSummary.map((s) => (
              <MetricCard
                key={s.department}
                label={s.label}
                value={s.total > 0 ? `${s.onTime}/${s.total} no prazo (${Math.round((s.rate ?? 0) * 100)}%)` : 'Sem dados no período'}
              />
            ))}
          </div>

          {slaLoading ? (
            <div className="py-12 text-center text-[var(--app-muted)]">Carregando agregado...</div>
          ) : (
            <Card className="overflow-hidden p-0">
              <div className="app-table-scroll">
              <table className="app-table app-table--compact min-w-[980px] text-left text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="px-4 py-3">Navio / Viagem</th>
                    <th scope="col" className="px-4 py-3">Porto</th>
                    <th scope="col" className="px-4 py-3">Terminal</th>
                    <th scope="col" className="px-4 py-3">ATD</th>
                    <th scope="col" className="px-4 py-3">Prazo</th>
                    {(['operacoes', 'documentacao', 'equipamentos'] as const).map((department) => (
                      <th key={department} scope="col" className="px-4 py-3">{AGENCY_REPORT_DEPARTMENT_LABELS[department]}</th>
                    ))}
                    <th scope="col" className="px-4 py-3">Tempo total até o Fechamento</th>
                  </tr>
                </thead>
                <tbody>
                  {!slaRows?.length ? (
                    <tr>
                      <td colSpan={9} className="p-0">
                        <EmptyState title="Nenhum ADR fechado no período (após excluir escalas omitidas e snapshots anteriores à vigência)." />
                      </td>
                    </tr>
                  ) : null}
                  {slaRows?.map((row) => (
                    <tr key={`${row.voyageId}::${row.port}::${row.terminal ?? 'legacy'}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-[var(--app-text-strong)]">{row.vesselName ?? '—'}</div>
                        <div className="text-xs text-[var(--app-muted)]">{row.voyageNumber ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3">{row.port}</td>
                      <td className="px-4 py-3">{row.terminal ?? 'Legado'}</td>
                      <td className="px-4 py-3 tabular-nums text-[var(--app-muted)]">{formatDate(row.atd)}</td>
                      <td className="px-4 py-3 tabular-nums text-[var(--app-muted)]">{formatDate(row.deadlineDate)}</td>
                      {row.departments.map((departmentRow) => (
                        <td key={departmentRow.department} className="px-4 py-3">
                          <div className="mb-1">
                            <Badge tone={departmentRow.state === 'on-time' ? 'green' : departmentRow.state === 'overdue' ? 'red' : 'slate'}>
                              {departmentRow.state === 'on-time' ? 'No prazo' : departmentRow.state === 'overdue' ? 'Atrasado' : 'Sem prazo'}
                            </Badge>
                          </div>
                          <div className="text-xs text-[var(--app-muted)]">
                            {departmentRow.signedAt
                              ? `${formatDate(departmentRow.signedAt)} · ${departmentRow.businessDaysElapsed ?? '—'} dia(s) útil(eis)`
                              : 'Não assinado'}
                          </div>
                        </td>
                      ))}
                      <td className="px-4 py-3 tabular-nums text-[var(--app-muted)]">
                        {row.elapsedCalendarDaysToClosure !== null ? `${row.elapsedCalendarDaysToClosure} dia(s) corrido(s)` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </Card>
          )}
        </>
      ) : null}
    </>
  )
}

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}
