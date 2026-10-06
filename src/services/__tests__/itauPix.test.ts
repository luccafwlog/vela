import { describe, expect, it, vi } from 'vitest'
import {
  createItauPixClient, isVelaTestTxid, isVelaTxid, ItauPixError, newVelaTestTxid, newVelaTxid, processItauPixQueue, runItauPixAction, stepCharge,
  type ItauPixConfig, type QueuedCharge,
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

describe('cobrança de teste x cobrança de fatura', () => {
  it('o TXID de fatura nunca tem o prefixo de teste', () => {
    for (let i = 0; i < 200; i++) {
      const txid = newVelaTxid()
      expect(txid).toMatch(/^VELA[0-9A-F]{28}$/)
      expect(isVelaTestTxid(txid)).toBe(false)
    }
    const test = newVelaTestTxid()
    expect(test).toMatch(/^VELAT[A-Z0-9]{27}$/)
    expect(isVelaTestTxid(test)).toBe(true)
  })

  it('não altera nem cancela a cobrança de uma fatura, mas consulta', async () => {
    const invoiceTxid = newVelaTxid()
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(Response.json(cob(invoiceTxid)))
    const client = createItauPixClient(config, fetchMtls)
    await expect(runItauPixAction(client, { action: 'cancel', txid: invoiceTxid })).rejects.toMatchObject({ status: 400 })
    await expect(runItauPixAction(client, { action: 'update_test', txid: invoiceTxid, amount: '0.50' })).rejects.toMatchObject({ status: 400 })
    expect(fetchMtls).not.toHaveBeenCalled()
    await expect(runItauPixAction(client, { action: 'get', txid: invoiceTxid })).resolves.toMatchObject({ txid: invoiceTxid })
  })

  it('recusa validade inválida e alteração vazia sem chamar o Itaú', async () => {
    const fetchMtls = vi.fn()
    const client = createItauPixClient(config, fetchMtls)
    const txid = newVelaTestTxid()
    await expect(runItauPixAction(client, { action: 'update_test', txid, expiration_seconds: 'abc' })).rejects.toMatchObject({ status: 400 })
    await expect(runItauPixAction(client, { action: 'update_test', txid })).rejects.toMatchObject({ status: 400 })
    expect(fetchMtls).not.toHaveBeenCalled()
  })

  it('list_pix devolve só os Pix do Vela, sem dados do pagador, e conta os do terceiro', async () => {
    const vela = newVelaTxid()
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(Response.json({
      parametros: { paginacao: { paginaAtual: 0, quantidadeDePaginas: 1 } },
      pix: [
        { endToEndId: 'E1', txid: vela, valor: '0.01', horario: 'x', infoPagador: 'texto do cliente' },
        { endToEndId: 'E2', txid: '88ba8ec675e044178d434908d9b2a30a', valor: '9.00', horario: 'y', infoPagador: 'alheio' },
        { endToEndId: 'E3', valor: '5.00', horario: 'z' },
      ],
    }))
    const result = await runItauPixAction(createItauPixClient(config, fetchMtls),
      { action: 'list_pix', inicio: '2026-10-06T00:00:00Z', fim: '2026-10-07T00:00:00Z' })
    expect(result).toEqual({ pix: [{ endToEndId: 'E1', txid: vela, valor: '0.01', horario: 'x' }], outros: 2 })
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

describe('processador da fila de cobranças', () => {
  const charge = (extra: Partial<QueuedCharge> = {}): QueuedCharge => ({
    id: 1, txid: newVelaTxid(), amount_brl: '2.5', expiration_seconds: 3600, status: 'pending_create', uncertain: false, attempts: 1, ...extra,
  })
  const ativa = (txid: string, extra: Record<string, unknown> = {}) => Response.json(cob(txid, { valor: { original: '2.50' }, ...extra }))

  it('primeira tentativa cria a COB com o valor formatado', async () => {
    const c = charge()
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(ativa(c.txid))
    expect(await stepCharge(createItauPixClient(config, fetchMtls), c)).toEqual({ outcome: 'active', revision: 0, pixCopiaECola: '000201...' })
    expect(fetchMtls.mock.calls[1][1].method).toBe('PUT')
    expect(JSON.parse(fetchMtls.mock.calls[1][1].body).valor).toEqual({ original: '2.50' })
  })

  it('depois de resposta perdida consulta antes e não cria de novo', async () => {
    const c = charge({ uncertain: true, attempts: 2 })
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(ativa(c.txid))
    expect((await stepCharge(createItauPixClient(config, fetchMtls), c)).outcome).toBe('active')
    expect(fetchMtls.mock.calls.map((call) => call[1].method)).toEqual(['POST', 'GET'])
  })

  it('consulta 404 numa nova tentativa leva à criação', async () => {
    const c = charge({ attempts: 2 })
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(Response.json({ title: 'Não encontrada' }, { status: 404 }))
      .mockResolvedValueOnce(ativa(c.txid))
    expect((await stepCharge(createItauPixClient(config, fetchMtls), c)).outcome).toBe('active')
    expect(fetchMtls.mock.calls.map((call) => call[1].method)).toEqual(['POST', 'GET', 'PUT'])
  })

  it('cobrança existente já paga vira concluded, nunca active', async () => {
    const c = charge({ uncertain: true })
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(ativa(c.txid, { status: 'CONCLUIDA' }))
    expect((await stepCharge(createItauPixClient(config, fetchMtls), c)).outcome).toBe('concluded')
  })

  it('cancelamento: inexistente = cancelada, paga = concluded, sem resposta = incerta', async () => {
    const c = charge({ status: 'pending_cancel' })
    const run = (response: Response | Error) => stepCharge(createItauPixClient(config,
      vi.fn().mockResolvedValueOnce(tokenResponse())[response instanceof Error ? 'mockRejectedValueOnce' : 'mockResolvedValueOnce'](response)), c)
    expect((await run(Response.json({}, { status: 404 }))).outcome).toBe('cancelled')
    expect((await run(ativa(c.txid, { status: 'CONCLUIDA' }))).outcome).toBe('concluded')
    expect((await run(new TypeError('timeout'))).outcome).toBe('uncertain')
    expect((await run(Response.json({ title: 'Erro' }, { status: 500 }))).outcome).toBe('error')
  })

  it('processa o que foi reservado e registra cada resultado', async () => {
    const a = charge({ id: 10 })
    const b = charge({ id: 11, status: 'pending_cancel' })
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(ativa(a.txid))
      .mockResolvedValueOnce(ativa(b.txid, { status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' }))
    const recorded: [number, string][] = []
    const summary = await processItauPixQueue(createItauPixClient(config, fetchMtls), {
      claim: async () => [a, b],
      record: async (id, outcome) => { recorded.push([id, outcome.outcome]) },
    })
    expect(recorded).toEqual([[10, 'active'], [11, 'cancelled']])
    expect(summary).toMatchObject({ active: 1, cancelled: 1, error: 0 })
  })
})
