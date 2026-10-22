import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createItauPixClient, isVelaTestTxid, isVelaTxid, ItauPixError, newVelaTestTxid, newVelaTxid, pollItauPixReceipts, processItauPixQueue, runItauPixAction, stepCharge,
  type ItauPixConfig, type QueuedCharge,
} from '../../../supabase/functions/_shared/itauPix'

const config: ItauPixConfig = {
  clientId: 'id-ficticio', clientSecret: 'segredo-ficticio', pixKey: '06352972000121',
  baseUrl: 'https://itau.test/v2', tokenUrl: 'https://sts.test/token', authHeader: 'Authorization',
  certPem: '', keyPem: '',
}
// endToEndId no padrão BCB com o minuto UTC da iniciação (aaaaMMddHHmm).
const e2e = (utcMinute: string, n = 1) => `E18236120${utcMinute}s${String(n).padStart(10, '0')}`
const tokenResponse = () => Response.json({ access_token: 'tok-ficticio', token_type: 'Bearer', expires_in: 300 })
const cob = (txid: string, extra: Record<string, unknown> = {}) => ({
  txid, revisao: 0, status: 'ATIVA', calendario: { criacao: '2026-10-06T12:00:00Z', expiracao: 3600 },
  valor: { original: '0.01' }, pixCopiaECola: '000201...', ...extra,
})

// Relógio fixo: o cliente recusa horário do Itaú no futuro, e as datas destes testes são fixas.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-08T00:00:00Z')) })
afterEach(() => { vi.useRealTimers() })

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

  it('aceita a validade como inteiro em texto, como o sandbox devolveu, e recusa o resto', async () => {
    const txid = newVelaTxid()
    const reply = (expiracao: unknown) => createItauPixClient(config, vi.fn().mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(Response.json(cob(txid, { calendario: { criacao: '2026-10-06T12:00:00Z', expiracao } }))))
    expect((await reply('3600').createCob(txid, '0.01', 3600)).calendario.expiracao).toBe(3600)
    for (const bad of ['36a0', '-1', '3600.5', '', null]) await expect(reply(bad).getCob(txid)).rejects.toThrow('não confirma')
  })

  it('GET /pix envia o período sem milissegundos, sem encolher a janela pedida', async () => {
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(Response.json({ pix: [] }))
    await createItauPixClient(config, fetchMtls).listPix('2026-10-06T01:47:07.506Z', '2026-10-07T01:47:07.506Z')
    const url = new URL(fetchMtls.mock.calls[1][0])
    expect([url.searchParams.get('inicio'), url.searchParams.get('fim')]).toEqual(['2026-10-05T22:47:07-03:00', '2026-10-06T22:47:08-03:00'])
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
      .mockResolvedValueOnce(page(0, [{ endToEndId: 'E1', txid: newVelaTxid(), valor: '0.01', horario: '2026-10-06T12:00:00-03:00' }]))
      .mockResolvedValueOnce(page(1, [{ endToEndId: 'E2', txid: newVelaTxid(), valor: '0.02', horario: '2026-10-06T12:00:00-03:00' }]))
    const pix = await createItauPixClient(config, fetchMtls).listPix('2026-10-06T00:00:00Z', '2026-10-07T00:00:00Z')
    expect(pix.map((p) => p.endToEndId)).toEqual(['E1', 'E2'])
    expect(pix.map((p) => p.horario)).toEqual(['2026-10-06T15:00:00.000Z', '2026-10-06T15:00:00.000Z'])
    expect(fetchMtls.mock.calls[2][0]).toContain('paginacao.paginaAtual=1')
  })

  it('avança o checkpoint quando o Itaú informa 100 páginas para zero recebimentos', async () => {
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockImplementation(async () => Response.json({
      parametros: { paginacao: { paginaAtual: 1, itensPorPagina: 0, quantidadeDePaginas: 100, quantidadeTotalDeItens: 0 } },
      pix: [],
    }))
    const saveCheckpoint = vi.fn()
    const settle = vi.fn()
    const result = await pollItauPixReceipts(createItauPixClient(config, fetchMtls), {
      checkpoint: async () => '2026-10-07T01:29:00.444Z', settle, saveCheckpoint, failed: vi.fn(), untracked: vi.fn(),
    }, new Date('2026-10-07T07:00:00Z'))
    expect(result).toMatchObject({ seen: 0, settled: 0, until: '2026-10-07T07:00:00.000Z' })
    expect(saveCheckpoint).toHaveBeenCalledWith('2026-10-07T07:00:00.000Z')
    expect(settle).not.toHaveBeenCalled()
    expect(fetchMtls).toHaveBeenCalledTimes(2)
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
        { endToEndId: 'E1', txid: vela, valor: '0.01', horario: '2026-10-06T12:00:00-03:00', infoPagador: 'texto do cliente' },
        { endToEndId: 'E2', txid: '88ba8ec675e044178d434908d9b2a30a', valor: '9.00', horario: '2026-10-06T12:00:00-03:00', infoPagador: 'alheio' },
        { endToEndId: 'E3', valor: '5.00', horario: '2026-10-06T12:00:00-03:00' },
      ],
    }))
    const result = await runItauPixAction(createItauPixClient(config, fetchMtls),
      { action: 'list_pix', inicio: '2026-10-06T00:00:00Z', fim: '2026-10-07T00:00:00Z' })
    expect(result).toEqual({ pix: [{ endToEndId: 'E1', txid: vela, valor: '0.01', horario: '2026-10-06T15:00:00.000Z' }], outros: 2 })
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

  it('erro do Itaú gravado na cobrança sai sem dado do pagador (auditoria run-3)', async () => {
    const c = charge({ status: 'pending_update' })
    const refused = Response.json({
      title: 'Cobrança inválida.', status: 400,
      violacoes: [{ razao: 'CPF inválido', propriedade: 'devedor.cpf', valor: '12345678909' }],
      devedor: { cpf: '12345678909', nome: 'Fulano de Tal' },
      pix: [{ endToEndId: 'E1', infoPagador: 'pago por Fulano', valor: '2.50' }],
    }, { status: 400 })
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(refused)
    const result = await stepCharge(createItauPixClient(config, fetchMtls), c)
    expect(result.outcome).toBe('error')
    const error = (result as { error: string }).error
    expect(error).toContain('CPF inválido')
    expect(error).toContain('devedor.cpf')
    expect(error).not.toContain('12345678909')
    expect(error).not.toContain('Fulano')
    expect(error).toContain('"valor":"2.50"')
  })

  it('primeira tentativa cria a COB com o valor formatado', async () => {
    const c = charge()
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(ativa(c.txid))
    expect(await stepCharge(createItauPixClient(config, fetchMtls), c)).toEqual({ outcome: 'active', revision: 0, pixCopiaECola: '000201...', bankCreatedAt: '2026-10-06T15:00:00.000Z' })
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

  it('cancelamento repetido consulta antes: removida ou inexistente = cancelada, paga = concluded', async () => {
    const c = charge({ status: 'pending_cancel', uncertain: true, attempts: 2 })
    const run = (response: Response) => {
      const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(response)
      return stepCharge(createItauPixClient(config, fetchMtls), c).then((outcome) => ({ outcome: outcome.outcome, methods: fetchMtls.mock.calls.map((call) => call[1].method) }))
    }
    expect(await run(ativa(c.txid, { status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' }))).toEqual({ outcome: 'cancelled', methods: ['POST', 'GET'] })
    expect(await run(Response.json({}, { status: 404 }))).toEqual({ outcome: 'cancelled', methods: ['POST', 'GET'] })
    expect(await run(ativa(c.txid, { status: 'CONCLUIDA' }))).toEqual({ outcome: 'concluded', methods: ['POST', 'GET'] })
    // Ainda ativa no banco: aí sim pede o cancelamento.
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(ativa(c.txid))
      .mockResolvedValueOnce(ativa(c.txid, { status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' }))
    expect((await stepCharge(createItauPixClient(config, fetchMtls), c)).outcome).toBe('cancelled')
    expect(fetchMtls.mock.calls.map((call) => call[1].method)).toEqual(['POST', 'GET', 'PATCH'])
  })

  it('PTAX/renovação: PATCH no mesmo TXID com valor e validade; paga antes vira concluded', async () => {
    const c = charge({ status: 'pending_update', amount_brl: '3.1', expiration_seconds: 90000 })
    const ok = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(ativa(c.txid, { revisao: 1, valor: { original: '3.10' } }))
    expect(await stepCharge(createItauPixClient(config, ok), c)).toMatchObject({ outcome: 'active', revision: 1 })
    expect(ok.mock.calls[1][1].method).toBe('PATCH')
    expect(JSON.parse(ok.mock.calls[1][1].body)).toEqual({ valor: { original: '3.10' }, calendario: { expiracao: 90000 } })
    const paid = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(ativa(c.txid, { status: 'CONCLUIDA' }))
    expect((await stepCharge(createItauPixClient(config, paid), c)).outcome).toBe('concluded')
  })

  it('alteração repetida consulta antes e reconhece a cobrança paga sem novo PATCH', async () => {
    const c = charge({ status: 'pending_update', amount_brl: '3.1', attempts: 2 })
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(ativa(c.txid, { status: 'CONCLUIDA' }))
    expect((await stepCharge(createItauPixClient(config, fetchMtls), c)).outcome).toBe('concluded')
    expect(fetchMtls.mock.calls.map((call) => call[1].method)).toEqual(['POST', 'GET'])
  })

  it('vencida: só vira expired depois de o banco confirmar que não foi paga', async () => {
    const c = charge({ status: 'pending_expire_check' })
    const now = new Date('2026-10-06T17:00:00Z')
    const run = (body: Response) => stepCharge(createItauPixClient(config, vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(body)), c, now)
    // criação 12:00 Brasília = 15:00 UTC; validade até 16:00 UTC < 17:00 UTC
    expect((await run(ativa(c.txid))).outcome).toBe('expired')
    expect((await run(ativa(c.txid, { status: 'CONCLUIDA' }))).outcome).toBe('concluded')
    expect((await run(Response.json({}, { status: 404 }))).outcome).toBe('expired')
    // Banco ainda considera válida (relógios diferentes): continua ativa.
    expect((await run(ativa(c.txid, { calendario: { criacao: '2026-10-06T12:00:00Z', expiracao: 9000 } }))).outcome).toBe('active')
    expect((await stepCharge(createItauPixClient(config, vi.fn().mockResolvedValueOnce(tokenResponse()).mockRejectedValueOnce(new TypeError('x'))), c, now)).outcome).toBe('uncertain')
  })

  it('processa o que foi reservado e registra cada resultado', async () => {
    const a = charge({ id: 10, change_version: 3 })
    const b = charge({ id: 11, status: 'pending_cancel' })
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(ativa(a.txid))
      .mockResolvedValueOnce(ativa(b.txid, { status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' }))
    const recorded: [number, string, number | undefined][] = []
    const summary = await processItauPixQueue(createItauPixClient(config, fetchMtls), {
      claim: vi.fn().mockResolvedValueOnce([a, b]).mockResolvedValue([]),
      record: async (id, outcome, claimedVersion) => { recorded.push([id, outcome.outcome, claimedVersion]) },
    })
    // A versão reservada volta ao banco, que só ativa a versão enviada (migration 412).
    expect(recorded).toEqual([[10, 'active', 3], [11, 'cancelled', undefined]])
    expect(summary).toMatchObject({ active: 1, cancelled: 1, error: 0 })
  })

  // Migration 219: blocos pequenos por orçamento de tempo, teto por execução, parada no 429
  // e vez única do runner. Cliente falso: um ms por chamada no relógio do teste.
  const queueOf = (total: number, options: { failOn?: number; failStatus?: number; renew?: boolean[]; spawnOn?: number } = {}) => {
    let clock = 0
    let next = 1
    const claims: number[] = []
    const recorded: number[] = []
    const client = {
      async createCob(txid: string) {
        clock += 1000
        if (options.failOn !== undefined && recorded.length + 1 === options.failOn) throw new ItauPixError('falha', options.failStatus ?? 429, null)
        return cob(txid, { valor: { original: '2.50' } })
      },
    } as never
    const renewals = options.renew ? [...options.renew] : undefined
    const queue = {
      claim: async (limit: number) => {
        const batch: QueuedCharge[] = []
        while (batch.length < limit && next <= total) batch.push(charge({ id: next++, txid: newVelaTxid() }))
        claims.push(batch.length)
        return batch
      },
      record: async (id: number) => {
        recorded.push(id)
        // O registro cria trabalho novo (substituta da cobrança vencida).
        if (id === options.spawnOn) total += 1
      },
      ...(renewals ? { renew: async () => renewals.shift() ?? true } : {}),
    }
    return { client, queue, claims, recorded, now: () => clock }
  }

  it('fila grande: blocos de 5 até o teto de 60 por execução', async () => {
    const q = queueOf(200)
    const summary = await processItauPixQueue(q.client, q.queue, { now: q.now, budgetMs: 1_000_000 })
    expect(q.recorded).toHaveLength(60)
    expect(q.claims.every((n) => n === 5)).toBe(true)
    expect(summary).toMatchObject({ active: 60, throttled: false })
  })

  it('cobranças lentas: para de pedir blocos quando acaba o orçamento de 20 s', async () => {
    const q = queueOf(200)
    await processItauPixQueue(q.client, q.queue, { now: q.now })
    // 1 s por chamada: o 4º bloco termina em 20 s e nenhum outro é pedido.
    expect(q.claims).toEqual([5, 5, 5, 5])
  })

  it('429 do Itaú: registra a cobrança e para de chamar o banco', async () => {
    const q = queueOf(20, { failOn: 3 })
    const summary = await processItauPixQueue(q.client, q.queue, { now: q.now })
    expect(q.recorded).toEqual([1, 2, 3])
    expect(summary).toMatchObject({ active: 2, error: 1, throttled: true })
  })

  it('parada no meio do bloco libera as reservadas e não chamadas (419)', async () => {
    const released: number[][] = []
    const q = queueOf(20, { failOn: 3 })
    await processItauPixQueue(q.client, { ...q.queue, release: async (ids: number[]) => { released.push(ids) } }, { now: q.now })
    // Bloco 1–5: 3 respondeu 429; 4 e 5 não foram chamadas.
    expect(released).toEqual([[4, 5]])
    const unreachable = queueOf(20, { failOn: 5, failStatus: 0 })
    const none: number[][] = []
    await processItauPixQueue(unreachable.client, { ...unreachable.queue, release: async (ids: number[]) => { none.push(ids) } }, { now: unreachable.now })
    // A última do bloco ficou incerta: não há reservada sem chamada.
    expect(none).toEqual([])
  })

  it('Itaú sem resposta: registra a incerta e para, sem esperar o resto do bloco', async () => {
    const q = queueOf(20, { failOn: 2, failStatus: 0 })
    const summary = await processItauPixQueue(q.client, q.queue, { now: q.now })
    expect(q.recorded).toEqual([1, 2])
    expect(summary).toMatchObject({ active: 1, uncertain: 1, unreachable: true, throttled: false })
  })

  it('cobrança criada durante a execução: entra na mesma execução', async () => {
    // Antes, um bloco menor que 5 encerrava a execução e a substituta esperava o minuto seguinte.
    const q = queueOf(1, { spawnOn: 1 })
    const summary = await processItauPixQueue(q.client, q.queue, { now: q.now })
    expect(q.recorded).toEqual([1, 2])
    expect(q.claims).toEqual([1, 1, 0])
    expect(summary).toMatchObject({ active: 2 })
  })

  it('perdeu a vez entre blocos: encerra sem pedir outro bloco', async () => {
    const q = queueOf(20, { renew: [false] })
    await processItauPixQueue(q.client, q.queue, { now: q.now })
    expect(q.claims).toEqual([5])
  })

  it('stepCharge marca 429 como limite, sem incerteza', async () => {
    const c = charge()
    const limited = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(Response.json({}, { status: 429 }))
    expect(await stepCharge(createItauPixClient(config, limited), c)).toMatchObject({ outcome: 'error', throttled: true })
  })
})

describe('consulta de recebimentos', () => {
  const pixPage = (pix: unknown[]) => Response.json({ parametros: { paginacao: { quantidadeDePaginas: 1 } }, pix })
  const vela = newVelaTxid()
  const sink = (last: string | null, settle = vi.fn(async () => 'settled' as const), verdict: 'review' | 'retry' = 'retry') => {
    const saved: string[] = []
    const failed = vi.fn(async (_pix: unknown, _error: string, permanent: boolean) => (permanent ? 'review' : verdict) as 'review' | 'retry')
    const untracked = vi.fn(async () => 'review' as const)
    return { saved, settle, failed, untracked, sink: { checkpoint: async () => last, settle, failed, untracked, saveCheckpoint: async (until: string) => { saved.push(until) } } }
  }

  it('consulta em Brasília e baixa o pagamento com o instante UTC correto', async () => {
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockImplementation(async (input: string) => {
      const url = new URL(input)
      const correctWindow = url.searchParams.get('inicio') === '2026-10-07T17:00:00-03:00' &&
        url.searchParams.get('fim') === '2026-10-07T17:10:00-03:00'
      return pixPage(correctWindow ? [{ endToEndId: 'E18236120202610072004s0035629b19', txid: vela,
        valor: '0.15', horario: '2026-10-07T17:04:50Z' }] : [])
    })
    const s = sink('2026-10-07T20:10:00Z')
    await pollItauPixReceipts(createItauPixClient(config, fetchMtls), s.sink, new Date('2026-10-07T20:10:00Z'))
    expect(s.settle).toHaveBeenCalledWith({ endToEndId: 'E18236120202610072004s0035629b19', txid: vela,
      valor: '0.15', horario: '2026-10-07T20:04:50.000Z' })
    expect(s.saved).toEqual(['2026-10-07T20:10:00.000Z'])
  })

  it('não considera vencida uma COB criada em Brasília com Z indevido', async () => {
    const txid = newVelaTxid()
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(Response.json(cob(txid, {
      calendario: { criacao: '2026-10-07T17:04:01Z', expiracao: 3600 },
    })))
    const result = await stepCharge(createItauPixClient(config, fetchMtls), { id: 1, txid,
      amount_brl: '0.01', expiration_seconds: 3600, status: 'pending_expire_check', uncertain: false, attempts: 1,
    }, new Date('2026-10-07T20:30:00Z'))
    expect(result).toMatchObject({ outcome: 'active', bankCreatedAt: '2026-10-07T20:04:01.000Z' })
  })

  it('para sem gravar quando o Itaú passa a mandar UTC verdadeiro', async () => {
    vi.setSystemTime(new Date('2026-10-07T20:10:00Z'))
    // Pago às 20:04:50 UTC e enviado corretamente como Z: lido como Brasília, cairia 3 h no futuro.
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(pixPage([
      { endToEndId: e2e('202610072004'), txid: vela, valor: '0.15', horario: '2026-10-07T20:04:50Z' },
    ]))
    const s = sink('2026-10-07T20:00:00Z')
    await expect(pollItauPixReceipts(createItauPixClient(config, fetchMtls), s.sink, new Date())).rejects.toThrow('no futuro')
    expect(s.settle).not.toHaveBeenCalled()
    expect(s.saved).toEqual([])

    const txid = newVelaTxid()
    const created = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(Response.json(cob(txid, {
      calendario: { criacao: '2026-10-07T20:09:00Z', expiracao: 3600 },
    })))
    const result = await stepCharge(createItauPixClient(config, created), { id: 1, txid,
      amount_brl: '0.01', expiration_seconds: 3600, status: 'pending_create', uncertain: false, attempts: 1,
    }, new Date())
    expect(result).toMatchObject({ outcome: 'error', error: expect.stringContaining('no futuro') })
  })

  it('na recuperação de atraso, UTC verdadeiro antigo diverge do endToEndId e não é baixado', async () => {
    // Pago às 19:00 UTC e enviado como 19:00:30Z; lido como Brasília vira 22:00:30 UTC,
    // ainda no passado às 00:00, então só o endToEndId revela o desvio.
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(pixPage([
      { endToEndId: e2e('202610071900'), txid: vela, valor: '0.20', horario: '2026-10-07T19:00:30Z' },
    ]))
    const s = sink('2026-10-07T18:00:00Z')
    await expect(pollItauPixReceipts(createItauPixClient(config, fetchMtls), s.sink, new Date())).rejects.toThrow('diverge do endToEndId')
    expect(s.settle).not.toHaveBeenCalled()
    expect(s.saved).toEqual([])
  })

  it('um comprovante isolado que diverge do endToEndId vai para análise sem parar a baixa dos demais (P4)', async () => {
    const odd = newVelaTxid()
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(pixPage([
      { endToEndId: e2e('202610061500', 1), txid: vela, valor: '0.01', horario: '2026-10-06T12:00:00Z' },
      { endToEndId: e2e('202610060800', 2), txid: odd, valor: '0.02', horario: '2026-10-06T12:01:00Z' },
      { endToEndId: e2e('202610061502', 3), txid: newVelaTxid(), valor: '0.03', horario: '2026-10-06T12:02:00Z' },
    ]))
    const s = sink('2026-10-06T12:00:00.000Z')
    const summary = await pollItauPixReceipts(createItauPixClient(config, fetchMtls), s.sink, new Date('2026-10-06T12:05:00Z'))
    expect(summary).toMatchObject({ vela: 3, settled: 2, review: 1 })
    expect(s.failed).toHaveBeenCalledWith(expect.objectContaining({ txid: odd }), expect.stringContaining('diverge do endToEndId'), true)
    expect(s.settle).not.toHaveBeenCalledWith(expect.objectContaining({ txid: odd }))
    expect(s.saved).toEqual(['2026-10-06T12:05:00.000Z'])
  })

  it('a maioria divergindo é fuso: para sem baixar nenhum e leva os TXIDs', async () => {
    const a = newVelaTxid()
    const b = newVelaTxid()
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(pixPage([
      { endToEndId: e2e('202610061500', 1), txid: vela, valor: '0.01', horario: '2026-10-06T12:00:00Z' },
      { endToEndId: e2e('202610061201', 2), txid: a, valor: '0.02', horario: '2026-10-06T12:01:00Z' },
      { endToEndId: e2e('202610061202', 3), txid: b, valor: '0.03', horario: '2026-10-06T12:02:00Z' },
    ]))
    const s = sink('2026-10-06T12:00:00.000Z')
    const error = await pollItauPixReceipts(createItauPixClient(config, fetchMtls), s.sink, new Date('2026-10-06T12:05:00Z')).catch((e) => e)
    expect(error).toMatchObject({ message: expect.stringContaining('diverge do endToEndId'), body: { txids: [a, b] } })
    expect(s.settle).not.toHaveBeenCalled()
    expect(s.saved).toEqual([])
  })

  it('endToEndId com data impossível é formato inesperado, não outro instante', async () => {
    for (const minute of ['202613061500', '202610061599', '202602301500']) {
      const s = sink('2026-10-06T12:00:00.000Z')
      const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(pixPage([
        { endToEndId: e2e(minute), txid: vela, valor: '0.01', horario: '2026-10-06T12:00:00Z' },
      ]))
      const summary = await pollItauPixReceipts(createItauPixClient(config, fetchMtls), s.sink, new Date('2026-10-06T12:05:00Z'))
      expect(summary).toMatchObject({ review: 1, settled: 0 })
      expect(s.failed).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('formato inesperado'), true)
    }
  })

  it('baixa só TXID do Vela, ignora o terceiro e avança o checkpoint com sobreposição', async () => {
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(pixPage([
      { endToEndId: e2e('202610061500'), txid: vela, valor: '0.01', horario: '2026-10-06T12:00:00Z' },
      { endToEndId: 'E2', txid: '88ba8ec675e044178d434908d9b2a30a', valor: '50.00', horario: '2026-10-06T12:01:00Z' },
      { endToEndId: 'E3', valor: '9.00', horario: '2026-10-06T12:02:00Z' }, // Pix sem TXID
      { endToEndId: 'E4', txid: newVelaTestTxid(), valor: '0.01', horario: '2026-10-06T12:03:00Z' }, // teste da Fase 1
    ]))
    const s = sink('2026-10-06T12:00:00.000Z')
    const now = new Date('2026-10-06T12:05:00Z')
    const summary = await pollItauPixReceipts(createItauPixClient(config, fetchMtls), s.sink, now)
    expect(summary).toMatchObject({ seen: 4, vela: 1, test: 1, settled: 1, review: 0 })
    expect(s.settle).toHaveBeenCalledTimes(1)
    expect(s.settle).toHaveBeenCalledWith({ endToEndId: e2e('202610061500'), txid: vela, valor: '0.01', horario: '2026-10-06T15:00:00.000Z' })
    const url = new URL(fetchMtls.mock.calls[1][0])
    expect(url.searchParams.get('inicio')).toBe('2026-10-06T08:50:00-03:00') // 10 min antes do checkpoint, sem milissegundos
    expect(s.saved).toEqual(['2026-10-06T12:05:00.000Z'])
  })

  it('atraso grande é recuperado em janelas de até 6 horas', async () => {
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(pixPage([]))
    const s = sink('2026-10-01T00:00:00.000Z')
    await pollItauPixReceipts(createItauPixClient(config, fetchMtls), s.sink, new Date('2026-10-06T12:00:00Z'))
    expect(new URL(fetchMtls.mock.calls[1][0]).searchParams.get('fim')).toBe('2026-10-01T02:50:00-03:00')
    expect(s.saved).toEqual(['2026-10-01T05:50:00.000Z'])
  })

  it('falha passageira ao baixar não avança até a terceira; Pix malformado vai para análise e a consulta avança (F-09)', async () => {
    const ok = { endToEndId: e2e('202610061500'), txid: vela, valor: '0.01', horario: '2026-10-06T12:00:00Z' }
    const failing = sink('2026-10-06T12:00:00.000Z', vi.fn(async () => { throw new Error('db') }))
    await expect(pollItauPixReceipts(createItauPixClient(config, vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(pixPage([ok]))),
      failing.sink, new Date('2026-10-06T12:05:00Z'))).rejects.toThrow('db')
    expect(failing.failed).toHaveBeenCalledWith(expect.objectContaining({ txid: vela }), 'db', false)
    expect(failing.saved).toEqual([])
    // O banco devolve 'review' na terceira falha: a consulta segue.
    const exhausted = sink('2026-10-06T12:00:00.000Z', vi.fn(async () => { throw new Error('db') }), 'review')
    const summary = await pollItauPixReceipts(createItauPixClient(config, vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(pixPage([ok]))),
      exhausted.sink, new Date('2026-10-06T12:05:00Z'))
    expect(summary).toMatchObject({ vela: 1, review: 1 })
    expect(exhausted.saved).toEqual(['2026-10-06T12:05:00.000Z'])
    for (const bad of [{ ...ok, valor: '1' }, { ...ok, endToEndId: 'E1' }, { ...ok, horario: 'inválidoZ' }, { ...ok, horario: '2026-10-06T12:00:00' }]) {
      const malformed = sink('2026-10-06T12:00:00.000Z')
      const result = await pollItauPixReceipts(createItauPixClient(config, vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(pixPage([bad]))),
        malformed.sink, new Date('2026-10-06T12:05:00Z'))
      expect(result).toMatchObject({ review: 1 })
      expect(malformed.failed).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('formato inesperado'), true)
      expect(malformed.saved).toEqual(['2026-10-06T12:05:00.000Z'])
      expect(malformed.settle).not.toHaveBeenCalled()
    }
  })

  it('Pix sem TXID vira "Pix recebido sem baixa" e o de terceiro segue ignorado (decisão 16)', async () => {
    const s = sink('2026-10-06T12:00:00.000Z')
    const summary = await pollItauPixReceipts(createItauPixClient(config, vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(pixPage([
      { endToEndId: e2e('202610061501'), valor: '120.00', horario: '2026-10-06T12:01:00Z' },
      { endToEndId: e2e('202610061502'), txid: '88ba8ec675e044178d434908d9b2a30a', valor: '50.00', horario: '2026-10-06T12:02:00Z' },
    ]))), s.sink, new Date('2026-10-06T12:05:00Z'))
    expect(summary).toMatchObject({ seen: 2, vela: 0, untracked: 1 })
    expect(s.untracked).toHaveBeenCalledWith({ endToEndId: e2e('202610061501'), valor: '120.00', horario: '2026-10-06T15:01:00.000Z' })
    expect(s.settle).not.toHaveBeenCalled()
    expect(s.saved).toEqual(['2026-10-06T12:05:00.000Z'])
  })

  it('recusa ao gravar Pix sem TXID segue a regra das falhas: para até a terceira vez e depois vai para análise', async () => {
    const page = () => pixPage([{ endToEndId: e2e('202610061501'), valor: '0.00', horario: '2026-10-06T12:01:00Z' }])
    const refuse = (verdict: 'review' | 'retry') => {
      const s = sink('2026-10-06T12:00:00.000Z', undefined, verdict)
      s.untracked.mockRejectedValue(new Error('Valor do Pix inválido.'))
      return s
    }
    const retry = refuse('retry')
    await expect(pollItauPixReceipts(createItauPixClient(config, vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(page())),
      retry.sink, new Date('2026-10-06T12:05:00Z'))).rejects.toThrow('Valor do Pix inválido.')
    expect(retry.saved).toEqual([])
    const review = refuse('review')
    const summary = await pollItauPixReceipts(createItauPixClient(config, vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(page())),
      review.sink, new Date('2026-10-06T12:05:00Z'))
    expect(summary).toMatchObject({ untracked: 0, review: 1 })
    expect(review.failed).toHaveBeenCalledWith(expect.objectContaining({ endToEndId: e2e('202610061501'), txid: '' }), 'Valor do Pix inválido.', false)
    expect(review.saved).toEqual(['2026-10-06T12:05:00.000Z'])
  })

  it('horário inesperado de Pix de terceiro não derruba a consulta', async () => {
    const s = sink('2026-10-06T12:00:00.000Z')
    const summary = await pollItauPixReceipts(createItauPixClient(config, vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(pixPage([
      { endToEndId: 'E2', txid: '88ba8ec675e044178d434908d9b2a30a', valor: '50.00', horario: 'sem fuso' },
    ]))), s.sink, new Date('2026-10-06T12:05:00Z'))
    expect(summary).toMatchObject({ seen: 1, vela: 0 })
    expect(s.saved).toEqual(['2026-10-06T12:05:00.000Z'])
  })

  it('mais de 50 páginas: a janela encolhe em vez de travar o checkpoint', async () => {
    const many = Response.json({ parametros: { paginacao: { quantidadeDePaginas: 99, quantidadeTotalDeItens: 9999 } }, pix: [{ endToEndId: 'E9', txid: '88ba8ec675e044178d434908d9b2a30a', valor: '1.00', horario: '2026-10-06T12:00:00Z' }] })
    let calls = 0
    const fetchMtls = vi.fn().mockResolvedValueOnce(tokenResponse()).mockImplementation(async (input: string) => {
      const url = new URL(input)
      // A janela inicial (6 h) tem páginas demais; a de 3 h, uma só.
      if (url.searchParams.get('fim') === '2026-10-01T02:50:00-03:00') { calls++; return many.clone() }
      return pixPage([])
    })
    const s = sink('2026-10-01T00:00:00.000Z')
    await pollItauPixReceipts(createItauPixClient(config, fetchMtls), s.sink, new Date('2026-10-06T12:00:00Z'))
    expect(calls).toBe(50)
    expect(s.saved).toEqual(['2026-10-01T02:50:00.000Z'])
  })
})
