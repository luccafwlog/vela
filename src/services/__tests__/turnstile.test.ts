import { beforeEach, expect, it, vi } from 'vitest'
import { verifyTurnstileToken } from '../../../supabase/functions/_shared/turnstile'

const fetcher = vi.fn<typeof fetch>()

beforeEach(() => {
  fetcher.mockReset()
})

it('valida o token no Siteverify e exige sucesso, action e hostname esperados', async () => {
  fetcher.mockResolvedValue(new Response(JSON.stringify({
    success: true,
    action: 'portal_login',
    hostname: 'portalfwlog.com.br',
  }), { status: 200 }))

  await expect(verifyTurnstileToken({
    token: 'one-time-token',
    expectedAction: 'portal_login',
    expectedHostname: 'portalfwlog.com.br',
    secret: 'server-secret',
    allowedHostnames: ['portalfwlog.com.br'],
    fetcher,
  })).resolves.toBe(true)

  const [url, init] = fetcher.mock.calls[0]
  expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
  expect(JSON.parse(String(init?.body))).toEqual({ secret: 'server-secret', response: 'one-time-token' })
  expect(JSON.stringify(init?.body)).not.toContain('remoteip')
})

it('falha fechado se a chave, o token ou a origem não estiverem configurados', async () => {
  const base = {
    token: 'one-time-token',
    expectedAction: 'portal_login',
    expectedHostname: 'portalfwlog.com.br',
    secret: 'server-secret',
    allowedHostnames: ['portalfwlog.com.br'],
    fetcher,
  }

  await expect(verifyTurnstileToken({ ...base, secret: '' })).resolves.toBe(false)
  await expect(verifyTurnstileToken({ ...base, token: '' })).resolves.toBe(false)
  await expect(verifyTurnstileToken({ ...base, expectedHostname: null })).resolves.toBe(false)
  await expect(verifyTurnstileToken({ ...base, expectedHostname: 'attacker.example' })).resolves.toBe(false)
  expect(fetcher).not.toHaveBeenCalled()
})

it('rejeita resposta recusada, action/hostname divergentes e falha de rede', async () => {
  const base = {
    token: 'one-time-token',
    expectedAction: 'portal_login',
    expectedHostname: 'portalfwlog.com.br',
    secret: 'server-secret',
    allowedHostnames: ['portalfwlog.com.br'],
    fetcher,
  }
  const result = (overrides: Record<string, unknown>) => new Response(JSON.stringify({
    success: true,
    action: 'portal_login',
    hostname: 'portalfwlog.com.br',
    ...overrides,
  }), { status: 200 })

  fetcher.mockResolvedValueOnce(result({ success: false }))
  await expect(verifyTurnstileToken(base)).resolves.toBe(false)
  fetcher.mockResolvedValueOnce(result({ action: 'portal_recovery' }))
  await expect(verifyTurnstileToken(base)).resolves.toBe(false)
  fetcher.mockResolvedValueOnce(result({ hostname: 'attacker.example' }))
  await expect(verifyTurnstileToken(base)).resolves.toBe(false)
  fetcher.mockRejectedValueOnce(new TypeError('network error'))
  await expect(verifyTurnstileToken(base)).resolves.toBe(false)
})

it('rejeita respostas HTTP e JSON inválidas', async () => {
  const base = {
    token: 'one-time-token',
    expectedAction: 'portal_login',
    expectedHostname: 'portalfwlog.com.br',
    secret: 'server-secret',
    allowedHostnames: ['portalfwlog.com.br'],
    fetcher,
  }
  fetcher.mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
  await expect(verifyTurnstileToken(base)).resolves.toBe(false)
  fetcher.mockResolvedValueOnce(new Response('not-json', { status: 200 }))
  await expect(verifyTurnstileToken(base)).resolves.toBe(false)
})
