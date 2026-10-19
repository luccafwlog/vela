import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runWithBetterStackHeartbeat } from '../../../supabase/functions/_shared/betterStackHeartbeat.ts'
import {
  runAutomaticCommunications,
  type AutoRunnerCandidate,
} from '../../../supabase/functions/_shared/customerCommunicationAutoRunner.ts'

const entry = readFileSync(new URL('../../../supabase/functions/customer-communication-auto-runner/index.ts', import.meta.url), 'utf8')
const source = readFileSync(new URL('../../../supabase/functions/_shared/customerCommunicationAutoRunner.ts', import.meta.url), 'utf8')

describe('contrato do runner automático de Comunicados', () => {
  it('suporta CE financeiro, simulação reprocessável e trata supressão permanente', () => {
    expect(source).toContain("kind: 'aviso_chegada_noa' | 'aviso_prontidao_nor' | 'aviso_atracacao_nob' | 'ce_mercante_taxas'")
    expect(source).toContain("customer_local_charges_communication_payload")
    expect(source).toContain("result?.status === 'enviado' || result?.status === 'simulado' || result?.status === 'parcial'")
    expect(source).toContain("response.status === 422 && Boolean(result?.suppressed)")
    expect(source).toContain("release: 'release_customer_communication_automation_claim'")
    expect(entry).toContain("timingSafeEqual(providedSecret, secret)")
    expect(entry).toContain("if (req.method !== 'POST') return json(405")
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
    const fetcher = vi.fn(() => {
      const next = queue.shift() ?? { status: 500, body: { error: 'sem resposta' } }
      return Promise.resolve(new Response(JSON.stringify(next.body), { status: next.status }))
    }) as unknown as typeof fetch
    const run = () => runAutomaticCommunications({
      rpc, fetcher, supabaseUrl: 'https://supabase.example.test', serviceKey: 'service', secret: 'secret',
    })
    const claimCalls = () => rpcCalls.filter(({ fn }) => fn !== 'evaluate_and_dispatch_automatic_communications')
    return { run, claimCalls }
  }

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => vi.restoreAllMocks())

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
    await runAutomaticCommunications({ rpc, fetcher: vi.fn() as unknown as typeof fetch, supabaseUrl: 'https://x.test', serviceKey: 's', secret: 's' })
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
})

describe('recusas da Edge send-customer-communication', () => {
  const edge = readFileSync(new URL('../../../supabase/functions/send-customer-communication/index.ts', import.meta.url), 'utf8')
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
    expect(linesWith('if (!anchor?.ok) return json(422')).toHaveLength(1)
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
