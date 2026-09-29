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
  it('gera uma identidade estável e não reversível para cada destinatário', async () => {
    const first = await recipientKey(' Cliente@Example.com ')
    const equivalent = await recipientKey('cliente@example.com')
    const different = await recipientKey('outro@example.com')

    expect(first).toBe(equivalent)
    expect(first).not.toBe(different)
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it.each([429, 500, 502, 503, 504])('repete status transitório %s com backoff', async (status) => {
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
})
