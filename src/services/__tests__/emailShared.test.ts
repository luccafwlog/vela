import { afterEach, describe, expect, it, vi } from 'vitest'
import { recipientKey, sendEmail } from '../../../supabase/functions/_shared/email.ts'

const baseInput = {
  kind: 'convite',
  to: 'cliente@example.com',
  subject: 'Assunto',
  html: '<p>Mensagem</p>',
  text: 'Mensagem',
  idempotencyKey: 'convite:1',
  from: 'portal@example.com',
  replyTo: 'suporte@example.com',
  resendApiKey: 'resend-key',
  recordAttempt: vi.fn(async () => ({ id: 7, status: 'falha_transitoria' as const, providerMessageId: null })),
  updateAttempt: vi.fn(async () => undefined),
  checkSuppression: vi.fn(async () => ({ suppressed: false })),
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sendEmail', () => {
  it('registra simulação explícita sem chamar o provedor, mesmo com credencial presente', async () => {
    const fetchMock = vi.fn()
    const updateAttempt = vi.fn()
    const result = await sendEmail({
      ...baseInput, simulate: true, from: null, replyTo: null,
      recordAttempt: async () => ({ id: 42, status: 'aceito' }),
      updateAttempt, fetchImpl: fetchMock,
    })
    expect(result).toEqual({ ok: true })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(updateAttempt).toHaveBeenCalledWith(42, {
      providerMessageId: null, retryCount: 0, status: 'aceito', lastError: undefined,
    })
  })

  it('mantém supressão mesmo em simulação explícita', async () => {
    const recordAttempt = vi.fn()
    expect(await sendEmail({ ...baseInput, simulate: true,
      checkSuppression: async () => ({ suppressed: true }), recordAttempt,
    })).toEqual({ ok: false })
    expect(recordAttempt).not.toHaveBeenCalled()
  })

  it('não apaga confirmação de entrega anterior ao simular uma tentativa existente', async () => {
    const updateAttempt = vi.fn()
    const fetchMock = vi.fn()
    expect(await sendEmail({ ...baseInput, simulate: true, updateAttempt, fetchImpl: fetchMock,
      recordAttempt: async () => ({ id: 42, status: 'aceito', existing: true, providerMessageId: 'real-42' }),
    })).toEqual({ ok: true })
    expect(updateAttempt).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('gera uma identidade estável e não reversível para cada destinatário', async () => {
    const first = await recipientKey(' Cliente@Example.com ')
    const equivalent = await recipientKey('cliente@example.com')
    const different = await recipientKey('outro@example.com')

    expect(first).toBe(equivalent)
    expect(first).not.toBe(different)
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it.each([408, 429, 500, 501, 502, 503, 504, 507, 599])('repete status transitório %s com backoff', async (status) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'provider-1' }), { status: 200 }))
    const result = await sendEmail({ ...baseInput, fetchImpl: fetchMock })

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(baseInput.updateAttempt).toHaveBeenCalledWith(7, {
      providerMessageId: 'provider-1',
      retryCount: 1,
      status: 'aceito',
      lastError: undefined,
    })
  })

  it('não repete uma falha permanente', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 400 }))
    const result = await sendEmail({ ...baseInput, fetchImpl: fetchMock })

    expect(result).toEqual({ ok: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(baseInput.updateAttempt).toHaveBeenCalledWith(7, {
      status: 'falha_permanente',
      retryCount: 0,
      lastError: 'HTTP 400',
    })
  })

  it('trata colisão de idempotência como sucesso sem chamar a Resend', async () => {
    const recordAttempt = vi.fn(async () => ({ id: 7, status: 'aceito' as const, providerMessageId: 'provider-1', existing: true }))
    const fetchMock = vi.fn()

    const result = await sendEmail({ ...baseInput, recordAttempt, fetchImpl: fetchMock })

    expect(result).toEqual({ ok: true })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(baseInput.checkSuppression).toHaveBeenCalledWith('cliente@example.com')
  })

  it('não persiste tentativa quando envio real está sem configuração', async () => {
    const recordAttempt = vi.fn()
    const fetchMock = vi.fn()

    await expect(sendEmail({
      ...baseInput,
      from: null,
      recordAttempt,
      fetchImpl: fetchMock,
    })).rejects.toThrow('Remetente e reply-to são obrigatórios')

    expect(recordAttempt).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retenta uma tentativa existente sem confirmação do provedor', async () => {
    const recordAttempt = vi.fn(async () => ({ id: 7, status: 'falha_transitoria' as const, providerMessageId: null, existing: true }))
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'provider-retry' }), { status: 200 }))

    const result = await sendEmail({ ...baseInput, recordAttempt, fetchImpl: fetchMock })

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(baseInput.updateAttempt).toHaveBeenCalledWith(7, expect.objectContaining({ providerMessageId: 'provider-retry' }))
  })

	it('retenta uma tentativa aceita sem provider_message_id', async () => {
    const recordAttempt = vi.fn(async () => ({ id: 7, status: 'aceito' as const, providerMessageId: null, existing: true }))
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'provider-after-crash' }), { status: 200 }))

    const result = await sendEmail({ ...baseInput, recordAttempt, fetchImpl: fetchMock })

    expect(result).toEqual({ ok: true })
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it('reusa no provider a chave histórica quando a identidade normalizada encontra uma tentativa legada', async () => {
		const recordAttempt = vi.fn(async () => ({
			id: 7,
			status: 'falha_transitoria' as const,
			providerMessageId: null,
			existing: true,
			idempotencyKey: 'demurrage:1:2:sha(raw-email)',
		}))
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'provider-legacy' }), { status: 200 }))

		const result = await sendEmail({ ...baseInput, recordAttempt, fetchImpl: fetchMock })

		expect(result).toEqual({ ok: true })
		expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({
			headers: expect.objectContaining({ 'Idempotency-Key': expect.stringMatching(/^demurrage:1:2:sha\(raw-email\):[0-9a-f]{32}$/) }),
		}))
	})

  it('envia para o provedor configurado em RESEND_BASE_URL e volta para a Resend sem o secret', async () => {
    const urlOf = async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'provider-1' }), { status: 200 }))
      await sendEmail({ ...baseInput, fetchImpl: fetchMock })
      return fetchMock.mock.calls[0][0]
    }
    expect(await urlOf()).toBe('https://api.resend.com/emails')

    const secrets: Record<string, string> = { RESEND_BASE_URL: ' https://api.millionsend.com/ ' }
    vi.stubGlobal('Deno', { env: { get: (name: string) => secrets[name] } })
    try {
      expect(await urlOf()).toBe('https://api.millionsend.com/emails')
      secrets.RESEND_BASE_URL = ''
      expect(await urlOf()).toBe('https://api.resend.com/emails')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('separa na Resend envios diferentes que herdaram a mesma chave local e mantém a do mesmo envio', async () => {
    const keyOf = async (html: string) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'provider-1' }), { status: 200 }))
      await sendEmail({ ...baseInput, html, fetchImpl: fetchMock })
      return (fetchMock.mock.calls[0][1] as RequestInit & { headers: Record<string, string> }).headers['Idempotency-Key']
    }

    // Depois de um reset do banco, `convite:1` volta com outro token no link.
    const beforeReset = await keyOf('<a href="/ativar?token=antigo">Ativar</a>')
    const afterReset = await keyOf('<a href="/ativar?token=novo">Ativar</a>')

    expect(afterReset).not.toBe(beforeReset)
    expect(await keyOf('<a href="/ativar?token=novo">Ativar</a>')).toBe(afterReset)
    expect(afterReset.startsWith('convite:1:')).toBe(true)
  })

  it('registra o motivo informado pela Resend na falha permanente', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: 'invalid_idempotent_request' }), { status: 409 }))

    await sendEmail({ ...baseInput, fetchImpl: fetchMock })

    expect(baseInput.updateAttempt).toHaveBeenCalledWith(7, {
      status: 'falha_permanente',
      retryCount: 0,
      lastError: 'HTTP 409 invalid_idempotent_request',
    })
  })

  it('aborta antes de registrar a tentativa quando o endereço está suprimido', async () => {
    const checkSuppression = vi.fn(async () => ({ suppressed: true, reason: 'bounce_permanente' }))
    const recordAttempt = vi.fn()
    const fetchMock = vi.fn()

    const result = await sendEmail({ ...baseInput, checkSuppression, recordAttempt, fetchImpl: fetchMock })

    expect(result).toEqual({ ok: false })
    expect(recordAttempt).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  describe('falhas na chamada ao provedor (plano dos e-mails, 1A)', () => {
    const noSleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined)

    it('passa um tempo limite em toda chamada ao provedor', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'p-1' }), { status: 200 }))
      await sendEmail({ ...baseInput, fetchImpl: fetchMock })
      expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    })

    it('tempo esgotado em todas as tentativas grava falha transitória com o motivo', async () => {
      const updateAttempt = vi.fn(async () => undefined)
      const neverAnswers = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      }))
      const result = await sendEmail({ ...baseInput, updateAttempt, fetchImpl: neverAnswers as unknown as typeof fetch, timeoutMs: 5, sleep: noSleep })

      expect(result).toEqual({ ok: false })
      expect(neverAnswers).toHaveBeenCalledTimes(3)
      expect(updateAttempt).toHaveBeenCalledWith(7, {
        retryCount: 2, status: 'falha_transitoria', lastError: 'Tempo esgotado na chamada ao provedor',
      })
    })

    it('erro de rede é tentado de novo e não escapa sem atualizar a tentativa', async () => {
      const updateAttempt = vi.fn(async () => undefined)
      const fetchMock = vi.fn()
        .mockRejectedValueOnce(new TypeError('connection reset'))
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'p-net' }), { status: 200 }))
      expect(await sendEmail({ ...baseInput, updateAttempt, fetchImpl: fetchMock, sleep: noSleep })).toEqual({ ok: true })
      expect(updateAttempt).toHaveBeenCalledWith(7, expect.objectContaining({ providerMessageId: 'p-net', retryCount: 1 }))

      const failing = vi.fn().mockRejectedValue(new TypeError('connection reset'))
      const update2 = vi.fn(async () => undefined)
      expect(await sendEmail({ ...baseInput, updateAttempt: update2, fetchImpl: failing, sleep: noSleep })).toEqual({ ok: false })
      expect(update2).toHaveBeenCalledWith(7, {
        retryCount: 2, status: 'falha_transitoria', lastError: 'Falha de rede na chamada ao provedor (TypeError)',
      })
    })

    it.each([401, 403])('HTTP %s (configuração do provedor) não repete na rodada e volta a enviar depois de corrigido', async (status) => {
      const updateAttempt = vi.fn(async () => undefined)
      const rejected = vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: 'invalid_api_key' }), { status }))
      expect(await sendEmail({ ...baseInput, updateAttempt, fetchImpl: rejected, sleep: noSleep })).toEqual({ ok: false })
      expect(rejected).toHaveBeenCalledTimes(1)
      expect(updateAttempt).toHaveBeenCalledWith(7, {
        retryCount: 0, status: 'falha_transitoria', lastError: `HTTP ${status} invalid_api_key (configuração do provedor)`,
      })

      // Com a chave corrigida, a mesma tentativa (agora transitória) chama o provedor de novo.
      const fixed = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'p-fixed' }), { status: 200 }))
      const recordAttempt = vi.fn(async () => ({ id: 7, status: 'falha_transitoria' as const, providerMessageId: null, existing: true }))
      expect(await sendEmail({ ...baseInput, recordAttempt, fetchImpl: fixed, sleep: noSleep })).toEqual({ ok: true })
      expect(fixed).toHaveBeenCalledTimes(1)
    })

    it('respeita o Retry-After do 429, limitado a 10 s', async () => {
      const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined)
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '4' } }))
        .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '60' } }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'p-429' }), { status: 200 }))
      expect(await sendEmail({ ...baseInput, fetchImpl: fetchMock, sleep })).toEqual({ ok: true })
      expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([4000, 10000])
    })

    it('e-mail aceito pelo provedor continua ok quando gravar o id falha', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const updateAttempt = vi.fn(async () => { throw new Error('banco indisponível') })
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'p-ok' }), { status: 200 }))
      expect(await sendEmail({ ...baseInput, updateAttempt, fetchImpl: fetchMock })).toEqual({ ok: true })
    })

    it('erro na consulta de supressão impede o envio', async () => {
      const fetchMock = vi.fn()
      await expect(sendEmail({ ...baseInput, fetchImpl: fetchMock,
        checkSuppression: async () => { throw new Error('consulta falhou') },
      })).rejects.toThrow('consulta falhou')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
