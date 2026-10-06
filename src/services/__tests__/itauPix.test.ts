import { describe, expect, it, vi } from 'vitest'
import {
  createItauPixClient, isVelaTxid, ItauPixError, newVelaTxid, runItauPixAction, type ItauPixConfig,
} from '../../../supabase/functions/_shared/itauPix'

const config: ItauPixConfig = {
  clientId: 'id-ficticio', clientSecret: 'segredo-ficticio', pixKey: '06352972000121',
  baseUrl: 'https://itau.test/v2', tokenUrl: 'https://sts.test/token', authHeader: 'Authorization',
  certPem: '', keyPem: '',
}
const tokenResponse = () => Response.json({ access_token: 'tok-ficticio', token_type: 'Bearer', expires_in: 300 })
const cob = (txid: string, extra: Record<string, unknown> = {}) => ({
  txid, revisao: 0, status: 'ATIVA', calendario: { criacao: '2026-10-06T12:00:00Z', expiracao: 3600 },
  valor: { original: '0.01' }, pixCopiaECola: '000201...', ...extra,
})

describe('TXID do Vela', () => {
  it('gera 32 caracteres maiúsculos com prefixo e recusa TXIDs de outros sistemas', () => {
    const txid = newVelaTxid()
    expect(txid).toMatch(/^VELA[A-Z0-9]{28}$/)
    expect(newVelaTxid()).not.toBe(txid)
    expect(isVelaTxid('88ba8ec675e044178d434908d9b2a30a')).toBe(false) // TXID do terceiro
    expect(isVelaTxid('VELA' + 'a'.repeat(28))).toBe(false)
    expect(isVelaTxid('VELA' + 'A'.repeat(32))).toBe(false) // 36 > 35
  })
})

describe('cliente Itaú Pix', () => {
  it('reaproveita o token, envia Bearer no header configurado e cria a COB com a chave', async () => {
    const txid = newVelaTxid()
    const fetchMtls = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(Response.json(cob(txid), { status: 201 }))
      .mockResolvedValueOnce(Response.json(cob(txid)))
    const client = createItauPixClient({ ...config, authHeader: 'auth' }, fetchMtls)
    await client.createCob(txid, '0.01', 3600, 'Teste')
    await client.getCob(txid)
    expect(fetchMtls).toHaveBeenCalledTimes(3) // um token só
    const [url, init] = fetchMtls.mock.calls[1]
    expect(url).toBe(`https://itau.test/v2/cob/${txid}`)
    expect(init.method).toBe('PUT')
    expect(init.headers.auth).toBe('Bearer tok-ficticio')
    expect(JSON.parse(init.body)).toEqual({ calendario: { expiracao: 3600 }, valor: { original: '0.01' }, chave: '06352972000121', solicitacaoPagador: 'Teste' })
    expect(await createItauPixClient(config, vi.fn().mockResolvedValueOnce(tokenResponse())).tokenInfo())
      .toEqual({ token_type: 'Bearer', expires_in: 300, scope: null })
  })

  it('não confirma criação com outro TXID ou valor diferente', async () => {
    const txid = newVelaTxid()
    const other = createItauPixClient(config, vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(Response.json(cob(newVelaTxid()))))
    await expect(other.createCob(txid, '0.01', 3600)).rejects.toThrow('não confirma')
    const wrongValue = createItauPixClient(config, vi.fn().mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(Response.json(cob(txid, { valor: { original: '0.02' } }))))
    await expect(wrongValue.createCob(txid, '0.01', 3600)).rejects.toThrow('diferente do pedido')
  })

  it('alteração que encontra a COB paga não é sucesso', async () => {
    const txid = newVelaTxid()
    const client = createItauPixClient(config, vi.fn().mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(Response.json(cob(txid, { status: 'CONCLUIDA' }))))
    await expect(client.updateCob(txid, { amount: '0.05' })).rejects.toMatchObject({ status: 409 })
  })

  it('sem resposta vira incerteza (status 0) e não repete a escrita', async () => {
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockRejectedValueOnce(new TypeError('timeout'))
    const client = createItauPixClient(config, fetchMtls)
    await expect(client.createCob(newVelaTxid(), '0.01', 3600)).rejects.toMatchObject({ status: 0 })
    expect(fetchMtls).toHaveBeenCalledTimes(2)
  })

  it('devolve o corpo de erro do Itaú e nunca o token', async () => {
    const client = createItauPixClient(config, vi.fn().mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(Response.json({ title: 'Cobrança inválida', violacoes: [] }, { status: 400 })))
    const error = await client.getCob(newVelaTxid()).catch((e) => e)
    expect(error).toBeInstanceOf(ItauPixError)
    expect(error.body).toEqual({ title: 'Cobrança inválida', violacoes: [] })
    expect(JSON.stringify(error)).not.toContain('tok-ficticio')
  })

  it('percorre todas as páginas do GET /pix', async () => {
    const page = (n: number, pix: unknown[]) => Response.json({ parametros: { paginacao: { paginaAtual: n, quantidadeDePaginas: 2 } }, pix })
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(page(0, [{ endToEndId: 'E1', valor: '0.01', horario: 'x' }]))
      .mockResolvedValueOnce(page(1, [{ endToEndId: 'E2', valor: '0.02', horario: 'y' }]))
    const pix = await createItauPixClient(config, fetchMtls).listPix('2026-10-06T00:00:00Z', '2026-10-07T00:00:00Z')
    expect(pix.map((p) => p.endToEndId)).toEqual(['E1', 'E2'])
    expect(fetchMtls.mock.calls[2][0]).toContain('paginacao.paginaAtual=1')
  })
})

describe('ações de diagnóstico da Fase 1', () => {
  it('recusa valor acima do teto e TXID de terceiro sem chamar o Itaú', async () => {
    const fetchMtls = vi.fn()
    const client = createItauPixClient(config, fetchMtls)
    await expect(runItauPixAction(client, { action: 'create_test', amount: '1.01' })).rejects.toMatchObject({ status: 400 })
    await expect(runItauPixAction(client, { action: 'create_test', amount: '0.001' })).rejects.toMatchObject({ status: 400 })
    await expect(runItauPixAction(client, { action: 'cancel', txid: '88ba8ec675e044178d434908d9b2a30a' })).rejects.toMatchObject({ status: 400 })
    await expect(runItauPixAction(client, { action: 'apagar' })).rejects.toMatchObject({ status: 400 })
    expect(fetchMtls).not.toHaveBeenCalled()
  })
})
