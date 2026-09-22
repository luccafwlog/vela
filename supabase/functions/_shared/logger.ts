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

/** Emits only fixed, allowlisted fields; never pass errors, IDs, or email data here. */
export function logPortalEmailEvent(entry: PortalEmailEventLog): void {
  const record = {
    function: 'portal-email-events-runner',
    job: entry.job,
    status: entry.status,
    error_code: entry.errorCode,
  }
  console.error(JSON.stringify(record))
}
