// Registro da tentativa de um Comunicado e status final do envio, sem
// dependência remota, para o teste com banco falso rodar no Vitest. A Edge
// send-customer-communication só injeta o acesso ao banco (plano dos e-mails,
// 1B e 1D; migration 315).
import { maskEmail, recipientKey, type EmailAttemptRecord, type EmailAttemptUpdate } from './email.ts'
import { resolveDispatchStatus, statusToPersist, type ResolvedDispatchStatus } from './communicationDispatchStatus.ts'

export type AttemptDbError = { code?: string; message?: string } | null

export type StoredCommunicationAttempt = {
  id: string | number
  status: string
  provider_message_id: string | null
  dispatch_mode: string
}

export type NewCommunicationAttempt = {
  communication_id: number
  recipient_masked: string
  recipient_key: string
  status: 'aceito' | 'falha_transitoria'
  dispatch_mode: 'real' | 'simulado'
  idempotency_key: string
  last_error?: string | null
}

/** Acesso ao banco de que o registro precisa; a Edge implementa com o cliente Supabase. */
export type CommunicationAttemptStore = {
  insertAttempt(row: NewCommunicationAttempt): PromiseLike<{ data: { id: string | number } | null; error: AttemptDbError }>
  findAttemptByKey(idempotencyKey: string): PromiseLike<{ data: StoredCommunicationAttempt | null; error: AttemptDbError }>
  patchAttempt(id: string | number, patch: Record<string, unknown>): PromiseLike<{ error: AttemptDbError }>
  refreshStatus(communicationId: number): PromiseLike<{ data: unknown; error: AttemptDbError }>
  persistStatus(communicationId: number, status: ResolvedDispatchStatus): PromiseLike<{ error: AttemptDbError }>
}

function dispatchMode(enabled: boolean): 'real' | 'simulado' {
  return enabled ? 'real' : 'simulado'
}

/**
 * `recordAttempt`/`updateAttempt` do sendEmail. Na corrida (23505), relê a
 * tentativa pela chave e segue com ela: o destinatário que já recebeu não
 * recebe de novo, e uma tentativa sem id do provedor volta a chamar o provedor
 * com a mesma chave. Tentativa sem confirmação do provedor (legada, ou de
 * uma rodada com a chave no outro estado) ganha o modo atual: sem isso, um
 * e-mail simulado apareceria como "Real" no Histórico, e vice-versa.
 */
export function communicationAttemptRecorder(
  store: CommunicationAttemptStore,
  input: { communicationId: number; enabled: boolean },
): {
  recordAttempt: (args: { kind: string; to: string; idempotencyKey: string }) => Promise<EmailAttemptRecord>
  updateAttempt: (attemptId: string | number, update: EmailAttemptUpdate) => Promise<void>
} {
  return {
    async recordAttempt({ kind, to, idempotencyKey }) {
      const { data, error } = await store.insertAttempt({
        communication_id: input.communicationId,
        recipient_masked: maskEmail(to),
        recipient_key: await recipientKey(to),
        status: 'aceito',
        dispatch_mode: dispatchMode(input.enabled),
        idempotency_key: idempotencyKey,
      })
      if (error?.code === '23505') {
        const { data: existing, error: existingError } = await store.findAttemptByKey(idempotencyKey)
        if (existingError || !existing) throw existingError ?? error
        const mode = dispatchMode(input.enabled)
        const unconfirmed = existing.provider_message_id == null && (existing.status === 'aceito' || existing.status === 'falha_transitoria')
        if (unconfirmed && existing.dispatch_mode !== mode) {
          const { error: repairError } = await store.patchAttempt(existing.id, {
            ...(existing.dispatch_mode === 'legado' ? { recipient_key: await recipientKey(to) } : {}),
            dispatch_mode: mode,
          })
          if (repairError) throw repairError
        }
        return { id: existing.id, status: existing.status as EmailAttemptRecord['status'], providerMessageId: existing.provider_message_id, existing: true }
      }
      if (error || !data) throw error ?? new Error(`Não foi possível registrar a tentativa ${kind}.`)
      return { id: data.id, status: 'aceito', providerMessageId: null, existing: false }
    },
    async updateAttempt(attemptId, update) {
      const { error } = await store.patchAttempt(attemptId, {
        provider_message_id: update.providerMessageId,
        retry_count: update.retryCount,
        status: update.status,
        last_error: update.lastError,
      })
      if (error) throw error
    },
  }
}

/**
 * Destinatário que falhou antes de gravar tentativa (consulta de supressão,
 * registro, exceção inesperada): grava `falha_transitoria` com o motivo, para
 * o Histórico mostrar o destinatário e o status contar a falha. A próxima
 * chamada com a mesma chave reaproveita esta tentativa e chama o provedor.
 * Devolve false quando nem isso foi possível (o banco não vê o destinatário).
 */
export async function recordUnsentCommunicationAttempt(
  store: CommunicationAttemptStore,
  input: { communicationId: number; enabled: boolean; recipient: string; idempotencyKey: string; reason: string },
): Promise<boolean> {
  try {
    const { error } = await store.insertAttempt({
      communication_id: input.communicationId,
      recipient_masked: maskEmail(input.recipient),
      recipient_key: await recipientKey(input.recipient),
      status: 'falha_transitoria',
      dispatch_mode: dispatchMode(input.enabled),
      idempotency_key: input.idempotencyKey,
      last_error: input.reason.slice(0, 500),
    })
    // Já existe tentativa com a chave: o destinatário já está visível.
    return !error || error.code === '23505'
  } catch {
    return false
  }
}

/**
 * Recalcula o status pelas tentativas e grava o resolvido quando o banco ficou
 * diferente dele (inclusive `pendente` com resposta `enviado`).
 */
export async function settleCommunicationStatus(
  store: CommunicationAttemptStore,
  input: { communicationId: number; enabled: boolean; succeeded: number; failed: number; unrecordedFailures?: number },
): Promise<{ status: ResolvedDispatchStatus; refreshError: AttemptDbError }> {
  const { data: refreshed, error: refreshError } = await store.refreshStatus(input.communicationId)
  const status = resolveDispatchStatus({
    refreshed: refreshError ? null : refreshed,
    communicationsEnabled: input.enabled,
    succeeded: input.succeeded,
    failed: input.failed,
    unrecordedFailures: input.unrecordedFailures,
  })
  // Sem recálculo, grava o resolvido: o Comunicado não fica "Em envio" sem dono.
  const persist = statusToPersist(refreshError ? null : refreshed, status)
  let persistError: AttemptDbError = null
  if (persist) {
    const { error } = await store.persistStatus(input.communicationId, persist)
    // Sobe para a Edge responder erro: o Comunicado não pode ficar "Em envio"
    // com a resposta dizendo que saiu. Repetir reaproveita a mesma tentativa.
    if (error) persistError = error
  }
  return { status, refreshError: refreshError ?? persistError ?? null }
}

/** Envio real ligado sem a configuração do provedor: recusa antes de registrar o Comunicado. */
export function missingProviderConfiguration(
  enabled: boolean,
  env: { resendApiKey?: string | null; from?: string | null; replyTo?: string | null },
): boolean {
  return enabled && (!env.resendApiKey || !env.from || !env.replyTo)
}

/** Recusa definitiva do provedor: a mesma chave nunca mais o chama; a régua rejeita a claim (1D.4). */
export function isPermanentProviderFailure(sentOk: boolean, attemptStatus: string | null | undefined): boolean {
  return !sentOk && attemptStatus === 'falha_permanente'
}
