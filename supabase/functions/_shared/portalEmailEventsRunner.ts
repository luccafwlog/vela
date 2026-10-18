// Rodada do portal-email-events-runner sem imports remotos, para teste com
// cliente falso (plano de correção dos e-mails, 2.3). A Edge cuida do segredo,
// do cliente Supabase e do heartbeat; aqui ficam o claim, o processamento e a
// devolução para nova tentativa.

type RpcResult = { data: unknown; error: unknown }
export type EventsRunnerAdmin = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult>
}

export type ProcessEvent = (eventId: number, workerId: string) => Promise<{ status: string }>

export type EventsRunnerResult = {
  status: number
  body: {
    worker_id: string
    claimed: number
    processed: number
    retried: number
    investigated: number
    failures: number
    error?: string
  }
}

/**
 * Processa até 50 eventos. Resposta 500 quando o claim falha ou algum evento
 * falhou: o heartbeat do Better Stack manda `/fail` para qualquer resposta
 * não-2xx, então falha de processamento deixa o monitor vermelho.
 */
export async function runPortalEmailEventsBatch(
  admin: EventsRunnerAdmin,
  processEvent: ProcessEvent,
  workerId: string,
): Promise<EventsRunnerResult> {
  const body = { worker_id: workerId, claimed: 0, processed: 0, retried: 0, investigated: 0, failures: 0 }
  const { data, error } = await admin.rpc('claim_portal_email_events', {
    p_worker_id: workerId,
    p_limit: 50,
    p_lease_seconds: 300,
  })
  if (error) {
    console.error('[portal-email-events-runner] falha no claim', error)
    return { status: 500, body: { ...body, failures: 1, error: 'claim_failed' } }
  }

  const events = (data ?? []) as Array<{ id: number }>
  body.claimed = events.length
  for (const event of events) {
    try {
      const result = await processEvent(Number(event.id), workerId)
      if (result.status === 'processed') body.processed += 1
      else if (result.status === 'retry_wait') body.retried += 1
      else if (result.status === 'investigate') body.investigated += 1
    } catch (processError) {
      body.failures += 1
      const message = processError instanceof Error ? processError.message : String(processError)
      console.error('[portal-email-events-runner] falha no evento', event.id, processError)
      const { error: completionError } = await admin.rpc('complete_portal_email_event', {
        p_event_id: Number(event.id),
        p_worker_id: workerId,
        p_status: 'retry_wait',
        p_error_code: 'runner_error',
        p_error_message: message.slice(0, 500),
      })
      if (completionError) {
        body.failures += 1
        console.error('[portal-email-events-runner] falha ao devolver evento para retry', event.id, completionError)
      }
    }
  }

  return { status: body.failures > 0 ? 500 : 200, body }
}
