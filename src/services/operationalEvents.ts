import { recordAuditEntries } from './auditEntries'
import { reportBestEffortFailure } from '../lib/telemetry'

type OperationalEventCode =
  | 'manifest_import_rate_limited'
  | 'manifest_import_duplicate_hash'
  | 'bl_review_concurrent_conflict'
  | 'invoice_create_conflict'
  | 'invoice_payment_invalid'
  | 'invoice_cancel_blocked'
  | 'customer_finance_communication_failed'
  | 'granite_reimport_already_invoiced'

type LogOperationalEventInput = {
  code: OperationalEventCode
  message: string
  changedBy: string | null
  entityId?: string | null
  context?: Record<string, unknown>
}

/**
 * Registra eventos operacionais criticos em audit_logs para observabilidade.
 * O fluxo do usuario nunca deve falhar por erro de telemetria.
 */
export async function logOperationalEvent(input: LogOperationalEventInput) {
  if (!input.changedBy) return

  const payload = {
    entity_type: 'system_event',
    entity_id: input.entityId ?? input.code,
    field_name: input.code,
    old_value: null,
    new_value: input.message,
    changed_by: input.changedBy,
    justification: input.context ? JSON.stringify(input.context) : 'monitoring',
  }

  try {
    await recordAuditEntries([payload])
  } catch (error) {
    reportBestEffortFailure('registrar evento operacional', error, { code: input.code })
  }
}
