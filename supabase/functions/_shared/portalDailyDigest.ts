// Resumo diário interno do Portal (provisionamento), sem Deno nem rede: o handler injeta as
// consultas, o envio e a leitura do e-mail de cada usuário interno.

export type DigestCounts = {
  failures: number
  activity: number
  pending: number
  criticalOpened: number
  criticalClosed: number
}

type QueryResult = { data: unknown[] | null; error: unknown }

export type DailyDigestDeps = {
  /** Consultas das últimas 24 h; qualquer erro torna o resumo incompleto e a rodada falha. */
  queries: {
    failures: PromiseLike<QueryResult>
    activity: PromiseLike<QueryResult>
    pending: PromiseLike<QueryResult>
    users: PromiseLike<{ data: Array<{ id: string }> | null; error: unknown }>
    criticalOpened: PromiseLike<QueryResult>
    criticalClosed: PromiseLike<QueryResult>
  }
  userEmail: (userId: string) => Promise<string | null>
  recipientKey: (email: string) => Promise<string>
  send: (input: { to: string; counts: DigestCounts; date: string; idempotencyKey: string }) => Promise<{ ok: boolean; suppressed: boolean }>
  today: () => string
}

export type DailyDigestResult = { status: number; body: Record<string, unknown> }

export async function runPortalDailyDigest(deps: DailyDigestDeps): Promise<DailyDigestResult> {
  const { queries } = deps
  const [failures, activity, pending, users, criticalOpened, criticalClosed] = await Promise.all([
    queries.failures, queries.activity, queries.pending, queries.users, queries.criticalOpened, queries.criticalClosed,
  ])
  const failedQueries = Object.entries({ failures, activity, pending, users, criticalOpened, criticalClosed })
    .filter(([, result]) => result.error)
    .map(([name]) => name)
  // Um resumo com contagem zerada por erro de consulta diria "nada aconteceu": melhor falhar a rodada.
  if (failedQueries.length) {
    console.error('[portal-daily-digest] consulta falhou', failedQueries.join(', '))
    return { status: 500, body: { error: 'query_failed', queries: failedQueries } }
  }
  const counts: DigestCounts = {
    failures: failures.data?.length ?? 0,
    activity: activity.data?.length ?? 0,
    pending: pending.data?.length ?? 0,
    criticalOpened: criticalOpened.data?.length ?? 0,
    criticalClosed: criticalClosed.data?.length ?? 0,
  }
  if (Object.values(counts).every((count) => count === 0)) return { status: 200, body: { sent: 0, failed: 0, suppressed: 0 } }
  const date = deps.today()
  const result = { sent: 0, failed: 0, suppressed: 0 }
  for (const user of users.data ?? []) {
    try {
      const email = await deps.userEmail(user.id)
      if (!email) {
        result.failed += 1
        continue
      }
      // Chave com o hash do destinatário: o e-mail não fica em claro em portal_email_attempts.
      const idempotencyKey = `resumo:${date}:${await deps.recipientKey(email)}`
      const sent = await deps.send({ to: email, counts, date, idempotencyKey })
      if (sent.ok) result.sent += 1
      else if (sent.suppressed) result.suppressed += 1
      else result.failed += 1
    } catch (error) {
      console.error('[portal-daily-digest] envio falhou', user.id, error instanceof Error ? error.message : String(error))
      result.failed += 1
    }
  }
  return { status: 200, body: result }
}
