import { describe, expect, it, vi } from 'vitest'
import {
  assertRealSendConfigured,
  dunningIdempotencyKey,
  MISSING_SENDER_MESSAGE,
  dunningResumeDispatchId,
  runDemurrageDunning,
  type DunningCandidate,
  type DunningClaimOutcome,
  type DunningInvoiceContext,
  type DunningStore,
} from '../../../supabase/functions/_shared/demurrageDunningRunner.ts'
import type { EmailAttemptRecord, EmailAttemptUpdate } from '../../../supabase/functions/_shared/email.ts'

// Plano dos e-mails, 1E.5: a rodada da Régua de Cobrança com banco e provedor
// falsos. O banco falso projeta o status do Comunicado como
// refresh_customer_communication_status (última tentativa por destinatário).

type Attempt = { id: number; communicationId: number; key: string; to: string; status: EmailAttemptRecord['status']; providerMessageId: string | null; mode: 'real' | 'simulado' }

function candidate(invoiceId: number, overrides: Partial<DunningCandidate> = {}): DunningCandidate {
  return {
    invoice_id: invoiceId,
    customer_id: 7,
    bl_id: `BL-${invoiceId}`,
    doc_number: `DEM-${invoiceId}`,
    total_usd: 100,
    current_total_brl: 550,
    current_roe: 5.5,
    roe_source: 'manual',
    first_billed_at: '2026-09-01',
    claimed_at: '2026-09-10T12:00:00Z',
    roe_reference_date: '2026-09-08',
    attempt_discriminator: 1,
    resume_generation: 0,
    ...overrides,
  }
}

function context(invoiceId: number, vessel = 'NAVIO A', voyage = 'V1'): DunningInvoiceContext {
  return {
    id: invoiceId,
    customer_id: 7,
    bl_id: `BL-${invoiceId}`,
    doc_number: `DEM-${invoiceId}`,
    total_usd: 100,
    discount_mode: null,
    discount_value: null,
    current_total_brl: 550,
    current_roe: 5.5,
    first_billed_at: '2026-09-01',
    updated_at: '2026-09-09T10:00:00Z',
    customer: { id: 7, name: 'CLIENTE TESTE' },
    bl: { id: `BL-${invoiceId}`, pod: 'BRVIX', voyage: { id: 1, voyage_number: voyage, vessel: { name: vessel } } },
  }
}

type FakeOptions = {
  candidates: DunningCandidate[]
  contexts?: DunningInvoiceContext[]
  contacts?: Array<{ id: number; email: string }>
  communicationsEnabled?: boolean
  /** Por fatura: sequência de respostas de isSendable (a última se repete). */
  sendable?: Record<number, boolean[]>
}

function fakeStore(options: FakeOptions) {
  const contexts = new Map((options.contexts ?? options.candidates.map((item) => context(item.invoice_id))).map((item) => [item.id, item]))
  const contacts = options.contacts ?? [{ id: 1, email: 'ana@cliente.test' }]
  const attempts: Attempt[] = []
  const communications = new Map<number, { status: string; mode: 'single' | 'group'; invoiceIds: number[]; resumeGeneration: number }>()
  const settled: Array<{ invoiceId: number; outcome: DunningClaimOutcome; reason: string | null | undefined }> = []
  const settledCommunication = new Map<number, number | null | undefined>()
  const sendableCalls = new Map<number, number>()
  let nextId = 100

  const store: DunningStore = {
    loadCommunicationsEnabled: async () => options.communicationsEnabled ?? true,
    claimCandidates: async () => options.candidates,
    loadRecipients: async () => contacts,
    loadInvoice: async (invoiceId) => contexts.get(invoiceId)!,
    isSendable: async (invoiceId) => {
      const sequence = options.sendable?.[invoiceId] ?? [true]
      const call = sendableCalls.get(invoiceId) ?? 0
      sendableCalls.set(invoiceId, call + 1)
      return sequence[Math.min(call, sequence.length - 1)]!
    },
    currentEligibleRecipient: async (_customerId, contactId) => contacts.find((item) => item.id === contactId)?.email ?? null,
    createCommunication: async ({ mode, candidates, resumeGeneration }) => {
      // Como create_customer_communication_atomic: a mesma âncora, tentativa e
      // geração da retomada (migration 317) devolvem o mesmo Comunicado.
      const invoiceIds = candidates.map((item) => item.invoice_id).join(',')
      const reused = [...communications.entries()].find(([, value]) => value.mode === mode && value.invoiceIds.join(',') === invoiceIds && value.resumeGeneration === resumeGeneration)
      if (reused) return reused[0]
      const id = nextId++
      communications.set(id, { status: 'pendente', mode, invoiceIds: candidates.map((item) => item.invoice_id), resumeGeneration })
      return id
    },
    checkSuppression: async () => ({ suppressed: false }),
    recordAttempt: async ({ communicationId, attemptKey, to, communicationsEnabled }) => {
      const existing = attempts.find((item) => item.key === attemptKey)
      if (existing) return { id: existing.id, status: existing.status, providerMessageId: existing.providerMessageId, idempotencyKey: existing.key, existing: true }
      const attempt: Attempt = { id: nextId++, communicationId, key: attemptKey, to, status: 'aceito', providerMessageId: null, mode: communicationsEnabled ? 'real' : 'simulado' }
      attempts.push(attempt)
      return { id: attempt.id, status: 'aceito', providerMessageId: null, idempotencyKey: attemptKey, existing: false }
    },
    updateAttempt: async (attemptId, update: EmailAttemptUpdate) => {
      const attempt = attempts.find((item) => item.id === attemptId)!
      attempt.status = update.status
      attempt.providerMessageId = update.providerMessageId ?? null
    },
    refreshStatus: async (communicationId) => {
      const latest = new Map<string, Attempt>()
      for (const attempt of attempts.filter((item) => item.communicationId === communicationId)) latest.set(attempt.to, attempt)
      const rows = [...latest.values()]
      const success = rows.filter((row) => (row.mode === 'simulado' && row.status === 'aceito') || row.status === 'entregue' || (row.status === 'aceito' && row.providerMessageId)).length
      const failures = rows.filter((row) => ['falha_transitoria', 'falha_permanente', 'bounce', 'complaint'].includes(row.status)).length
      const pending = rows.filter((row) => row.mode === 'real' && row.status === 'aceito' && !row.providerMessageId).length
      const communication = communications.get(communicationId)!
      if (!rows.length) return communication.status
      const simulatedOnly = rows.every((row) => row.mode === 'simulado')
      const status = (failures || pending) && success ? 'parcial' : pending ? 'pendente' : failures ? 'falha' : simulatedOnly ? 'simulado' : 'enviado'
      communication.status = status
      return status
    },
    persistStatus: async (communicationId, status) => {
      communications.get(communicationId)!.status = status
    },
    settleClaim: async (item, outcome, reason, communicationId) => {
      settled.push({ invoiceId: item.invoice_id, outcome, reason })
      settledCommunication.set(item.invoice_id, communicationId)
    },
  }
  return { store, attempts, communications, settled, settledCommunication }
}

function providerResponses(...responses: Array<{ status: number; body?: unknown } | Error>) {
  const queue = [...responses]
  const requests: Array<{ body: { subject: string; html: string; text: string; to: string[] }; idempotencyKey: string }> = []
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      body: JSON.parse(String(init?.body)),
      idempotencyKey: String((init?.headers as Record<string, string>)['Idempotency-Key']),
    })
    const next = queue.length > 1 ? queue.shift()! : queue[0]!
    if (next instanceof Error) throw next
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status, headers: { 'Content-Type': 'application/json' } })
  })
  return { fetcher: fetcher as unknown as typeof fetch, requests }
}

const config = { resendApiKey: 're_test', from: 'cobranca@fwlog.test', replyTo: 'demurrage@fwlog.test', portalUrl: 'https://portal.test/portal/billing' }
const quietLog = () => ({ warn: vi.fn(), error: vi.fn() })

describe('rodada da Régua de Cobrança com banco e provedor falsos', () => {
  it('envio aceito: Comunicado enviado, posição mantida e contador sent', async () => {
    const fake = fakeStore({ candidates: [candidate(1)] })
    const provider = providerResponses({ status: 200, body: { id: 'msg-1' } })
    const result = await runDemurrageDunning({ store: fake.store, config, fetcher: provider.fetcher, sleep: async () => {}, log: quietLog() })
    expect(result).toEqual({ status: 200, body: expect.objectContaining({ claimed: 1, sent: 1, failed: 0, refused: 0, paused: 0 }) })
    expect(fake.settled).toEqual([{ invoiceId: 1, outcome: 'sent', reason: null }])
    expect(provider.requests[0]!.body.subject).toBe('Cobrança de Demurrage — DEM-1 — NAVIO A / V1')
  })

  it('rede caída com a chave ligada: Comunicado em falha, posição devolvida e failed > 0', async () => {
    const fake = fakeStore({ candidates: [candidate(1)] })
    const provider = providerResponses(new TypeError('network down'))
    const result = await runDemurrageDunning({ store: fake.store, config, fetcher: provider.fetcher, sleep: async () => {}, log: quietLog() })
    expect(result.body).toMatchObject({ failed: 1, sent: 0, refused: 0 })
    expect([...fake.communications.values()][0]!.status).toBe('falha')
    expect(fake.settled).toEqual([{ invoiceId: 1, outcome: 'failed', reason: expect.stringContaining('Falha de rede') }])
  })

  it('1E.1 — recusa definitiva do provedor (422) suspende a fatura em vez de liberar', async () => {
    const fake = fakeStore({ candidates: [candidate(1)] })
    const provider = providerResponses({ status: 422, body: { name: 'validation_error' } })
    const result = await runDemurrageDunning({ store: fake.store, config, fetcher: provider.fetcher, sleep: async () => {}, log: quietLog() })
    expect(result.body).toMatchObject({ failed: 1, refused: 1 })
    expect(fake.settled).toEqual([{ invoiceId: 1, outcome: 'refused', reason: 'HTTP 422 validation_error' }])
    expect(provider.fetcher).toHaveBeenCalledTimes(1)
  })

  it('1E.1 — 403 é configuração do provedor: volta a ser tentado, não suspende', async () => {
    const fake = fakeStore({ candidates: [candidate(1)] })
    const provider = providerResponses({ status: 403 })
    const result = await runDemurrageDunning({ store: fake.store, config, fetcher: provider.fetcher, sleep: async () => {}, log: quietLog() })
    expect(result.body).toMatchObject({ failed: 1, refused: 0 })
    expect(fake.settled[0]).toMatchObject({ outcome: 'failed', reason: expect.stringContaining('HTTP 403') })
  })

  it('tentativa anterior recusada em definitivo não chama o provedor de novo e segue recusada', async () => {
    const fake = fakeStore({ candidates: [candidate(1)] })
    const provider = providerResponses({ status: 422 })
    await runDemurrageDunning({ store: fake.store, config, fetcher: provider.fetcher, sleep: async () => {}, log: quietLog() })
    fake.settled.length = 0
    const again = await runDemurrageDunning({ store: fake.store, config, fetcher: provider.fetcher, sleep: async () => {}, log: quietLog() })
    expect(provider.fetcher).toHaveBeenCalledTimes(1)
    expect(again.body).toMatchObject({ refused: 1 })
    expect(fake.settled[0]).toMatchObject({ outcome: 'refused' })
  })

  it('retomada depois da recusa usa chave nova e chama o provedor', async () => {
    const fake = fakeStore({ candidates: [candidate(1)] })
    const refused = providerResponses({ status: 422 })
    await runDemurrageDunning({ store: fake.store, config, fetcher: refused.fetcher, sleep: async () => {}, log: quietLog() })

    const resumed = fakeStore({ candidates: [candidate(1, { resume_generation: 1 })] })
    resumed.attempts.push(...fake.attempts)
    const provider = providerResponses({ status: 200, body: { id: 'msg-2' } })
    const result = await runDemurrageDunning({ store: resumed.store, config, fetcher: provider.fetcher, sleep: async () => {}, log: quietLog() })
    expect(result.body).toMatchObject({ sent: 1 })
    expect(provider.requests[0]!.idempotencyKey).toContain(':r1:')
    expect(await dunningIdempotencyKey('single', 100, 1, 'ana@cliente.test', 0)).not.toContain(':r')
  })

  it('317 (R3) — retomada com o e-mail corrigido nasce num Comunicado novo e fica enviado, não parcial', async () => {
    const contacts = [{ id: 1, email: 'ana@cliente-errado.test' }]
    const fake = fakeStore({ candidates: [candidate(1)], contacts })
    await runDemurrageDunning({ store: fake.store, config, fetcher: providerResponses({ status: 422 }).fetcher, sleep: async () => {}, log: quietLog() })
    const refusedId = [...fake.communications.keys()][0]!
    expect(fake.communications.get(refusedId)!.status).toBe('falha')

    // O Administrativo corrige o e-mail e resolve o alerta: a posição volta com a geração 1.
    contacts[0]!.email = 'ana@cliente.test'
    fake.store.claimCandidates = async () => [candidate(1, { resume_generation: 1 })]
    fake.settled.length = 0
    const result = await runDemurrageDunning({ store: fake.store, config, fetcher: providerResponses({ status: 200, body: { id: 'msg-2' } }).fetcher, sleep: async () => {}, log: quietLog() })
    expect(result.body).toMatchObject({ sent: 1, partial: 0 })
    const resumedId = [...fake.communications.keys()].find((id) => id !== refusedId)!
    expect(resumedId).toBeDefined()
    expect(fake.communications.get(resumedId)!.status).toBe('enviado')
    expect(fake.communications.get(refusedId)!.status).toBe('falha')
    expect(fake.settled).toEqual([{ invoiceId: 1, outcome: 'sent', reason: null }])
    // O dispatch_id do Comunicado unitário da retomada é estável por geração.
    expect(await dunningResumeDispatchId(1, 1, 0)).toBeNull()
    expect(await dunningResumeDispatchId(1, 1, 1)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(await dunningResumeDispatchId(1, 1, 1)).toBe(await dunningResumeDispatchId(1, 1, 1))
    expect(await dunningResumeDispatchId(1, 1, 2)).not.toBe(await dunningResumeDispatchId(1, 1, 1))
  })

  it('317 (R1) — exceção depois da entrega não devolve a posição de quem já recebeu', async () => {
    const fake = fakeStore({
      candidates: [candidate(1), candidate(2)],
      contacts: [{ id: 1, email: 'ana@cliente.test' }, { id: 2, email: 'bruno@cliente.test' }],
    })
    fake.store.refreshStatus = async () => { throw new Error('db down') }
    const provider = providerResponses({ status: 200, body: { id: 'msg-1' } })
    const result = await runDemurrageDunning({ store: fake.store, config, fetcher: provider.fetcher, sleep: async () => {}, log: quietLog() })
    expect(provider.fetcher).toHaveBeenCalledTimes(2)
    expect(result.body).toMatchObject({ partial: 1, failed: 0 })
    expect(fake.settled.map((item) => [item.invoiceId, item.outcome])).toEqual([[1, 'partial'], [2, 'partial']])
  })

  it('317 (R1) — erro ao conferir um destinatário conta como falha dele e não aborta os demais', async () => {
    const fake = fakeStore({
      candidates: [candidate(1)],
      contacts: [{ id: 1, email: 'ana@cliente.test' }, { id: 2, email: 'bruno@cliente.test' }, { id: 3, email: 'carla@cliente.test' }],
    })
    const eligible = fake.store.currentEligibleRecipient
    fake.store.currentEligibleRecipient = async (customerId, contactId) => {
      if (contactId === 2) throw new Error('timeout ao ler o contato')
      return eligible(customerId, contactId)
    }
    const provider = providerResponses({ status: 200, body: { id: 'msg-1' } }, { status: 200, body: { id: 'msg-3' } })
    const result = await runDemurrageDunning({ store: fake.store, config, fetcher: provider.fetcher, sleep: async () => {}, log: quietLog() })
    expect(provider.requests.map((item) => item.body.to[0])).toEqual(['ana@cliente.test', 'carla@cliente.test'])
    expect(result.body).toMatchObject({ partial: 1, failed: 0 })
    expect(fake.settled).toEqual([{ invoiceId: 1, outcome: 'partial', reason: null }])
  })

  it('317 (R1) — banco sem decisão e falha de outro destinatário: quem recebeu mantém a posição', async () => {
    const fake = fakeStore({
      candidates: [candidate(1)],
      contacts: [{ id: 1, email: 'ana@cliente.test' }, { id: 2, email: 'bruno@cliente.test' }],
    })
    // O provedor aceita, mas o id não é gravado (tentativa fica aceita sem id: "Em envio").
    fake.store.updateAttempt = async () => { throw new Error('db down') }
    const eligible = fake.store.currentEligibleRecipient
    fake.store.currentEligibleRecipient = async (customerId, contactId) => {
      if (contactId === 2) throw new Error('timeout ao ler o contato')
      return eligible(customerId, contactId)
    }
    const result = await runDemurrageDunning({ store: fake.store, config, fetcher: providerResponses({ status: 200, body: { id: 'msg-1' } }).fetcher, sleep: async () => {}, log: quietLog() })
    expect(result.body).toMatchObject({ partial: 1, failed: 0 })
    expect(fake.settled).toEqual([{ invoiceId: 1, outcome: 'partial', reason: null }])
  })

  it('parcial com recusa definitiva: mantém a posição e leva o motivo para o alerta', async () => {
    const fake = fakeStore({
      candidates: [candidate(1)],
      contacts: [{ id: 1, email: 'ana@cliente.test' }, { id: 2, email: 'bruno@cliente.test' }],
    })
    const provider = providerResponses({ status: 200, body: { id: 'msg-1' } }, { status: 422 })
    const result = await runDemurrageDunning({ store: fake.store, config, fetcher: provider.fetcher, sleep: async () => {}, log: quietLog() })
    expect(result.body).toMatchObject({ partial: 1, failed: 0 })
    expect(fake.settled).toEqual([{ invoiceId: 1, outcome: 'partial', reason: 'HTTP 422' }])
  })

  it('chave desligada: simula, conta como cobrança e não chama o provedor', async () => {
    const fake = fakeStore({ candidates: [candidate(1)], communicationsEnabled: false })
    const provider = providerResponses({ status: 500 })
    const result = await runDemurrageDunning({ store: fake.store, config: { ...config, resendApiKey: null }, fetcher: provider.fetcher, sleep: async () => {}, log: quietLog() })
    expect(result.body).toMatchObject({ simulated: 1, failed: 0 })
    expect(provider.fetcher).not.toHaveBeenCalled()
    expect(fake.settled[0]).toMatchObject({ outcome: 'sent' })
  })

  it('chave ligada sem remetente: não cria Comunicado e conta a falha', async () => {
    const fake = fakeStore({ candidates: [candidate(1)] })
    const provider = providerResponses({ status: 200 })
    const result = await runDemurrageDunning({ store: fake.store, config: { ...config, from: null }, fetcher: provider.fetcher, sleep: async () => {}, log: quietLog() })
    expect(result.body).toMatchObject({ failed: 1 })
    expect(fake.communications.size).toBe(0)
    expect(fake.settled[0]).toMatchObject({ outcome: 'failed', reason: expect.stringContaining('PORTAL_FROM_EMAIL') })
  })

  it('fatura que deixou de ser cobrável antes do envio pausa sem consumir a posição', async () => {
    const fake = fakeStore({ candidates: [candidate(1)], sendable: { 1: [false] } })
    const result = await runDemurrageDunning({ store: fake.store, config, fetcher: providerResponses({ status: 200 }).fetcher, sleep: async () => {}, log: quietLog() })
    expect(result.body).toMatchObject({ paused: 1, failed: 0 })
    expect(fake.settled).toEqual([{ invoiceId: 1, outcome: 'paused', reason: expect.any(String) }])
  })

  it('4.1 — cobrança agrupada: assunto geral, navio, viagem e ROE com data por linha', async () => {
    const fake = fakeStore({
      candidates: [candidate(1), candidate(2, { roe_reference_date: '2026-09-09', current_roe: 5.6 })],
      contexts: [context(1, 'NAVIO A', 'V1'), context(2, 'NAVIO B', 'V9')],
    })
    const provider = providerResponses({ status: 200, body: { id: 'msg-1' } })
    const result = await runDemurrageDunning({ store: fake.store, config, fetcher: provider.fetcher, sleep: async () => {}, log: quietLog() })
    expect(result.body).toMatchObject({ sent: 1 })
    const email = provider.requests[0]!.body
    expect(email.subject).toBe('Cobrança de Demurrage — 2 faturas')
    expect(email.text).toContain('DEM-1 — B/L BL-1 — NAVIO A / V1')
    expect(email.text).toContain('DEM-2 — B/L BL-2 — NAVIO B / V9')
    expect(email.text).toContain('ROE 5.6000 com referência em 09/09/2026')
    expect(email.text).toContain('O valor em reais será recalculado no dia do pagamento.')
    expect(email.html).toContain('fwlog-logo-white.png')
    expect(provider.requests[0]!.idempotencyKey).toMatch(/^demurrage:group:/)
  })

  it('1E.4 — pausa no meio do grupo tira a fatura da mensagem seguinte sem reenviar a quem já recebeu', async () => {
    const fake = fakeStore({
      candidates: [candidate(1), candidate(2)],
      contacts: [{ id: 1, email: 'ana@cliente.test' }, { id: 2, email: 'bruno@cliente.test' }],
      // Fatura 2: cobrável na composição e no 1º destinatário; deixa de ser no 2º.
      sendable: { 1: [true], 2: [true, true, false] },
    })
    const provider = providerResponses({ status: 200, body: { id: 'msg-1' } }, { status: 200, body: { id: 'msg-2' } })
    const result = await runDemurrageDunning({ store: fake.store, config, fetcher: provider.fetcher, sleep: async () => {}, log: quietLog() })
    expect(result.body).toMatchObject({ sent: 1, paused: 0, failed: 0 })
    expect(provider.fetcher).toHaveBeenCalledTimes(2)
    expect(provider.requests[0]!.body.text).toContain('DEM-2')
    expect(provider.requests[1]!.body.text).not.toContain('DEM-2')
    // A fatura 2 já chegou a um destinatário: a posição dela fica consumida.
    expect(fake.settled.map((item) => [item.invoiceId, item.outcome])).toEqual([[1, 'sent'], [2, 'sent']])
  })

  it('1E.4 — fatura que sai antes de qualquer entrega pausa só ela; as demais seguem', async () => {
    const fake = fakeStore({
      candidates: [candidate(1), candidate(2)],
      sendable: { 1: [true], 2: [true, false] },
    })
    const provider = providerResponses({ status: 200, body: { id: 'msg-1' } })
    const result = await runDemurrageDunning({ store: fake.store, config, fetcher: provider.fetcher, sleep: async () => {}, log: quietLog() })
    expect(result.body).toMatchObject({ sent: 1, paused: 0 })
    expect(provider.requests[0]!.body.text).not.toContain('DEM-2')
    expect(fake.settled.map((item) => [item.invoiceId, item.outcome])).toEqual([[2, 'paused'], [1, 'sent']])
  })

  it('1E.2 — fatura pausada depois de criado o Comunicado sai dele (o desfecho leva o Comunicado)', async () => {
    const fake = fakeStore({
      candidates: [candidate(1), candidate(2)],
      sendable: { 1: [true], 2: [true, false] },
    })
    await runDemurrageDunning({ store: fake.store, config, fetcher: providerResponses({ status: 200, body: { id: 'msg-1' } }).fetcher, sleep: async () => {}, log: quietLog() })
    const communicationId = [...fake.communications.keys()][0]
    expect(fake.settledCommunication.get(2)).toBe(communicationId)
    // Pausa antes do Comunicado não tem de onde sair.
    const early = fakeStore({ candidates: [candidate(3)], sendable: { 3: [false] } })
    await runDemurrageDunning({ store: early.store, config, fetcher: providerResponses({ status: 200 }).fetcher, sleep: async () => {}, log: quietLog() })
    expect(early.settledCommunication.get(3)).toBeNull()
  })

  it('4.1 — Invoice sem ROE ou sem navio sai do grupo com pausa; as demais seguem sem contar falha', async () => {
    const semRoe = { ...context(2), current_roe: null, current_total_brl: null }
    const semNavio = { ...context(3), bl: { id: 'BL-3', pod: 'BRVIX', voyage: null } }
    const fake = fakeStore({
      candidates: [candidate(1), candidate(2, { current_roe: null, current_total_brl: null }), candidate(3)],
      contexts: [context(1), semRoe, semNavio],
    })
    const provider = providerResponses({ status: 200, body: { id: 'msg-1' } })
    const result = await runDemurrageDunning({ store: fake.store, config, fetcher: provider.fetcher, sleep: async () => {}, log: quietLog() })
    expect(result.body).toMatchObject({ sent: 1, failed: 0, refused: 0 })
    expect(provider.fetcher).toHaveBeenCalledTimes(1)
    expect(provider.requests[0]!.body.text).toContain('DEM-1')
    expect(provider.requests[0]!.body.text).not.toContain('DEM-2')
    expect(provider.requests[0]!.body.text).not.toContain('DEM-3')
    expect(fake.settled).toEqual([
      { invoiceId: 2, outcome: 'paused', reason: expect.stringMatching(/^Dados incompletos para a cobrança: falta .*ROE/) },
      { invoiceId: 3, outcome: 'paused', reason: expect.stringMatching(/^Dados incompletos para a cobrança: falta navio, viagem/) },
      { invoiceId: 1, outcome: 'sent', reason: null },
    ])
    // O Comunicado nasce só com a Invoice completa.
    expect([...fake.communications.values()][0]!.invoiceIds).toEqual([1])
  })

  it('4.1 — grupo todo incompleto pausa sem criar Comunicado nem chamar o provedor', async () => {
    const fake = fakeStore({ candidates: [candidate(1, { current_roe: null })], contexts: [{ ...context(1), current_roe: null }] })
    const provider = providerResponses({ status: 200 })
    const result = await runDemurrageDunning({ store: fake.store, config, fetcher: provider.fetcher, sleep: async () => {}, log: quietLog() })
    expect(result.body).toMatchObject({ paused: 1, failed: 0 })
    expect(fake.communications.size).toBe(0)
    expect(provider.fetcher).not.toHaveBeenCalled()
  })

  it('5.1/2.5 — logs de falha levam fatura, Cliente, tentativa e motivo, com o e-mail mascarado', async () => {
    const log = quietLog()
    const fake = fakeStore({ candidates: [candidate(1)] })
    await runDemurrageDunning({ store: fake.store, config, fetcher: providerResponses({ status: 422 }).fetcher, sleep: async () => {}, log })
    const logged = JSON.stringify([...log.warn.mock.calls, ...log.error.mock.calls])
    expect(logged).not.toContain('ana@cliente.test')
    expect(logged).toContain('a***@c***.test')
    expect(log.warn).toHaveBeenCalledWith('[demurrage-dunning] cobrança recusada em definitivo', expect.objectContaining({ invoiceId: 1, customerId: 7, attempt: 1, reason: 'HTTP 422' }))
  })

  it('falha ao gravar o desfecho deixa a rodada em 500 (heartbeat vermelho)', async () => {
    const fake = fakeStore({ candidates: [candidate(1)] })
    fake.store.settleClaim = async () => { throw new Error('db down') }
    const result = await runDemurrageDunning({ store: fake.store, config, fetcher: providerResponses({ status: 200, body: { id: 'x' } }).fetcher, sleep: async () => {}, log: quietLog() })
    expect(result.status).toBe(500)
    expect(result.body.releaseFailures).toBe(1)
  })
})

// Decisão de 2026-10-20: a cobrança mostra e recebe em DEMURRAGE_REPLY_TO; sem
// ele o envio real é recusado, em vez de a resposta cair na caixa dos Comunicados.
describe('envio real exige o reply-to da Demurrage', () => {
  const config = { resendApiKey: 'key', from: 'Portal Fwlog <no-reply@portalfwlog.com.br>', portalUrl: 'https://portalfwlog.com.br/portal/billing' }
  it('sem reply-to, recusa com a mensagem que nomeia DEMURRAGE_REPLY_TO', () => {
    expect(() => assertRealSendConfigured(true, { ...config, replyTo: undefined })).toThrow(MISSING_SENDER_MESSAGE)
    expect(MISSING_SENDER_MESSAGE).not.toContain('COMMUNICATIONS_REPLY_TO')
  })
  it('com reply-to, segue; em simulação, não exige nada', () => {
    expect(() => assertRealSendConfigured(true, { ...config, replyTo: 'eqp@fwlog.com.br' })).not.toThrow()
    expect(() => assertRealSendConfigured(false, { ...config, replyTo: undefined })).not.toThrow()
  })
})
