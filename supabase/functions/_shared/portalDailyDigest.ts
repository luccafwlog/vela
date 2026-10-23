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
    /** Usuários internos ativos dos papéis do resumo, com o tipo de conta (migration 440). */
    users: PromiseLike<{ data: Array<{ id: string; account_kind?: string | null }> | null; error: unknown }>
    criticalOpened: PromiseLike<QueryResult>
    criticalClosed: PromiseLike<QueryResult>
  }
  userEmail: (userId: string) => Promise<string | null>
  recipientKey: (email: string) => Promise<string>
  /** Há tentativa em portal_email_attempts com esta chave de idempotência? */
  attemptExists: (idempotencyKey: string) => Promise<boolean>
  send: (input: { to: string; counts: DigestCounts; date: string; idempotencyKey: string }) => Promise<{ ok: boolean; suppressed: boolean }>
  today: () => string
}

/** Chave gravada antes do plano dos e-mails (5.1), com o e-mail em claro. */
export function legacyDigestIdempotencyKey(date: string, email: string): string {
  return `resumo:${date}:${email.toLowerCase()}`
}

// Chave com o hash do destinatário: o e-mail não fica em claro em
// portal_email_attempts. Se o resumo do dia já saiu com a chave antiga (rodada
// anterior ao deploy, no mesmo dia), ela continua valendo, para a nova rodada
// achar a mesma tentativa e não reenviar o resumo.
async function digestIdempotencyKey(deps: DailyDigestDeps, date: string, email: string): Promise<string> {
  const legacy = legacyDigestIdempotencyKey(date, email)
  if (await deps.attemptExists(legacy)) return legacy
  return `resumo:${date}:${await deps.recipientKey(email)}`
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
  // Conta de integração (API ITAÚ) não é pessoa: o e-mail dela não é caixa real
  // e a recusa do provedor contava falha e deixava o heartbeat vermelho.
  for (const user of (users.data ?? []).filter((candidate) => candidate.account_kind !== 'integracao')) {
    try {
      const email = await deps.userEmail(user.id)
      if (!email) {
        result.failed += 1
        continue
      }
      const idempotencyKey = await digestIdempotencyKey(deps, date, email)
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
