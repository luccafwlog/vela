import { describe, expect, it, vi } from 'vitest'
import { recipientKey, sendEmail } from '../../../supabase/functions/_shared/email.ts'
import {
  communicationAttemptRecorder,
  isPermanentProviderFailure,
  missingProviderConfiguration,
  recordUnsentCommunicationAttempt,
  settleCommunicationStatus,
  type CommunicationAttemptStore,
  type NewCommunicationAttempt,
  type StoredCommunicationAttempt,
} from '../../../supabase/functions/_shared/customerCommunicationAttempts.ts'

// Registro da tentativa e status final da Edge send-customer-communication,
// com banco falso (plano dos e-mails, 1B/1D; revisão do núcleo, item 9).
type Row = StoredCommunicationAttempt & Partial<Omit<NewCommunicationAttempt, 'dispatch_mode'>> & { retry_count?: number }

function fakeStore(options: { refreshed?: unknown; refreshError?: boolean; persistError?: boolean; insertError?: { code?: string; message?: string } } = {}) {
  const rows = new Map<string, Row>()
  const persisted: string[] = []
  let nextId = 1
  const store: CommunicationAttemptStore = {
    insertAttempt: async (row) => {
      if (options.insertError) return { data: null, error: options.insertError }
      if (rows.has(row.idempotency_key)) return { data: null, error: { code: '23505', message: 'duplicate key' } }
      const id = nextId++
      rows.set(row.idempotency_key, { ...row, id, provider_message_id: null })
      return { data: { id }, error: null }
    },
    findAttemptByKey: async (key) => ({ data: rows.get(key) ?? null, error: null }),
    patchAttempt: async (id, patch) => {
      const row = [...rows.values()].find((candidate) => candidate.id === id)
      if (row) Object.assign(row, patch)
      return { error: null }
    },
    refreshStatus: async () => options.refreshError
      ? { data: null, error: { message: 'timeout' } }
      : { data: options.refreshed ?? null, error: null },
    persistStatus: async (_communicationId, status) => {
      persisted.push(status)
      return { error: options.persistError ? { message: 'gravação falhou' } : null }
    },
  }
  return { store, rows, persisted }
}

const KEY = 'comunicado:7:0:sha256:abc'

function accepted(id = 'prov-1') {
  return vi.fn(async () => new Response(JSON.stringify({ id }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
}

function send(store: CommunicationAttemptStore, fetchImpl: typeof fetch) {
  return sendEmail({
    kind: 'aviso_chegada_noa',
    to: 'a@example.test',
    subject: 'NOA',
    html: '<p>NOA</p>',
    text: 'NOA',
    idempotencyKey: KEY,
    resendApiKey: 're_test',
    from: 'noreply@example.test',
    replyTo: 'docs@example.test',
    checkSuppression: async () => ({ suppressed: false }),
    ...communicationAttemptRecorder(store, { communicationId: 7, enabled: true }),
    fetchImpl,
    sleep: async () => undefined,
  })
}

describe('registro da tentativa do Comunicado', () => {
  it('grava aceito com o hash do destinatário e, com a resposta do provedor, o id', async () => {
    const { store, rows } = fakeStore()
    expect(await send(store, accepted('prov-1'))).toEqual({ ok: true })
    expect(rows.get(KEY)).toMatchObject({
      communication_id: 7,
      status: 'aceito',
      dispatch_mode: 'real',
      provider_message_id: 'prov-1',
      recipient_key: await recipientKey('a@example.test'),
      recipient_masked: 'a***@e***.test',
    })
  })

  it('23505: relê a tentativa e o destinatário que já recebeu não recebe de novo', async () => {
    const { store, rows } = fakeStore()
    rows.set(KEY, { id: 41, status: 'aceito', provider_message_id: 'prov-old', dispatch_mode: 'real' })
    const fetchImpl = accepted('prov-new')
    expect(await send(store, fetchImpl)).toEqual({ ok: true })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(rows.get(KEY)!.provider_message_id).toBe('prov-old')
  })

  it('23505 com tentativa aceita sem id: chama o provedor de novo com a mesma chave e grava o id', async () => {
    const { store, rows } = fakeStore()
    rows.set(KEY, { id: 42, status: 'aceito', provider_message_id: null, dispatch_mode: 'legado' })
    const fetchImpl = accepted('prov-retry')
    expect(await send(store, fetchImpl)).toEqual({ ok: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(rows.get(KEY)).toMatchObject({ id: 42, provider_message_id: 'prov-retry', dispatch_mode: 'real', recipient_key: await recipientKey('a@example.test') })
  })

  it('recusa definitiva do provedor vira falha_permanente e marca permanent', async () => {
    const { store, rows } = fakeStore()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ name: 'validation_error' }), { status: 422 }))
    const sent = await send(store, fetchImpl)
    expect(sent).toEqual({ ok: false })
    expect(rows.get(KEY)!.status).toBe('falha_permanente')
    expect(isPermanentProviderFailure(sent.ok, rows.get(KEY)!.status)).toBe(true)
    expect(isPermanentProviderFailure(false, 'falha_transitoria')).toBe(false)
    expect(isPermanentProviderFailure(true, 'falha_permanente')).toBe(false)
  })
})

describe('destinatário que falhou antes de gravar tentativa', () => {
  it('grava falha_transitoria com o motivo, e a próxima chamada a reaproveita', async () => {
    const { store, rows } = fakeStore()
    expect(await recordUnsentCommunicationAttempt(store, {
      communicationId: 7, enabled: true, recipient: 'a@example.test', idempotencyKey: KEY, reason: 'Falha antes do envio: timeout',
    })).toBe(true)
    expect(rows.get(KEY)).toMatchObject({ status: 'falha_transitoria', last_error: 'Falha antes do envio: timeout', dispatch_mode: 'real' })

    // A nova rodada chama o provedor na mesma tentativa.
    const fetchImpl = accepted('prov-2')
    expect(await send(store, fetchImpl)).toEqual({ ok: true })
    expect(rows.get(KEY)).toMatchObject({ status: 'aceito', provider_message_id: 'prov-2' })
  })

  it('tentativa que já existe conta como registrada; erro do banco não', async () => {
    const existing = fakeStore()
    existing.rows.set(KEY, { id: 1, status: 'aceito', provider_message_id: null, dispatch_mode: 'real' })
    expect(await recordUnsentCommunicationAttempt(existing.store, {
      communicationId: 7, enabled: true, recipient: 'a@example.test', idempotencyKey: KEY, reason: 'x',
    })).toBe(true)
    expect(existing.rows.get(KEY)!.status).toBe('aceito')

    const broken = fakeStore({ insertError: { code: '08006', message: 'connection failure' } })
    expect(await recordUnsentCommunicationAttempt(broken.store, {
      communicationId: 7, enabled: false, recipient: 'a@example.test', idempotencyKey: KEY, reason: 'x',
    })).toBe(false)
  })
})

describe('status final do envio', () => {
  it('banco "Em envio" com resposta enviado grava enviado', async () => {
    const { store, persisted } = fakeStore({ refreshed: 'pendente' })
    expect(await settleCommunicationStatus(store, { communicationId: 7, enabled: true, succeeded: 1, failed: 0 }))
      .toEqual({ status: 'enviado', refreshError: null })
    expect(persisted).toEqual(['enviado'])
  })

  it('banco já certo não é regravado', async () => {
    const { store, persisted } = fakeStore({ refreshed: 'parcial' })
    expect((await settleCommunicationStatus(store, { communicationId: 7, enabled: true, succeeded: 1, failed: 0 })).status).toBe('parcial')
    expect(persisted).toEqual([])
  })

  it('falha ao gravar o status resolvido sobe como erro, não como sucesso', async () => {
    const { store } = fakeStore({ refreshed: 'pendente', persistError: true })
    const result = await settleCommunicationStatus(store, { communicationId: 7, enabled: true, succeeded: 1, failed: 0 })
    expect(result.refreshError).toMatchObject({ message: 'gravação falhou' })
  })

  it('sem recálculo, grava o resolvido e devolve o erro', async () => {
    const { store, persisted } = fakeStore({ refreshError: true })
    const result = await settleCommunicationStatus(store, { communicationId: 7, enabled: true, succeeded: 0, failed: 0, unrecordedFailures: 1 })
    expect(result.status).toBe('falha')
    expect(result.refreshError).toMatchObject({ message: 'timeout' })
    expect(persisted).toEqual(['falha'])
  })
})

describe('pré-check da configuração do provedor', () => {
  const full = { resendApiKey: 're_x', from: 'noreply@example.test', replyTo: 'docs@example.test' }

  it('envio real exige chave, remetente e reply-to', () => {
    expect(missingProviderConfiguration(true, full)).toBe(false)
    expect(missingProviderConfiguration(true, { ...full, resendApiKey: '' })).toBe(true)
    expect(missingProviderConfiguration(true, { ...full, from: undefined })).toBe(true)
    expect(missingProviderConfiguration(true, { ...full, replyTo: null })).toBe(true)
  })

  it('em simulação a configuração não é exigida', () => {
    expect(missingProviderConfiguration(false, {})).toBe(false)
  })
})
