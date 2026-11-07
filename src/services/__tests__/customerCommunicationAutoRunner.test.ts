import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runWithBetterStackHeartbeat } from '../../../supabase/functions/_shared/betterStackHeartbeat.ts'
import {
  isPlatformRateLimit,
  runAutomaticCommunications,
  type AutoRunnerCandidate,
  type AutoRunnerDeps,
  type AutoRunnerDispatchResult,
} from '../../../supabase/functions/_shared/customerCommunicationAutoRunner.ts'

const entry = readFileSync(new URL('../../../supabase/functions/customer-communication-auto-runner/index.ts', import.meta.url), 'utf8')
const source = readFileSync(new URL('../../../supabase/functions/_shared/customerCommunicationAutoRunner.ts', import.meta.url), 'utf8')

describe('contrato do runner automático de Comunicados', () => {
  it('suporta CE financeiro, simulação reprocessável e trata supressão permanente', () => {
    expect(source).toContain("kind: 'aviso_chegada_noa' | 'aviso_prontidao_nor' | 'aviso_atracacao_nob' | 'ce_mercante_taxas'")
    expect(source).toContain("customer_local_charges_communication_payload")
    expect(source).toContain("result?.status === 'enviado' || result?.status === 'simulado' || result?.status === 'parcial'")
    expect(source).toContain("status === 422 && Boolean(result?.suppressed)")
    expect(source).toContain("release: 'release_customer_communication_automation_claim'")
    expect(entry).toContain("timingSafeEqual(providedSecret, secret)")
    expect(entry).toContain("if (req.method !== 'POST') return json(405")
  })

  // Incidente de 07/11/2026: a rodada fazia um POST à send-customer-communication
  // por destinatário e a Supabase recusou da 31ª chamada em diante.
  it('envia no mesmo processo, sem chamar outra Edge Function por HTTP', () => {
    expect(entry).toContain("dispatchCustomerCommunication(admin, payload, { isAutomation: true, userId: null })")
    expect(entry).not.toContain('/functions/v1/')
    expect(source).not.toContain('/functions/v1/')
    expect(source).not.toContain('fetch')
  })

  it('repassa a identidade da Atracação exigida pelo NOB', () => {
    // assertCommunicationScope recusa o NOB sem terminal no comunicado E em cada
    // B/L: sem isto o candidato produzido pela migration 045 morreria no render.
    expect(source).toContain('terminalId: candidate.terminal_id ?? null')
    expect(source).toContain('terminalStateId: candidate.anchor_atracacao_id ?? null')
    expect(source).toContain('terminalName: candidate.terminal_name ?? null')
    // E a âncora precisa chegar ao registro, senão a idempotência por Atracação
    // não existe e o mesmo NOB sai de novo a cada passagem do cron.
    expect(source).toContain('anchor_atracacao_id: candidate.anchor_atracacao_id ?? null')
    expect(source).toContain('terminal_name: candidate.terminal_name ?? null')
  })
})

describe('rodada do runner com envio falso', () => {
  const candidate: AutoRunnerCandidate = {
    claim_key: 'aviso_chegada_noa:1:1:BRSSZ',
    kind: 'aviso_chegada_noa',
    nature: 'avisos_operacionais',
    customer_id: 1,
    customer_name: 'CLIENTE TESTE',
    customer_cnpj: '00000000000191',
    voyage_id: 1,
    vessel_name: 'NAVIO TESTE',
    voyage_number: '001',
    port: 'BRSSZ',
    milestone_at: '2026-10-20T12:00:00Z',
    bl_ids: ['BL-1'],
    emails: ['a@example.test', 'b@example.test'],
  }

  function setup(responses: Array<{ status: number; body: unknown }>) {
    const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
    const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve({ data: fn === 'evaluate_and_dispatch_automatic_communications' ? [candidate] : true, error: null })
    })
    const queue = [...responses]
    const dispatch = vi.fn<AutoRunnerDeps['dispatch']>(() => {
      const next = queue.shift() ?? { status: 500, body: { error: 'sem resposta' } }
      return Promise.resolve({ status: next.status, body: next.body as Record<string, unknown> })
    })
    const run = () => runAutomaticCommunications({ rpc, dispatch })
    const claimCalls = () => rpcCalls.filter(({ fn }) => fn !== 'evaluate_and_dispatch_automatic_communications')
    return { run, claimCalls, dispatch }
  }

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  it('falha da produtora devolve 500 marcado com o SQLSTATE e a RPC para o Sentry', async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: null, error: { code: '22023', message: 'Viagem e cliente são obrigatórios.' } }))
    const result = await runAutomaticCommunications({ rpc, dispatch: vi.fn() })
    expect(result.status).toBe(500)
    expect(result.headers).toEqual({
      'x-telemetry-error-code': '22023',
      'x-telemetry-failed-rpc': 'evaluate_and_dispatch_automatic_communications',
    })
  })

  it('envia um destinatário por vez, com a origem automática e a âncora da escala', async () => {
    const { run, dispatch } = setup([{ status: 200, body: { status: 'enviado' } }, { status: 200, body: { status: 'enviado' } }])
    await run()
    expect(dispatch.mock.calls.map(([payload]) => payload.recipient)).toEqual(['a@example.test', 'b@example.test'])
    for (const [payload] of dispatch.mock.calls) {
      expect(payload).toMatchObject({
        customer_id: 1, kind: 'aviso_chegada_noa', nature: 'avisos_operacionais', origin: 'automatico',
        anchor_voyage_id: 1, anchor_port: 'BRSSZ', attempt_discriminator: 0, bl_ids: ['BL-1'],
      })
    }
  })

  it('422 permanente em todos os destinatários rejeita a claim e não a libera', async () => {
    const refused = { status: 422, body: { error: 'Anexos inválidos.', permanent: true } }
    const { run, claimCalls } = setup([refused, refused])
    const result = await run()

    expect(claimCalls()).toEqual([{
      fn: 'reject_customer_communication_automation_claim',
      args: { p_claim_key: candidate.claim_key, p_reason: 'Anexos inválidos.' },
    }])
    expect(result).toMatchObject({ status: 200, body: { failed: 2, releaseFailures: 0 } })
    expect(console.warn).toHaveBeenCalledWith('[customer-communication-auto-runner] envio recusado', expect.objectContaining({
      status: 422, error: 'Anexos inválidos.', kind: 'aviso_chegada_noa', customerId: 1, claimKey: candidate.claim_key,
    }))
  })

  // Plano dos e-mails, 1D (D18): recusa que pode mudar adia a claim com
  // intervalo crescente; o banco decide quando o alerta abre.
  it('422 de prontidão adia a claim como recusa por dado (alerta na 1ª)', async () => {
    const refused = { status: 422, body: { error: 'Prontidão financeira bloqueada para este cliente e viagem.' } }
    const { run, claimCalls } = setup([refused, refused])
    const result = await run()

    expect(claimCalls()).toEqual([{
      fn: 'defer_customer_communication_automation_claim',
      args: { p_claim_key: candidate.claim_key, p_reason: 'Prontidão financeira bloqueada para este cliente e viagem.', p_provider_failure: false },
    }])
    expect(result.body.failed).toBe(2)
  })

  it('falha do provedor adia a claim como falha do provedor (alerta na 3ª seguida)', async () => {
    const failure = { status: 502, body: { status: 'falha', error: undefined, reason: 'Tempo esgotado na chamada ao provedor', message: 'Falha no envio do comunicado.' } }
    const { run, claimCalls } = setup([failure, failure])
    await run()

    expect(claimCalls()).toEqual([{
      fn: 'defer_customer_communication_automation_claim',
      args: { p_claim_key: candidate.claim_key, p_reason: 'Tempo esgotado na chamada ao provedor', p_provider_failure: true },
    }])
  })

  it('502 com falha_permanente do provedor rejeita a claim', async () => {
    const refused = { status: 502, body: { status: 'falha', permanent: true, reason: 'HTTP 422 validation_error' } }
    const { run, claimCalls } = setup([refused, refused])
    await run()

    expect(claimCalls()).toEqual([{
      fn: 'reject_customer_communication_automation_claim',
      args: { p_claim_key: candidate.claim_key, p_reason: 'HTTP 422 validation_error' },
    }])
  })

  it('recusa permanente misturada a falha transitória adia, sem rejeitar', async () => {
    const { run, claimCalls } = setup([
      { status: 422, body: { error: 'Anexos inválidos.', permanent: true } },
      { status: 500, body: { error: 'Falha no envio do comunicado.' } },
    ])
    await run()

    expect(claimCalls()).toEqual([{
      fn: 'defer_customer_communication_automation_claim',
      args: { p_claim_key: candidate.claim_key, p_reason: 'Falha no envio do comunicado.', p_provider_failure: true },
    }])
  })

  it('falha ao montar o candidato adia a claim', async () => {
    const broken = { ...candidate, kind: 'ce_mercante_taxas' as const }
    const rpc = vi.fn((fn: string) => Promise.resolve(fn === 'evaluate_and_dispatch_automatic_communications'
      ? { data: [broken], error: null }
      : fn === 'customer_local_charges_communication_payload' ? { data: null, error: new Error('payload indisponível') } : { data: true, error: null }))
    await runAutomaticCommunications({ rpc, dispatch: vi.fn() })
    expect(rpc).toHaveBeenCalledWith('defer_customer_communication_automation_claim', {
      p_claim_key: candidate.claim_key, p_reason: 'payload indisponível', p_provider_failure: true,
    })
  })

  it('destinatário simulado fica resolvido e só o outro, recusado em definitivo, decide a rejeição', async () => {
    const { run, claimCalls } = setup([
      { status: 200, body: { status: 'simulado' } },
      { status: 422, body: { error: 'Destinatário inválido.', permanent: true } },
    ])
    const result = await run()

    expect(claimCalls().map(({ fn }) => fn)).toEqual(['reject_customer_communication_automation_claim'])
    expect(result.body).toMatchObject({ failed: 1, sent: [{ kind: 'aviso_chegada_noa', customerId: 1, emails: 1 }] })
  })

  it('envio completo encerra a claim (fecha o alerta) e reporta failed: 0', async () => {
    const { run, claimCalls } = setup([
      { status: 200, body: { status: 'simulado' } },
      { status: 422, body: { error: 'Endereço suprimido para Comunicados.', suppressed: true } },
    ])
    const result = await run()

    expect(claimCalls()).toEqual([{ fn: 'complete_customer_communication_automation_claim', args: { p_claim_key: candidate.claim_key } }])
    expect(result.body).toMatchObject({ failed: 0, releaseFailures: 0 })
  })

  it('a rodada com recusa deixa o heartbeat vermelho', async () => {
    const refused = { status: 422, body: { error: 'Anexos inválidos.', permanent: true } }
    const { run } = setup([refused, refused])
    const result = await run()
    const heartbeats: string[] = []
    await runWithBetterStackHeartbeat('customerCommunicationAutoRunner', () => new Response(JSON.stringify(result.body), { status: result.status }), {
      getEnv: () => 'https://uptime.betterstack.com/api/v1/heartbeat/token',
      fetcher: (input) => {
        heartbeats.push(String(input))
        return Promise.resolve(new Response(null, { status: 200 }))
      },
    })

    expect(heartbeats).toEqual(['https://uptime.betterstack.com/api/v1/heartbeat/token/fail'])
  })

  it('até quatro Clientes por vez; alvos do mesmo Cliente e destinatários do mesmo alvo em série', async () => {
    // Seis Clientes; o Cliente 1 tem dois alvos (NOA e NOR), o NOA com dois destinatários.
    const candidates: AutoRunnerCandidate[] = [
      { ...candidate, claim_key: 'aviso_chegada_noa:1:1:BRSSZ', customer_id: 1 },
      ...[2, 3, 4, 5, 6].map((customerId) => ({ ...candidate, claim_key: `aviso_chegada_noa:${customerId}:1:BRSSZ`, customer_id: customerId, emails: ['x@example.test'] })),
      { ...candidate, claim_key: 'aviso_prontidao_nor:1:1:BRSSZ', kind: 'aviso_prontidao_nor', customer_id: 1, emails: ['c@example.test'] },
    ]
    const rpc = vi.fn((fn: string) => Promise.resolve({ data: fn === 'evaluate_and_dispatch_automatic_communications' ? candidates : true, error: null }))
    let inFlight = 0
    let maxInFlight = 0
    const inFlightByCustomer = new Map<number, number>()
    let sameCustomerOverlap = false
    const dispatch = vi.fn(async (payload: Record<string, unknown>): Promise<AutoRunnerDispatchResult> => {
      const customerId = Number(payload.customer_id)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      inFlightByCustomer.set(customerId, (inFlightByCustomer.get(customerId) ?? 0) + 1)
      if (inFlightByCustomer.get(customerId)! > 1) sameCustomerOverlap = true
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      inFlightByCustomer.set(customerId, inFlightByCustomer.get(customerId)! - 1)
      return { status: 200, body: { status: 'enviado' } }
    })

    const result = await runAutomaticCommunications({ rpc, dispatch })

    expect(dispatch).toHaveBeenCalledTimes(8)
    expect(maxInFlight).toBe(4)
    expect(sameCustomerOverlap).toBe(false)
    // O resumo segue a ordem dos candidatos, não a ordem de término.
    expect(result.body.sent?.map((item) => `${item.kind}:${item.customerId}:${item.emails}`)).toEqual([
      'aviso_chegada_noa:1:2', 'aviso_chegada_noa:2:1', 'aviso_chegada_noa:3:1', 'aviso_chegada_noa:4:1',
      'aviso_chegada_noa:5:1', 'aviso_chegada_noa:6:1', 'aviso_prontidao_nor:1:1',
    ])
    expect(result.body).toMatchObject({ candidates: 7, failed: 0, releaseFailures: 0 })
  })
})

// Proteção do incidente de 07/11/2026: o que a rodada não chega a enviar volta
// na rodada seguinte (2 min), sem intervalo de nova tentativa, sem contar falha
// e sem deixar o heartbeat vermelho.
describe('teto da rodada e limite da plataforma', () => {
  const base: AutoRunnerCandidate = {
    claim_key: 'aviso_chegada_noa:1:1:BRSSZ',
    kind: 'aviso_chegada_noa',
    nature: 'avisos_operacionais',
    customer_id: 1,
    customer_name: 'CLIENTE TESTE',
    customer_cnpj: '00000000000191',
    voyage_id: 1,
    vessel_name: 'NAVIO TESTE',
    voyage_number: '001',
    port: 'BRSSZ',
    milestone_at: '2026-10-20T12:00:00Z',
    bl_ids: ['BL-1'],
    emails: ['a@example.test', 'b@example.test', 'c@example.test'],
  }
  // Mesmo Cliente nos dois alvos: seguem em série, então a ordem é fixa.
  const second: AutoRunnerCandidate = { ...base, claim_key: 'aviso_prontidao_nor:1:1:BRSSZ', kind: 'aviso_prontidao_nor', emails: ['d@example.test'] }

  function rpcWith(candidates: AutoRunnerCandidate[]) {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
    const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
      if (fn !== 'evaluate_and_dispatch_automatic_communications') calls.push({ fn, args })
      return Promise.resolve({ data: fn === 'evaluate_and_dispatch_automatic_communications' ? candidates : true, error: null })
    })
    return { rpc, calls }
  }

  const delivered = (): Promise<AutoRunnerDispatchResult> => Promise.resolve({ status: 200, body: { status: 'enviado' } })

  async function heartbeatOf(result: { status: number; body: unknown }): Promise<string[]> {
    const heartbeats: string[] = []
    await runWithBetterStackHeartbeat('customerCommunicationAutoRunner', () => new Response(JSON.stringify(result.body), { status: result.status }), {
      getEnv: () => 'https://uptime.betterstack.com/api/v1/heartbeat/token',
      fetcher: (input) => {
        heartbeats.push(String(input))
        return Promise.resolve(new Response(null, { status: 200 }))
      },
    })
    return heartbeats
  }

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  it('o padrão é 50 destinatários ou 15 s por rodada', async () => {
    const { DEFAULT_AUTO_RUNNER_BUDGET } = await import('../../../supabase/functions/_shared/customerCommunicationAutoRunner.ts')
    expect(DEFAULT_AUTO_RUNNER_BUDGET).toEqual({ maxRecipients: 50, maxMillis: 15_000 })
  })

  it('passado o teto de destinatários, o resto volta na rodada seguinte sem falha e com o heartbeat verde', async () => {
    const { rpc, calls } = rpcWith([base, second])
    const dispatch = vi.fn<AutoRunnerDeps['dispatch']>(delivered)
    const result = await runAutomaticCommunications({ rpc, dispatch, budget: { maxRecipients: 2, maxMillis: 60_000 } })

    expect(dispatch.mock.calls.map(([payload]) => payload.recipient)).toEqual(['a@example.test', 'b@example.test'])
    expect(calls).toEqual([
      { fn: 'release_customer_communication_automation_claim', args: { p_claim_key: base.claim_key } },
      { fn: 'release_customer_communication_automation_claim', args: { p_claim_key: second.claim_key } },
    ])
    expect(result).toMatchObject({ status: 200, body: { failed: 0, releaseFailures: 0, nextRound: 2, paused: 'teto_da_rodada' } })
    expect(result.body.sent).toEqual([
      { kind: 'aviso_chegada_noa', customerId: 1, emails: 2 },
      { kind: 'aviso_prontidao_nor', customerId: 1, emails: 0 },
    ])
    expect(await heartbeatOf(result)).toEqual(['https://uptime.betterstack.com/api/v1/heartbeat/token'])
  })

  it('passado o tempo da rodada, não começa outro envio', async () => {
    const { rpc, calls } = rpcWith([base])
    let clock = 0
    const dispatch = vi.fn(() => {
      clock += 16_000
      return delivered()
    })
    const result = await runAutomaticCommunications({ rpc, dispatch, now: () => clock })

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([{ fn: 'release_customer_communication_automation_claim', args: { p_claim_key: base.claim_key } }])
    expect(result.body).toMatchObject({ failed: 0, nextRound: 2, paused: 'teto_da_rodada' })
  })

  it('recusa da Supabase (RateLimitError) para a rodada: o destinatário recusado e os seguintes voltam na próxima', async () => {
    const { rpc, calls } = rpcWith([base, second])
    const limit = Object.assign(new Error('Rate limit exceeded for trace x. Retry after 50000ms.'), { name: 'RateLimitError' })
    const dispatch = vi.fn()
      .mockImplementationOnce(delivered)
      .mockImplementationOnce(() => Promise.reject(limit))
      .mockImplementation(delivered)
    const result = await runAutomaticCommunications({ rpc, dispatch })

    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(calls.map(({ fn }) => fn)).toEqual([
      'release_customer_communication_automation_claim',
      'release_customer_communication_automation_claim',
    ])
    expect(calls.some(({ fn }) => fn === 'defer_customer_communication_automation_claim')).toBe(false)
    expect(result.body).toMatchObject({ failed: 0, nextRound: 3, paused: 'limite_da_plataforma' })
    expect(await heartbeatOf(result)).toEqual(['https://uptime.betterstack.com/api/v1/heartbeat/token'])
  })

  it('falha de verdade antes do teto mantém o intervalo de nova tentativa e o heartbeat vermelho', async () => {
    const { rpc, calls } = rpcWith([base])
    const dispatch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({ status: 502, body: { status: 'falha', reason: 'Tempo esgotado na chamada ao provedor' } }))
      .mockImplementation(delivered)
    const result = await runAutomaticCommunications({ rpc, dispatch, budget: { maxRecipients: 2, maxMillis: 60_000 } })

    expect(calls).toEqual([{
      fn: 'defer_customer_communication_automation_claim',
      args: { p_claim_key: base.claim_key, p_reason: 'Tempo esgotado na chamada ao provedor', p_provider_failure: true },
    }])
    expect(result.body).toMatchObject({ failed: 1, nextRound: 1 })
    expect(await heartbeatOf(result)).toEqual(['https://uptime.betterstack.com/api/v1/heartbeat/token/fail'])
  })

  it('recusa definitiva com envio por fazer volta na rodada seguinte; a rejeição espera o resto', async () => {
    const { rpc, calls } = rpcWith([base])
    const dispatch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({ status: 422, body: { error: 'Destinatário inválido.', permanent: true } }))
      .mockImplementation(delivered)
    await runAutomaticCommunications({ rpc, dispatch, budget: { maxRecipients: 2, maxMillis: 60_000 } })

    expect(calls).toEqual([{ fn: 'release_customer_communication_automation_claim', args: { p_claim_key: base.claim_key } }])
  })

  it('só o RateLimitError conta como limite da plataforma', () => {
    expect(isPlatformRateLimit(Object.assign(new Error('x'), { name: 'RateLimitError' }))).toBe(true)
    expect(isPlatformRateLimit(new TypeError('fetch failed'))).toBe(false)
    expect(isPlatformRateLimit({ name: 'RateLimitError' })).toBe(false)
  })
})

describe('recusas do envio de Comunicado (send-customer-communication e régua)', () => {
  const edge = readFileSync(new URL('../../../supabase/functions/_shared/customerCommunicationDispatch.ts', import.meta.url), 'utf8')
  const linesWith = (text: string) => edge.split('\n').filter((line) => line.includes(text))

  it('marca permanent só nas recusas que não mudam sem outro código ou payload', () => {
    for (const text of ['Natureza inválida ou ausente.', 'Tipo de comunicado não disponível neste bloco.', 'B/Ls inválidos.', "'Anexos inválidos.'"]) {
      expect(linesWith(text).every((line) => line.includes('permanentRejection(')), text).toBe(true)
    }
    for (const text of [
      'Prontidão financeira bloqueada para este cliente e viagem.',
      'Contato desativado para esta caixa ou modelo.',
      'Destinatário não pertence ao cliente selecionado.',
      'Cliente desativado não recebe Comunicados.',
    ]) {
      expect(linesWith(text).length, text).toBeGreaterThan(0)
      expect(linesWith(text).some((line) => line.includes('permanentRejection(')), text).toBe(false)
    }
  })

  it('valida a âncora pela RPC única, sem ler o snapshot da viagem, e a recusa não é permanente', () => {
    expect(edge).not.toContain('pod_schedule_snapshot')
    expect(edge).toContain("admin.rpc('customer_communication_anchor_validation'")
    expect(linesWith('if (!anchor?.ok) return reply(422')).toHaveLength(1)
  })

  it('marca permanent quando o provedor recusou em definitivo', () => {
    // O comportamento é testado em customerCommunicationAttempts.test.ts.
    expect(edge).toContain('...(isPermanentProviderFailure(sent.ok, attempt?.status) ? { permanent: true } : {})')
  })

  it('o 502 leva o last_error da tentativa em `reason`, fora do `error` que a régua usa como motivo da claim', () => {
    expect(edge).toContain(".select('id, status, last_error')")
    expect(edge).toContain('...(!sent.ok && attempt?.last_error ? { reason: attempt.last_error } : {})')
  })

  it('loga o motivo de toda recusa 4xx', () => {
    expect(edge).toContain("if (status >= 400 && status < 500) {")
    expect(edge).toContain("console.warn('[send-customer-communication] recusa', { status, error,")
  })
})
