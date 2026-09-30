import { expect, it, vi } from 'vitest'
import { expirationSeconds, itauPixRequest } from '../../../supabase/functions/_shared/itauPixTransport'

it('não chama o Itaú real sem ativação e validação explícitas', async () => {
  const fetchWithMtls = vi.fn()
  await expect(itauPixRequest({ enabled: false, validated: false, clientId: '', clientSecret: '', pixKey: '', authHeader: 'auth', tokenFormat: 'bearer', fetchWithMtls },
    { method: 'GET', txid: 'a'.repeat(32) })).rejects.toThrow('não ativado')
  expect(fetchWithMtls).not.toHaveBeenCalled()
})

it('calcula expiração desde criação e recusa resposta de outro TXID', async () => {
  expect(expirationSeconds('2026-10-02T13:00:00Z', '2026-10-06T17:30:00Z')).toBe(361800)
  const fetchWithMtls = vi.fn()
    .mockResolvedValueOnce(Response.json({ access_token: 'token-ficticio' }))
    .mockResolvedValueOnce(Response.json({ txid: 'outro' }))
  await expect(itauPixRequest({ enabled: true, validated: true, clientId: 'ficticio', clientSecret: 'ficticio', pixKey: 'ficticia', authHeader: 'auth', tokenFormat: 'bearer', fetchWithMtls },
    { method: 'PATCH', txid: 'a'.repeat(32), amount: '125.00', createdAt: '2026-10-02T13:00:00Z', expiresAt: '2026-10-06T17:30:00Z' })).rejects.toThrow('não confirma')
  const request = fetchWithMtls.mock.calls[1][1]
  expect(JSON.parse(request.body)).toEqual({ valor: { original: '125.00' }, calendario: { expiracao: 361800 } })
  expect(request.headers.auth).toBe('Bearer token-ficticio')
  expect(fetchWithMtls).toHaveBeenCalledTimes(2)
})

it('consulta e cancela com transporte mTLS fornecido, sem repetir a escrita', async () => {
  const txid = 'b'.repeat(32)
  const cob = { txid, revisao: 0, status: 'ATIVA', calendario: { criacao: '2026-10-02T13:00:00Z', expiracao: 86400 }, valor: { original: '100.00' } }
  const fetchWithMtls = vi.fn()
    .mockResolvedValueOnce(Response.json({ access_token: 'token-ficticio' }))
    .mockResolvedValueOnce(Response.json(cob))
    .mockResolvedValueOnce(Response.json({ access_token: 'token-ficticio' }))
    .mockResolvedValueOnce(Response.json({ ...cob, revisao: 1, status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' }))
  const config = { enabled: true, validated: true, clientId: 'ficticio', clientSecret: 'ficticio', pixKey: 'ficticia', authHeader: 'auth' as const, tokenFormat: 'raw' as const, fetchWithMtls }
  expect((await itauPixRequest(config, { method: 'GET', txid })).status).toBe('ATIVA')
  expect((await itauPixRequest(config, { method: 'PATCH', txid, cancel: true })).status).toBe('REMOVIDA_PELO_USUARIO_RECEBEDOR')
  expect(JSON.parse(fetchWithMtls.mock.calls[3][1].body)).toEqual({ status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' })
  expect(fetchWithMtls.mock.calls[3][1].headers.auth).toBe('token-ficticio')
})
