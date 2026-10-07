// Fila de e-mails do Desbloqueio de CE (tabela ce_unlock_email_outbox, preenchida pelo banco).
// Lógica pura, sem Deno nem rede: o handler injeta cliente, envio e configuração.
// ponytail: um executor por vez (cron de minutos); dois executores simultâneos só não duplicam
// e-mail graças à chave de idempotência por destinatário. Upgrade: reservar a linha com SKIP LOCKED.

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

export type NotifyDeps = {
  communicationsEnabled: () => Promise<boolean>
  pending: () => Promise<OutboxRow[]>
  contacts: (customerId: number) => Promise<Contact[]>
  /** Contato habilitado na caixa Documentação e Operação e sem supressão/bounce. */
  allowed: (customerId: number, contactId: number) => Promise<boolean>
  recipientKey: (email: string) => Promise<string>
  send: (input: { row: OutboxRow; to: string; idempotencyKey: string }) => Promise<boolean>
  finish: (id: number, status: 'pending' | 'sent' | 'skipped' | 'failed', done: string[], error?: string) => Promise<void>
}

export type NotifySummary = { sent: number; skipped: number; retry: number; failed: number }

export async function processCeUnlockEmails(deps: NotifyDeps): Promise<NotifySummary> {
  const summary: NotifySummary = { sent: 0, skipped: 0, retry: 0, failed: 0 }
  const enabled = await deps.communicationsEnabled()
  for (const row of await deps.pending()) {
    if (!enabled) {
      await deps.finish(row.id, 'skipped', row.done_recipients, 'Comunicados desligados na configuração geral')
      summary.skipped += 1
      continue
    }
    const targets: Array<{ email: string; key: string }> = []
    const seen = new Set<string>()
    for (const contact of await deps.contacts(row.customer_id)) {
      const email = contact.email?.trim().toLowerCase()
      if (!email || seen.has(email) || !(await deps.allowed(row.customer_id, contact.id))) continue
      seen.add(email)
      targets.push({ email, key: await deps.recipientKey(email) })
    }
    if (!targets.length) {
      await deps.finish(row.id, 'skipped', row.done_recipients, `Sem contato habilitado na caixa ${CE_UNLOCK_BOX}`)
      summary.skipped += 1
      continue
    }
    const done = new Set(row.done_recipients)
    let failure = false
    for (const target of targets) {
      if (done.has(target.key)) continue
      const ok = await deps.send({ row, to: target.email, idempotencyKey: `ce-unlock:${row.id}:${target.key}` })
      if (ok) done.add(target.key)
      else failure = true
    }
    if (!failure) {
      await deps.finish(row.id, 'sent', [...done])
      summary.sent += 1
    } else if (row.attempts + 1 >= MAX_ATTEMPTS) {
      await deps.finish(row.id, 'failed', [...done], 'Falha de envio após várias tentativas')
      summary.failed += 1
    } else {
      await deps.finish(row.id, 'pending', [...done], 'Falha de envio; nova tentativa na próxima execução')
      summary.retry += 1
    }
  }
  return summary
}
