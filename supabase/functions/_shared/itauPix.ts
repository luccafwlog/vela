// Cliente da API Pix Recebimentos do Itaú (regulatório Pix v2, OpenAPI 2.27.2).
// Sem dependência de Deno: o chamador fornece o fetch com mTLS, e os testes, um fetch simulado.
// Nenhuma função aqui registra ou devolve token, segredo ou chave.

export type ItauPixConfig = {
  clientId: string
  clientSecret: string
  pixKey: string
  baseUrl: string
  tokenUrl: string
  authHeader: string
  certPem: string
  keyPem: string
}

export type ItauCob = {
  txid: string
  revisao: number
  status: string
  calendario: { criacao: string; expiracao: number }
  valor: { original: string }
  pixCopiaECola?: string
  location?: string
  pix?: { endToEndId: string; valor: string; horario: string }[]
}

export type ItauPix = { endToEndId: string; txid?: string; valor: string; horario: string }

export class ItauPixError extends Error {
  // status 0 = sem resposta (timeout/rede): o resultado de uma escrita é incerto.
  readonly status: number
  readonly body: unknown
  constructor(message: string, status: number, body: unknown = null) {
    super(message)
    this.status = status
    this.body = body
  }
}

const VELA_TXID = /^VELA[A-Z0-9]{22,31}$/
const MONEY = /^\d+\.\d{2}$/
const TIMEOUT_MS = 15000

export function itauPixConfigFromEnv(get: (name: string) => string | undefined): ItauPixConfig {
  const required = (name: string) => {
    const value = get(name)?.trim()
    if (!value) throw new ItauPixError(`Configuração Itaú ausente: ${name}.`, 0)
    return value
  }
  return {
    clientId: required('ITAU_CLIENT_ID'),
    clientSecret: required('ITAU_CLIENT_SECRET'),
    pixKey: required('ITAU_PIX_KEY'),
    certPem: atob(required('ITAU_CERT_B64')),
    keyPem: atob(required('ITAU_KEY_B64')),
    // ponytail: defaults do guia de 2026-10; os overrides existem porque header e host ainda serão confirmados na Fase 1.
    baseUrl: get('ITAU_PIX_BASE_URL')?.trim() || 'https://pix-pj.api.itau.com/regulatorio-pix/v2',
    tokenUrl: get('ITAU_TOKEN_URL')?.trim() || 'https://sts.itau.com.br/api/oauth/token',
    authHeader: get('ITAU_AUTH_HEADER')?.trim() || 'Authorization',
  }
}

// TXID próprio do Vela: prefixo fixo para nunca colidir com cobranças do sistema de terceiro
// na mesma chave Pix, e só maiúsculas porque a conciliação normaliza TXIDs para maiúsculas.
// Cobrança de fatura: 'VELA' + 28 hexadecimais, o mesmo formato gerado no banco de dados.
export function newVelaTxid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(14))
  return 'VELA' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

export function isVelaTxid(txid: unknown): txid is string {
  return typeof txid === 'string' && VELA_TXID.test(txid)
}

// Cobrança de teste: 'VELAT' + 27 caracteres. O 'T' nunca aparece no hexadecimal das
// cobranças de fatura, então as ações de diagnóstico não alcançam fatura real: a cobrança
// de uma fatura só muda pela própria fatura no Vela (decisão do dono, 2026-10-06).
export function newVelaTestTxid(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(27))
  return 'VELAT' + Array.from(bytes, (b) => alphabet[b % 36]).join('')
}

export function isVelaTestTxid(txid: unknown): txid is string {
  return isVelaTxid(txid) && txid.startsWith('VELAT')
}

function assertMoney(amount: string): void {
  if (!MONEY.test(amount) || Number(amount) <= 0) throw new ItauPixError('Valor Pix inválido.', 400)
}

function assertCob(cob: unknown, txid: string): ItauCob {
  const c = cob as Partial<ItauCob> | null
  if (!c || c.txid !== txid || !Number.isSafeInteger(c.revisao) || typeof c.status !== 'string' ||
      !c.calendario || !Number.isSafeInteger(c.calendario.expiracao) ||
      !c.valor || typeof c.valor.original !== 'string' || !MONEY.test(c.valor.original)) {
    throw new ItauPixError('Resposta do Itaú não confirma a cobrança; consultar antes de repetir.', 502, cob)
  }
  return c as ItauCob
}

export function createItauPixClient(config: ItauPixConfig, fetchMtls: typeof fetch) {
  let token: { value: string; expiresAt: number; type: string; scope?: string; expiresIn: number } | null = null

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchMtls(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch {
      throw new ItauPixError('Sem resposta do Itaú; o resultado é incerto.', 0)
    }
  }

  async function accessToken() {
    if (token && Date.now() < token.expiresAt) return token
    const response = await send(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: config.clientId, client_secret: config.clientSecret }),
    })
    const body = await response.json().catch(() => null) as Record<string, unknown> | null
    if (!response.ok || typeof body?.access_token !== 'string' || !body.access_token) {
      // O corpo de erro do STS não contém credenciais; o de sucesso nunca sai daqui.
      throw new ItauPixError(`Autenticação Itaú recusada (${response.status}).`, response.status, response.ok ? null : body)
    }
    const expiresIn = Number(body.expires_in) || 300
    // Renova 30 s antes: o token do Itaú dura 300 s.
    token = { value: body.access_token, expiresIn, type: String(body.token_type ?? ''), scope: body.scope as string | undefined,
      expiresAt: Date.now() + Math.max(expiresIn - 30, 0) * 1000 }
    return token
  }

  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    const { value } = await accessToken()
    const response = await send(config.baseUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json', [config.authHeader]: `Bearer ${value}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const json = await response.json().catch(() => null)
    if (!response.ok) throw new ItauPixError(`Itaú recusou ${method} ${path.split('?')[0]} (${response.status}).`, response.status, json)
    return json
  }

  return {
    async tokenInfo() {
      const t = await accessToken()
      return { token_type: t.type, expires_in: t.expiresIn, scope: t.scope ?? null }
    },

    // Sem retry automático de escrita: status 0 exige getCob antes de repetir.
    async createCob(txid: string, amount: string, expirationSeconds: number, message?: string): Promise<ItauCob> {
      if (!isVelaTxid(txid)) throw new ItauPixError('TXID fora do padrão do Vela.', 400)
      assertMoney(amount)
      if (!Number.isSafeInteger(expirationSeconds) || expirationSeconds <= 0) throw new ItauPixError('Expiração inválida.', 400)
      const cob = assertCob(await call('PUT', `/cob/${txid}`, {
        calendario: { expiracao: expirationSeconds },
        valor: { original: amount },
        chave: config.pixKey,
        ...(message ? { solicitacaoPagador: message.slice(0, 140) } : {}),
      }), txid)
      if (cob.status !== 'ATIVA' || cob.valor.original !== amount) {
        throw new ItauPixError('Cobrança criada diferente do pedido; consultar antes de repetir.', 502, cob)
      }
      return cob
    },

    async getCob(txid: string): Promise<ItauCob> {
      if (!isVelaTxid(txid)) throw new ItauPixError('TXID fora do padrão do Vela.', 400)
      return assertCob(await call('GET', `/cob/${txid}`), txid)
    },

    async updateCob(txid: string, change: { amount?: string; expirationSeconds?: number }): Promise<ItauCob> {
      if (!isVelaTxid(txid)) throw new ItauPixError('TXID fora do padrão do Vela.', 400)
      if (change.amount !== undefined) assertMoney(change.amount)
      if (change.expirationSeconds !== undefined && (!Number.isSafeInteger(change.expirationSeconds) || change.expirationSeconds <= 0)) {
        throw new ItauPixError('Expiração inválida.', 400)
      }
      if (change.amount === undefined && change.expirationSeconds === undefined) throw new ItauPixError('Nada a alterar.', 400)
      const cob = assertCob(await call('PATCH', `/cob/${txid}`, {
        ...(change.amount === undefined ? {} : { valor: { original: change.amount } }),
        ...(change.expirationSeconds === undefined ? {} : { calendario: { expiracao: change.expirationSeconds } }),
      }), txid)
      // CONCLUIDA aqui significa que o cliente pagou antes da alteração: nunca é sucesso.
      if (cob.status !== 'ATIVA' || (change.amount !== undefined && cob.valor.original !== change.amount)) {
        throw new ItauPixError('Alteração não confirmada; consultar a cobrança.', 409, cob)
      }
      return cob
    },

    async cancelCob(txid: string): Promise<ItauCob> {
      if (!isVelaTxid(txid)) throw new ItauPixError('TXID fora do padrão do Vela.', 400)
      const cob = assertCob(await call('PATCH', `/cob/${txid}`, { status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' }), txid)
      if (cob.status !== 'REMOVIDA_PELO_USUARIO_RECEBEDOR') {
        throw new ItauPixError('Cancelamento não confirmado; consultar a cobrança.', 409, cob)
      }
      return cob
    },

    // Percorre todas as páginas do período. A lista pode trazer Pix do sistema de terceiro.
    async listPix(inicio: string, fim: string, maxPages = 50): Promise<ItauPix[]> {
      if (!Number.isFinite(Date.parse(inicio)) || !Number.isFinite(Date.parse(fim))) throw new ItauPixError('Período inválido.', 400)
      const all: ItauPix[] = []
      for (let page = 0; page < maxPages; page++) {
        const query = new URLSearchParams({ inicio, fim, 'paginacao.paginaAtual': String(page) })
        const body = await call('GET', `/pix?${query}`) as { pix?: ItauPix[]; parametros?: { paginacao?: { quantidadeDePaginas?: number } } }
        all.push(...(body?.pix ?? []))
        const pages = body?.parametros?.paginacao?.quantidadeDePaginas ?? 1
        if (page + 1 >= pages) return all
      }
      throw new ItauPixError(`Mais de ${maxPages} páginas no período; reduzir a janela.`, 413)
    },
  }
}

export type ItauPixClient = ReturnType<typeof createItauPixClient>

// ponytail: teto da Fase 1 (prova de centavos); a cobrança de faturas usa outro caminho na Fase 2.
export const TEST_MAX_BRL = 1

// Ações de diagnóstico da Fase 1. Consultam qualquer cobrança do Vela, mas só alteram ou
// cancelam cobranças de teste; a listagem não expõe Pix do sistema de terceiro.
export async function runItauPixAction(client: ItauPixClient, input: Record<string, unknown>): Promise<unknown> {
  const txid = input.txid
  const testTxid = () => {
    if (!isVelaTestTxid(txid)) {
      throw new ItauPixError('Só cobranças de teste (VELAT…) podem ser alteradas ou canceladas aqui; a de uma fatura muda pela fatura.', 400)
    }
    return txid
  }
  const amount = typeof input.amount === 'string' ? input.amount : undefined
  const testAmount = () => {
    if (!amount || !MONEY.test(amount) || Number(amount) <= 0 || Number(amount) > TEST_MAX_BRL) {
      throw new ItauPixError(`Valor de teste deve estar entre 0.01 e ${TEST_MAX_BRL.toFixed(2)}.`, 400)
    }
    return amount
  }
  const seconds = input.expiration_seconds === undefined ? undefined : Number(input.expiration_seconds)
  switch (input.action) {
    case 'token':
      return client.tokenInfo()
    case 'create_test':
      return client.createCob(newVelaTestTxid(), testAmount(), seconds ?? 3600, 'Teste de integração Vela')
    case 'get':
      return client.getCob(txid as string)
    case 'update_test':
      return client.updateCob(testTxid(), { amount: amount === undefined ? undefined : testAmount(), expirationSeconds: seconds })
    case 'cancel':
      return client.cancelCob(testTxid())
    case 'list_pix': {
      // Do terceiro só a contagem: responde se o GET /pix mistura os recebimentos sem
      // trazer infoPagador nem dados de pagador alheios.
      const pix = await client.listPix(String(input.inicio ?? ''), String(input.fim ?? ''))
      const vela = pix.filter((p) => isVelaTxid(p.txid))
      return {
        pix: vela.map(({ endToEndId, txid, valor, horario }) => ({ endToEndId, txid, valor, horario })),
        outros: pix.length - vela.length,
      }
    }
    default:
      throw new ItauPixError('Ação desconhecida.', 400)
  }
}
