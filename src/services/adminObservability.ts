import { supabase } from './supabase'

export const LOG_PAGE_SIZE = 50

/** Autor "Sistema" no filtro Por: linhas gravadas sem usuário (jobs, gatilhos). */
export const SYSTEM_AUTHOR = 'sistema'

/** Tipo de ação do filtro e da linha (migration `558`). */
export type AuditAction = 'criou' | 'alterou' | 'excluiu'

/** Quem fez: pessoa da equipe, Cliente pelo Portal, Sistema (rotina, gatilho) ou login sem cadastro. */
export type AuditActorKind = 'equipe' | 'portal' | 'sistema' | 'desconhecido'

/** Autor "Portal" no filtro Por: tudo o que um Cliente fez pelo Portal. */
export const PORTAL_AUTHOR = 'portal'

/**
 * Linha do Histórico de ações já com os nomes (RPC `admin_action_history`,
 * migration `558`): o registro, o autor e os valores que apontam para outro
 * cadastro vêm pelo nome; o número interno não chega à tela.
 */
export type ActionHistoryRow = {
  /**
   * De qual trilha veio a linha (migration `561`): `audit` (Histórico de ações)
   * ou a trilha própria do assunto (`ce_unlock`, `portal`, `comunicado`,
   * `disputa`, `anexo`). O par `source`/`id` identifica a linha.
   */
  source: string
  id: number
  changed_at: string
  entity_type: string
  field_name: string | null
  old_value: string | null
  new_value: string | null
  justification: string | null
  action: AuditAction
  actor_kind: AuditActorKind
  actor_name: string | null
  actor_email: string | null
  actor_department: string | null
  /** Nome do registro ("Santos / V12 · BRSSZ", "B/L ABC123"); `null` quando não há nome conhecido. */
  entity_label: string | null
  /** Nome do cadastro quando o campo é chave de outro (Navio, Cliente...). */
  old_label: string | null
  new_label: string | null
  /** No registro gravado em JSON (criação ou exclusão): chave de cadastro → nome. */
  value_labels: Record<string, string> | null
}

export type ActionHistoryFilters = {
  /** Entidades do assunto escolhido; vazio = todos os assuntos. */
  entityTypes: readonly string[]
  /** Usuário (id), `SYSTEM_AUTHOR`, `PORTAL_AUTHOR` ou vazio para qualquer autor. */
  changedBy: string
  /** Criou, alterou, excluiu ou vazio para qualquer ação. */
  action: AuditAction | ''
  /** Dia de Brasília (YYYY-MM-DD), inclusive. */
  dateFrom: string
  dateTo: string
  /** B/L, CE, container, navio, viagem ou Cliente (migration `603`); vazio = sem busca. */
  search?: string
  page: number
}

type ActionHistoryRpcRow = ActionHistoryRow & { total_count: number | string | null }

/** A contagem da busca para aqui (migration `558`): acima disso a tela diz "mais de 10.000". */
export const ACTION_HISTORY_COUNT_CAP = 10_000

function historyFilterParams(filters: Omit<ActionHistoryFilters, 'page'>) {
  return {
    p_entity_types: filters.entityTypes.length ? [...filters.entityTypes] : null,
    p_actor: filters.changedBy || null,
    p_action: filters.action || null,
    p_date_from: filters.dateFrom || null,
    p_date_to: filters.dateTo || null,
    p_search: filters.search?.trim() || null,
  }
}

/**
 * Linhas do Histórico, campo a campo (RPC `admin_action_history`, migrations
 * `558`, `561` e `603`): pelos filtros, ou todas as linhas de uma ação
 * (`actionKey`), para a linha aberta e a planilha.
 */
export async function fetchActionHistory(
  filters: ActionHistoryFilters,
  options: { actionKey?: string; pageSize?: number } = {},
): Promise<{ rows: ActionHistoryRow[]; count: number; capped: boolean }> {
  const pageSize = options.pageSize ?? LOG_PAGE_SIZE
  const { data, error } = await supabase.rpc('admin_action_history' as never, {
    ...historyFilterParams(filters),
    p_action_key: options.actionKey ?? null,
    p_limit: pageSize,
    p_offset: filters.page * pageSize,
  } as never)
  if (error) throw error
  const raw = (data ?? []) as ActionHistoryRpcRow[]
  // O total vem em cada linha (a contagem da busca, antes da página); página
  // vazia depois da última não sabe o total e devolve 0.
  const total = raw.length ? Number(raw[0].total_count ?? 0) : 0
  const capped = total > ACTION_HISTORY_COUNT_CAP
  const count = Math.min(total, ACTION_HISTORY_COUNT_CAP)
  return {
    capped,
    rows: raw.map((rpcRow) => {
      const row: ActionHistoryRow & { total_count?: unknown } = { ...rpcRow, value_labels: rpcRow.value_labels ?? null }
      delete row.total_count
      return row
    }),
    count,
  }
}

/** Família de registros de uma ação: quantos registros de um tipo ela criou, alterou ou excluiu. */
export type ActionHistoryGroup = {
  entity_type: string
  kind: AuditAction
  entities: number
  /** Até 8 campos alterados nesses registros. */
  fields: string[]
}

/**
 * Uma ação do Histórico (RPC `admin_action_history_actions`, migration `603`):
 * as linhas gravadas na mesma transação pela mesma pessoa, com o resumo por
 * registro e a linha que a representa (a primeira criação, ou a primeira linha).
 */
export type ActionHistoryAction = Omit<ActionHistoryRow, 'id' | 'action' | 'source'> & {
  action_key: string
  source: string
  action: AuditAction
  line_count: number
  entity_count: number
  groups: ActionHistoryGroup[]
}

type ActionHistoryActionRpcRow = ActionHistoryAction & { total_count: number | string | null }

export async function fetchActionHistoryActions(filters: ActionHistoryFilters): Promise<{ rows: ActionHistoryAction[]; count: number; capped: boolean }> {
  const { data, error } = await supabase.rpc('admin_action_history_actions' as never, {
    ...historyFilterParams(filters),
    p_limit: LOG_PAGE_SIZE,
    p_offset: filters.page * LOG_PAGE_SIZE,
  } as never)
  if (error) throw error
  const raw = (data ?? []) as ActionHistoryActionRpcRow[]
  const total = raw.length ? Number(raw[0].total_count ?? 0) : 0
  return {
    capped: total > ACTION_HISTORY_COUNT_CAP,
    count: Math.min(total, ACTION_HISTORY_COUNT_CAP),
    rows: raw.map((rpcRow) => {
      const row: ActionHistoryAction & { total_count?: unknown } = {
        ...rpcRow,
        groups: Array.isArray(rpcRow.groups) ? rpcRow.groups : [],
        value_labels: rpcRow.value_labels ?? null,
      }
      delete row.total_count
      return row
    }),
  }
}

/** Teto da planilha do Histórico: as linhas, campo a campo, do recorte filtrado. */
export const ACTION_HISTORY_EXPORT_CAP = 10_000

/** Todas as linhas do recorte, até o teto, em páginas de 1.000. */
export async function fetchActionHistoryForExport(filters: Omit<ActionHistoryFilters, 'page'>): Promise<{ rows: ActionHistoryRow[]; capped: boolean }> {
  const rows: ActionHistoryRow[] = []
  // A contagem da primeira página (até 10.001) diz se o recorte passa do teto:
  // um recorte de exatamente 10.000 linhas sai inteiro, sem o aviso de limite.
  let capped = false
  for (let page = 0; rows.length < ACTION_HISTORY_EXPORT_CAP; page += 1) {
    const result = await fetchActionHistory({ ...filters, page }, { pageSize: 1000 })
    if (page === 0) capped = result.capped
    rows.push(...result.rows)
    if (result.rows.length < 1000) return { rows, capped: false }
  }
  return { rows: rows.slice(0, ACTION_HISTORY_EXPORT_CAP), capped }
}

export type RoutingFailureRow = {
  id: number
  alert_id: number | null
  alert_item_id: number | null
  event_id: number | null
  item_type: string
  department: string
  reason: string
  created_at: string
  entity_type?: string | null
  entity_id?: string | null
}

/**
 * Motivo da falha em português de tela. O banco grava a frase técnica
 * (`fanout_alert_item*`, com "fallback", "audiência" ou, nas linhas antigas,
 * o papel em snake_case) e ela fica em `alert_notification_failures.reason`
 * para o suporte; a tela nunca a mostra. Toda linha da tabela é alerta sem
 * destinatário ativo, então o motivo desconhecido também vira a frase do setor.
 */
export function routingFailureReasonLabel(reason: string): string {
  if (/fallback|administrativo/i.test(reason)) return 'Ninguém ativo no setor do alerta nem no Administrativo.'
  return 'Ninguém ativo no setor do alerta.'
}

export async function fetchRoutingFailures(page = 0): Promise<{ rows: RoutingFailureRow[]; count: number }> {
  const from = page * LOG_PAGE_SIZE
  const to = from + LOG_PAGE_SIZE - 1

  type RoutingFailureQuery = {
    select: (columns: string, options?: { count: 'exact' }) => RoutingFailureQuery
    order: (column: string, options: { ascending: boolean }) => RoutingFailureQuery
    range: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown | null; count: number | null }>
  }
  const boundFrom = supabase.from.bind(supabase) as unknown as (table: string) => RoutingFailureQuery
  const query = boundFrom('alert_notification_failures')
  const { data, error, count } = await query
    .select('id, alert_id, alert_item_id, event_id, item_type, department, reason, created_at, alert:alerts(entity_type, entity_id)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) throw error

  const rows = ((data ?? []) as unknown as Array<{
    id: number
    alert_id: number | null
    alert_item_id: number | null
    event_id: number | null
    item_type: string
    department: string
    reason: string
    created_at: string
    alert?: { entity_type: string | null; entity_id: string | null } | null
  }>).map((r) => ({
    id: r.id,
    alert_id: r.alert_id,
    alert_item_id: r.alert_item_id,
    event_id: r.event_id,
    item_type: r.item_type,
    department: r.department,
    reason: r.reason,
    created_at: r.created_at,
    entity_type: r.alert?.entity_type ?? null,
    entity_id: r.alert?.entity_id ?? null,
  }))

  return {
    rows,
    count: count ?? 0,
  }
}

/** Pontos de atenção e configurações da aba Sistema (RPC `admin_system_health`, migration `605`; só a conta Dev). */
export type SystemHealth = {
  alert_failures_30d: number
  last_alert_failure_at: string | null
  /** Setores sem nenhuma pessoa ativa (códigos de `user_profiles.role`). */
  teams_without_active: string[]
  /** Rotinas ativas cuja última execução falhou. */
  routines_failing: string[]
  routine_failures_7d: number
  pix_provider: string | null
  pix_polled_until: string | null
  pix_expiration_seconds: number | null
  pix_settlement_actor_name: string | null
  suppressed_emails: number
  holidays_last_day: string | null
  holidays_next_year: number
  next_year: number
  communications_enabled: boolean
  dunning_interval_days: number | null
  routine_actor_name: string | null
  routine_actor_effective_name: string | null
}

export async function fetchSystemHealth(): Promise<SystemHealth> {
  const { data, error } = await supabase.rpc('admin_system_health' as never)
  if (error) throw error
  const raw = (data ?? {}) as Partial<SystemHealth>
  return {
    alert_failures_30d: Number(raw.alert_failures_30d ?? 0),
    last_alert_failure_at: raw.last_alert_failure_at ?? null,
    teams_without_active: raw.teams_without_active ?? [],
    routines_failing: raw.routines_failing ?? [],
    routine_failures_7d: Number(raw.routine_failures_7d ?? 0),
    pix_provider: raw.pix_provider ?? null,
    pix_polled_until: raw.pix_polled_until ?? null,
    pix_expiration_seconds: raw.pix_expiration_seconds ?? null,
    pix_settlement_actor_name: raw.pix_settlement_actor_name ?? null,
    suppressed_emails: Number(raw.suppressed_emails ?? 0),
    holidays_last_day: raw.holidays_last_day ?? null,
    holidays_next_year: Number(raw.holidays_next_year ?? 0),
    next_year: Number(raw.next_year ?? new Date().getFullYear() + 1),
    communications_enabled: raw.communications_enabled === true,
    dunning_interval_days: raw.dunning_interval_days ?? null,
    routine_actor_name: raw.routine_actor_name ?? null,
    routine_actor_effective_name: raw.routine_actor_effective_name ?? null,
  }
}

export type SystemRoutine = {
  jobname: string
  schedule: string
  active: boolean
  last_run_at: string | null
  last_status: string | null
  failures_7d: number
}

/** Rotinas do `pg_cron` (RPC `admin_system_routines`, migration `605`; só a conta Dev). */
export async function fetchSystemRoutines(): Promise<SystemRoutine[]> {
  const { data, error } = await supabase.rpc('admin_system_routines' as never)
  if (error) throw error
  return ((data ?? []) as SystemRoutine[]).map((row) => ({ ...row, failures_7d: Number(row.failures_7d ?? 0) }))
}

/** "Enviar teste para mim": Edge Function `admin-test-email`; devolve o endereço que recebeu. */
export async function sendAdminTestEmail(): Promise<string> {
  const { data, error } = await supabase.functions.invoke('admin-test-email', { body: {} })
  if (error) {
    const context = (error as { context?: Response }).context
    const body = context && typeof context.json === 'function' ? await context.json().catch(() => null) as { error?: string } | null : null
    throw new Error(body?.error ?? 'Não foi possível enviar o e-mail de teste. Tente novamente.')
  }
  return (data as { to?: string } | null)?.to ?? ''
}
