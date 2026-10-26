// Fila de e-mails do Desbloqueio de CE (tabela ce_unlock_email_outbox, preenchida pelo banco).
// Lógica pura, sem Deno nem rede: o handler injeta cliente, envio e configuração.
// O gatilho da fila e o cron rodam juntos: `ce_unlock_email_pending` reserva as linhas (FOR UPDATE
// SKIP LOCKED e prazo, migration 458) e a chave de idempotência por destinatário segue como segunda barreira.

export const CE_UNLOCK_BOX = 'documentacao_operacao'
const MAX_ATTEMPTS = 5

export type OutboxRow = {
  id: number
  customer_id: number
  request_id: string
  kind: 'changes_requested' | 'documentation_validated'
  subject: string
  body: string
  done_recipients: string[]
  attempts: number
}
export type Contact = { id: number; email: string | null }
/** `suppressed`: contato da caixa cujo endereço está suprimido (bounce ou reclamação); `blocked`: fora da caixa ou inválido. */
export type ContactEligibility = 'allowed' | 'suppressed' | 'blocked'

/** Resultado do envio a um destinatário. `suppressed`: endereço na supressão do Portal (bounce/reclamação). */
export type SendOutcome = 'sent' | 'suppressed' | 'failed'

export type OutboxStatus = 'pending' | 'sent' | 'partial' | 'simulated' | 'skipped' | 'failed'

export type NotifyDeps = {
  /** Lê `app_settings.communications_enabled`. Erro de leitura deve lançar: nada é consumido. */
  communicationsEnabled: () => Promise<boolean>
  pending: () => Promise<OutboxRow[]>
  contacts: (customerId: number) => Promise<Contact[]>
  /** Contato habilitado na caixa Documentação e Operação, ou da caixa mas suprimido. */
  allowed: (customerId: number, contactId: number) => Promise<ContactEligibility>
  recipientKey: (email: string) => Promise<string>
  /** `simulate`: chave de envio desligada; registra a tentativa sem chamar o provedor. */
  send: (input: { row: OutboxRow; to: string; idempotencyKey: string; simulate: boolean }) => Promise<SendOutcome>
  finish: (id: number, status: OutboxStatus, done: string[], error?: string) => Promise<void>
}

export type NotifySummary = { sent: number; partialSuppressed: number; simulated: number; skipped: number; retry: number; failed: number }

/**
 * B/Ls do bloco "Solicitação" do aviso. O B/L que passou para outra solicitação
 * (evento `bl_moved`) segue na tabela com `active=false`, mas saiu desta, como em
 * `request_json` (migration `301`); o B/L confirmado também fica inativo e continua.
 * `owned` são os B/Ls que ainda são do Cliente da solicitação: o que trocou de
 * Cliente fica fora, como na visão do Portal em `request_json` (auditoria run-3).
 */
export function ceUnlockNoticeBls(
  items: ReadonlyArray<{ bl_id: string }>,
  moved: ReadonlyArray<{ bl_id: string | null }>,
  owned: ReadonlyArray<string>,
): string[] {
  const out = new Set(moved.map((event) => event.bl_id))
  const current = new Set(owned)
  return items.map((item) => item.bl_id).filter((bl) => !out.has(bl) && current.has(bl))
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') return (error as { message: string }).message
  return String(error)
}

async function processRow(deps: NotifyDeps, row: OutboxRow, simulate: boolean, done: Set<string>): Promise<OutboxStatus> {
  const targets: Array<{ email: string; key: string }> = []
  const seen = new Set<string>()
  let suppressed = 0
  for (const contact of await deps.contacts(row.customer_id)) {
    const email = contact.email?.trim().toLowerCase()
    if (!email || seen.has(email)) continue
    const eligibility = await deps.allowed(row.customer_id, contact.id)
    if (eligibility === 'blocked') continue
    seen.add(email)
    // Contato da caixa suprimido não recebe em nenhuma rodada: conta como resolvido sem envio.
    if (eligibility === 'suppressed') suppressed += 1
    else targets.push({ email, key: await deps.recipientKey(email) })
  }
  if (!targets.length && !suppressed) {
    await deps.finish(row.id, 'skipped', [...done], `Sem contato habilitado na caixa ${CE_UNLOCK_BOX}`)
    return 'skipped'
  }
  let failure = false
  for (const target of targets) {
    if (done.has(target.key)) continue
    const outcome = await deps.send({ row, to: target.email, idempotencyKey: `ce-unlock:${row.id}:${target.key}`, simulate })
    if (outcome === 'sent') done.add(target.key)
    // Endereço suprimido não vai receber em nenhuma rodada: conta como resolvido.
    else if (outcome === 'suppressed') suppressed += 1
    else failure = true
  }
  if (failure) {
    if (row.attempts + 1 >= MAX_ATTEMPTS) {
      await deps.finish(row.id, 'failed', [...done], 'Falha de envio após várias tentativas')
      return 'failed'
    }
    await deps.finish(row.id, 'pending', [...done], 'Falha de envio; nova tentativa na próxima execução')
    return 'pending'
  }
  if (!done.size) {
    await deps.finish(row.id, 'skipped', [...done], `Todos os contatos da caixa ${CE_UNLOCK_BOX} estão suprimidos (bounce ou reclamação)`)
    return 'skipped'
  }
  const suppressedNote = suppressed ? `${suppressed} contato(s) suprimido(s) não recebeu(ram)` : undefined
  if (simulate) {
    await deps.finish(row.id, 'simulated', [...done], suppressedNote ?? 'Canal de envio real desligado; envio simulado')
    return 'simulated'
  }
  if (suppressed) {
    await deps.finish(row.id, 'partial', [...done], suppressedNote)
    return 'partial'
  }
  await deps.finish(row.id, 'sent', [...done])
  return 'sent'
}

export async function processCeUnlockEmails(deps: NotifyDeps): Promise<NotifySummary> {
  const summary: NotifySummary = { sent: 0, partialSuppressed: 0, simulated: 0, skipped: 0, retry: 0, failed: 0 }
  // Lida antes da fila: um erro aqui sobe e nenhuma linha é consumida.
  const simulate = !(await deps.communicationsEnabled())
  for (const row of await deps.pending()) {
    const done = new Set(row.done_recipients)
    let status: OutboxStatus
    try {
      status = await processRow(deps, row, simulate, done)
    } catch (error) {
      // Uma linha com erro não trava a fila: conta a tentativa e segue para a próxima.
      const last = row.attempts + 1 >= MAX_ATTEMPTS
      status = last ? 'failed' : 'pending'
      const reason = `Erro ao processar o aviso: ${errorMessage(error)}`.slice(0, 300)
      console.error('[ce-unlock-notify-email] linha', row.id, reason)
      try {
        await deps.finish(row.id, status, [...done], reason)
      } catch (finishError) {
        console.error('[ce-unlock-notify-email] não foi possível registrar a falha da linha', row.id, errorMessage(finishError))
        status = 'failed'
      }
    }
    if (status === 'pending') summary.retry += 1
    // Parcial por supressão é desfecho correto; o nome fica fora de "partial",
    // que o heartbeat lê como falha.
    else if (status === 'partial') summary.partialSuppressed += 1
    else summary[status] += 1
  }
  return summary
}

export type CeUnlockNotifyHandlerDeps = NotifyDeps & {
  refreshOpen: () => Promise<{ data: unknown; error: unknown }>
  /** `trigger`: chamada pelo evento (migration 458), que não varre as solicitações abertas. */
  source?: 'cron' | 'trigger'
  /** Chave, remetente e reply-to do provedor presentes. Só são exigidos com a chave de envio ligada. */
  providerConfigured: boolean
}

/** Corpo do handler HTTP, sem Deno: o status devolvido decide o heartbeat e o Sentry. */
export async function runCeUnlockNotify(deps: CeUnlockNotifyHandlerDeps): Promise<{ status: number; body: unknown }> {
  // A varredura reavalia as abertas pelo que vem de fora do módulo (liquidação) e trava
  // todas elas numa transação: só o cron a faz. O aviso que dispara o gatilho foi gravado
  // por um comando que já reavaliou a própria solicitação; varrer a cada aviso só somava
  // espera, e risco de deadlock, aos comandos do desk e do Portal.
  // `null` na chamada do gatilho: a rodada não varreu.
  let refreshedOpen: unknown = null
  if (deps.source !== 'trigger') {
    const refreshed = await deps.refreshOpen()
    if (refreshed.error) return { status: 500, body: { error: 'Falha ao reavaliar solicitações' } }
    refreshedOpen = refreshed.data
  }
  let enabled: boolean
  try {
    enabled = await deps.communicationsEnabled()
  } catch (error) {
    // Erro passageiro na leitura da chave não pode virar "desligado": a fila fica intacta.
    console.error('[ce-unlock-notify-email] falha ao ler a chave de envio', errorMessage(error))
    return { status: 500, body: { error: 'Falha ao ler a configuração de envio' } }
  }
  // Com a chave ligada e sem chave/remetente nada é consumido: as linhas esperam a configuração.
  if (enabled && !deps.providerConfigured) return { status: 503, body: { error: 'Envio de e-mail não configurado' } }
  const summary = await processCeUnlockEmails({ ...deps, communicationsEnabled: async () => enabled })
  return { status: 200, body: { ...summary, refreshed: refreshedOpen } }
}
