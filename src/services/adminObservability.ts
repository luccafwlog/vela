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
  page: number
}

type ActionHistoryRpcRow = ActionHistoryRow & { total_count: number | string | null }

/** A contagem da busca para aqui (migration `558`): acima disso a tela diz "mais de 10.000". */
export const ACTION_HISTORY_COUNT_CAP = 10_000

export async function fetchActionHistory(filters: ActionHistoryFilters): Promise<{ rows: ActionHistoryRow[]; count: number; capped: boolean }> {
  const { data, error } = await supabase.rpc('admin_action_history' as never, {
    p_entity_types: filters.entityTypes.length ? [...filters.entityTypes] : null,
    p_actor: filters.changedBy || null,
    p_action: filters.action || null,
    p_date_from: filters.dateFrom || null,
    p_date_to: filters.dateTo || null,
    p_limit: LOG_PAGE_SIZE,
    p_offset: filters.page * LOG_PAGE_SIZE,
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

export type SystemMetrics = {
  /** Criação da viagem mais recente. */
  lastVoyageCreatedAt: string | null
  /** Emissão da fatura mais recente (`issued_at`), não a criação. */
  lastInvoiceIssuedAt: string | null
}

export async function fetchSystemMetrics(): Promise<SystemMetrics> {
  const [voyageRes, invoiceRes] = await Promise.all([
    supabase.from('voyages').select('created_at').order('created_at', { ascending: false }).limit(1),
    supabase.from('invoices').select('issued_at').not('issued_at', 'is', null).order('issued_at', { ascending: false }).limit(1),
  ])

  if (voyageRes.error) throw voyageRes.error
  if (invoiceRes.error) throw invoiceRes.error

  return {
    lastVoyageCreatedAt: voyageRes.data?.[0]?.created_at ?? null,
    lastInvoiceIssuedAt: (invoiceRes.data?.[0] as { issued_at?: string | null } | undefined)?.issued_at ?? null,
  }
}
