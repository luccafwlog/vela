import { supabase } from './supabase'
import type { AlertRuleSeverity } from './alertRulesCatalog'

/**
 * Gravidade vigente de um tipo de alerta (migration 603, ADR 0130). A
 * gravidade de fábrica está em `alertRulesCatalog.ts`; esta é a que vale no
 * banco, que o Administrativo troca na tela Regras de alertas.
 */
export type AlertTypeSetting = {
  type: string
  severity: AlertRuleSeverity
  /** Alertas abertos do tipo agora (a troca muda a gravidade deles). */
  activeItems: number
  /** Última troca feita pela tela; `null` quando nunca foi trocada. */
  lastChange: {
    at: string
    byName: string | null
    previousSeverity: AlertRuleSeverity | null
    reason: string | null
  } | null
  /** Reforço por tempo (migration 604): vira Crítico depois de N horas aberto; `null` sem reforço. */
  escalateAfterHours: number | null
  lastEscalationChange: { at: string; byName: string | null; reason: string | null } | null
}

function isSeverity(value: unknown): value is AlertRuleSeverity {
  return value === 'critical' || value === 'normal'
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function parseAlertTypeSettings(rows: unknown): AlertTypeSetting[] {
  if (!Array.isArray(rows)) throw new Error('Resposta inesperada da gravidade dos alertas.')
  return rows.map((raw) => {
    const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
    const type = text(row?.type)
    if (!row || !type || !isSeverity(row.severity)) throw new Error('Resposta inesperada da gravidade dos alertas.')
    const changedAt = text(row.changed_at)
    const escalationAt = text(row.escalation_changed_at)
    const hours = Number(row.escalate_after_hours)
    return {
      type,
      severity: row.severity,
      activeItems: Number.isFinite(Number(row.active_items)) ? Number(row.active_items) : 0,
      lastChange: changedAt
        ? {
            at: changedAt,
            byName: text(row.changed_by_name),
            previousSeverity: isSeverity(row.previous_severity) ? row.previous_severity : null,
            reason: text(row.change_reason),
          }
        : null,
      escalateAfterHours: row.escalate_after_hours === null || row.escalate_after_hours === undefined || !Number.isInteger(hours) ? null : hours,
      lastEscalationChange: escalationAt
        ? { at: escalationAt, byName: text(row.escalation_changed_by_name), reason: text(row.escalation_reason) }
        : null,
    }
  })
}

/** Gravidade vigente de todos os tipos ativos, com os abertos e a última troca. */
export async function fetchAlertTypeSettings(): Promise<AlertTypeSetting[]> {
  const { data, error } = await supabase.rpc('list_alert_type_settings' as never)
  if (error) throw error
  return parseAlertTypeSettings(data)
}

export type AlertTypeSeverityChange = {
  type: string
  previousSeverity: AlertRuleSeverity
  severity: AlertRuleSeverity
  /** Alertas abertos que mudaram de gravidade junto com o tipo. */
  activeItems: number
}

/**
 * Troca a gravidade do tipo e dos alertas abertos dele. Só o Administrativo
 * (o banco recusa os outros com 42501); o motivo tem 10 caracteres ou mais e
 * vai para o Histórico de ações.
 */
export async function setAlertTypeSeverity(type: string, severity: AlertRuleSeverity, reason: string): Promise<AlertTypeSeverityChange> {
  const { data, error } = await supabase.rpc('set_alert_type_severity' as never, {
    p_type: type,
    p_severity: severity,
    p_reason: reason.trim(),
  } as never)
  if (error) throw error
  const row = data && typeof data === 'object' ? data as Record<string, unknown> : null
  if (!row || !isSeverity(row.severity) || !isSeverity(row.previous_severity)) {
    throw new Error('Resposta inesperada da troca de gravidade.')
  }
  return {
    type: text(row.type) ?? type,
    previousSeverity: row.previous_severity,
    severity: row.severity,
    activeItems: Number(row.active_items) || 0,
  }
}

/**
 * Liga, muda ou tira (`null`) o reforço por tempo do tipo: o alerta Normal
 * aberto há mais de `hours` horas vira Crítico e avisa de novo. Só o
 * Administrativo; motivo de 10 caracteres ou mais (migration 604).
 */
export async function setAlertTypeEscalation(type: string, hours: number | null, reason: string): Promise<{ previousHours: number | null; hours: number | null }> {
  const { data, error } = await supabase.rpc('set_alert_type_escalation' as never, {
    p_type: type,
    p_hours: hours,
    p_reason: reason.trim(),
  } as never)
  if (error) throw error
  const row = data && typeof data === 'object' ? data as Record<string, unknown> : null
  if (!row) throw new Error('Resposta inesperada da troca do reforço por tempo.')
  const asHours = (value: unknown) => (value === null || value === undefined ? null : Number(value))
  return { previousHours: asHours(row.previous_hours), hours: asHours(row.hours) }
}
