const functionNames = [
  'admin-users', 'alerts-detector', 'customer-communication-auto-runner', 'demurrage-dunning',
  'email', 'import-effects-runner', 'portal-email-events-runner', 'portal-email-webhook',
  'portal-invite-activate', 'portal-invite-send', 'portal-login', 'portal-password-recovery',
  'portal-rate-limit', 'portal-recovery-email-change', 'recalc-demurrage-ptax', 'send-customer-communication',
] as const
const failureJobs = [
  'abuse_alert', 'activation_reprocess', 'alert_delivery', 'alert_persist', 'alert_reconciliation',
  'audit', 'bounce_notification', 'candidate_processing', 'candidate_validate', 'claim_release',
  'contact_alert', 'contact_lookup', 'cycle_prepare', 'deduplication', 'dispatch_readiness', 'dry_run',
  'effect_claim', 'effect_process', 'email_dispatch', 'event_claim', 'event_processing', 'event_retry',
  'group_validate', 'identity_lookup', 'inbox_persist', 'login', 'origin_persist', 'portal_login',
  'ptax_lookup', 'ptax_recalculate', 'ptax_reference', 'ptax_resolution', 'recovery_email',
  'recovery_process', 'redis_request', 'run_detectors', 'session_cleanup', 'session_revocation',
  'status_persist', 'suppression_lookup', 'verification_session_cleanup', 'attachment_persist',
] as const
const failureCodes = [
  'abuse_alert_failed', 'activation_reprocess_failed', 'alert_delivery_unavailable', 'alert_persist_failed',
  'alert_reconciliation_failed', 'alert_upsert_failed', 'audit_write_failed', 'candidate_failed',
  'candidate_invalid', 'claim_release_failed', 'contact_alert_failed', 'contact_lookup_failed',
  'cycle_prepare_failed', 'deduplication_lookup_failed', 'deduplication_race_unresolved',
  'dispatch_readiness_failed', 'effect_claim_failed', 'effect_claim_id_invalid', 'effect_process_failed',
  'email_send_exception', 'email_send_failed', 'event_claim_failed', 'event_processing_failed',
  'event_retry_enqueue_failed', 'group_invalid', 'identity_lookup_failed', 'inbox_persist_failed',
  'origin_persist_failed', 'ptax_alert_resolution_failed', 'ptax_recalculate_failed', 'ptax_reference_failed',
  'ptax_unavailable', 'recovery_email_failed', 'recovery_process_failed', 'session_cleanup_failed',
  'session_revoke_failed', 'status_persist_failed', 'suppression_lookup_failed', 'unexpected_failure',
  'upstash_unavailable',
] as const

type EdgeFunctionName = typeof functionNames[number]
type EdgeFailureJob = typeof failureJobs[number]
type EdgeFailureCode = typeof failureCodes[number]

export type EdgeFailureLog = {
  functionName: EdgeFunctionName
  job: EdgeFailureJob
  errorCode: EdgeFailureCode
  status?: 'error' | 'warning'
}

const validFunctions = new Set<string>(functionNames)
const validJobs = new Set<string>(failureJobs)
const validErrorCodes = new Set<string>(failureCodes)

/** Emits only fixed, allowlisted fields; never pass errors, IDs, or personal data here. */
export function logEdgeFailure(entry: EdgeFailureLog): void {
  if (!validFunctions.has(entry.functionName) || !validJobs.has(entry.job) || !validErrorCodes.has(entry.errorCode)) return
  const record = {
    function: entry.functionName,
    job: entry.job,
    status: entry.status ?? 'error',
    error_code: entry.errorCode,
  }
  if (record.status === 'warning') console.warn(JSON.stringify(record))
  else console.error(JSON.stringify(record))
}

export function logEmailDryRun(): void {
  console.info(JSON.stringify({ function: 'email', job: 'dry_run', status: 'success' }))
}

type PortalEmailEventJob =
  | 'bounce_notification'
  | 'contact_alert'
  | 'contact_lookup'
  | 'suppression_lookup'
  | 'event_claim'
  | 'event_processing'
  | 'event_retry'

type PortalEmailEventErrorCode =
  | 'email_send_failed'
  | 'email_send_exception'
  | 'alert_upsert_failed'
  | 'contact_lookup_failed'
  | 'suppression_lookup_failed'
  | 'event_claim_failed'
  | 'event_processing_failed'
  | 'event_retry_enqueue_failed'

type PortalEmailEventLog = {
  job: PortalEmailEventJob
  status: 'error'
  errorCode: PortalEmailEventErrorCode
}

export function logPortalEmailEvent(entry: PortalEmailEventLog): void {
  logEdgeFailure({
    functionName: 'portal-email-events-runner',
    job: entry.job,
    errorCode: entry.errorCode,
  })
}
