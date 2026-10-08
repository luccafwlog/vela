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

const FUTURE_TOLERANCE_MS = 5 * 60 * 1000

// Contrato produtivo observado em 07/10/2026: Itaú devolve hora de Brasília
// com Z indevido. Offset explícito é preservado; o restante do Vela usa UTC.
// ponytail: -03:00 fixo (Brasília sem horário de verão) e reinterpretação de todo Z.
// Se o Itaú passar a mandar UTC verdadeiro, a leitura soma 3 h. Duas travas param
// sem gravar horário errado: a recusa de horário no futuro (criação de COB e
// recebimento recente) e, na baixa, a conferência com o horário UTC do endToEndId,
// que independe do relógio e cobre a recuperação de atraso. Limite conhecido: o
// vencimento de uma COB antiga consultada sem nova criação ou baixa no meio só é
// pego pela primeira trava seguinte. Upgrade: ao disparar, remover a troca de Z.
function itauTimeToUtc(value: string): string {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value))
    throw new ItauPixError('Horário do Itaú em formato inesperado.', 502)
  const time = Date.parse(value.replace(/Z$/, '-03:00'))
  if (!Number.isFinite(time)) throw new ItauPixError('Horário do Itaú em formato inesperado.', 502)
  if (time > Date.now() + FUTURE_TOLERANCE_MS) {
    throw new ItauPixError('Horário do Itaú no futuro; conferir se o banco mudou o fuso.', 502, { horario: value })
  }
  return new Date(time).toISOString()
}

function assertCob(cob: unknown, txid: string): ItauCob {
  const c = cob as Partial<ItauCob> | null
  // A especificação diz inteiro, mas o sandbox devolveu "3600" (2026-10-06): aceitar
  // também o inteiro escrito como texto, e só ele.
  const raw: unknown = c?.calendario?.expiracao
  const expiracao = typeof raw === 'string' && /^\d{1,9}$/.test(raw) ? Number(raw) : raw
  if (!c || c.txid !== txid || !Number.isSafeInteger(c.revisao) || typeof c.status !== 'string' ||
      !c.calendario || !Number.isSafeInteger(expiracao) ||
      !c.valor || typeof c.valor.original !== 'string' || !MONEY.test(c.valor.original)) {
    throw new ItauPixError('Resposta do Itaú não confirma a cobrança; consultar antes de repetir.', 502, cob)
  }
  return { ...c, calendario: { ...c.calendario, criacao: itauTimeToUtc(c.calendario.criacao), expiracao: expiracao as number },
    ...(c.pix ? { pix: c.pix.map(p => ({ ...p, horario: itauTimeToUtc(p.horario) })) } : {}),
  } as ItauCob
}

// RFC 3339 sem milissegundos: o sandbox recusou inicio/fim com fração de segundo (2026-10-06).
// O início arredonda para baixo e o fim para cima, então a janela pedida nunca encolhe.
function rfc3339Seconds(value: string, roundUp = false): string {
  const seconds = Date.parse(value) / 1000
  // Produção só encontra a janela equivalente quando enviada com -03:00.
  return new Date((roundUp ? Math.ceil(seconds) : Math.floor(seconds)) * 1000 - 3 * 60 * 60 * 1000)
    .toISOString().replace(/\.\d{3}Z$/, '-03:00')
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
        const query = new URLSearchParams({ inicio: rfc3339Seconds(inicio), fim: rfc3339Seconds(fim, true), 'paginacao.paginaAtual': String(page) })
        const body = await call('GET', `/pix?${query}`) as { pix?: ItauPix[]; parametros?: { paginacao?: { quantidadeDePaginas?: number; quantidadeTotalDeItens?: number } } }
        // Produção (07/10/2026): janela vazia retorna 100 páginas, mas total zero.
        if (body?.pix?.length === 0 && body.parametros?.paginacao?.quantidadeTotalDeItens === 0) return all
        all.push(...(body?.pix ?? []).map(p => ({ ...p, horario: itauTimeToUtc(p.horario) })))
        const pages = body?.parametros?.paginacao?.quantidadeDePaginas ?? 1
        if (page + 1 >= pages) return all
      }
      throw new ItauPixError(`Mais de ${maxPages} páginas no período; reduzir a janela.`, 413)
    },
  }
}

export type ItauPixClient = ReturnType<typeof createItauPixClient>

// ---------------------------------------------------------------------------
// Fila de cobranças das faturas (Fase 2). O banco decide o que precisa existir
// (`itau_pix_charges`, migration 151); aqui só se executa e se relata.

export type QueuedCharge = {
  id: number
  txid: string
  amount_brl: number | string
  expiration_seconds: number
  status: 'pending_create' | 'pending_update' | 'pending_expire_check' | 'pending_cancel'
  uncertain: boolean
  attempts: number
}

export type ChargeOutcome =
  | { outcome: 'active'; revision: number; pixCopiaECola: string; bankCreatedAt: string }
  | { outcome: 'cancelled' | 'concluded' | 'expired' | 'uncertain' | 'error'; error?: string }

export type ChargeQueue = {
  claim(limit: number): Promise<QueuedCharge[]>
  record(id: number, outcome: ChargeOutcome): Promise<void>
}

function active(cob: ItauCob): ChargeOutcome {
  if (!cob.pixCopiaECola) return { outcome: 'error', error: 'Itaú não devolveu o copia e cola.' }
  return { outcome: 'active', revision: cob.revisao, pixCopiaECola: cob.pixCopiaECola, bankCreatedAt: cob.calendario.criacao }
}

function outcomeFromCob(cob: ItauCob, amount: string): ChargeOutcome {
  if (cob.status === 'CONCLUIDA') return { outcome: 'concluded' }
  if (cob.status === 'ATIVA' && cob.valor.original === amount) return active(cob)
  return { outcome: 'error', error: `Cobrança existente em estado ${cob.status} / ${cob.valor.original}.` }
}

export async function stepCharge(client: ItauPixClient, charge: QueuedCharge, now = new Date()): Promise<ChargeOutcome> {
  const amount = Number(charge.amount_brl).toFixed(2)
  try {
    if (charge.status === 'pending_expire_check') {
      // Só substituir a cobrança vencida depois de confirmar que não foi paga.
      const cob = await client.getCob(charge.txid).catch((error) => {
        if (error instanceof ItauPixError && error.status === 404) return null
        throw error
      })
      if (!cob) return { outcome: 'expired' }
      if (cob.status === 'CONCLUIDA') return { outcome: 'concluded' }
      const validUntil = Date.parse(cob.calendario.criacao) + cob.calendario.expiracao * 1000
      return cob.status === 'ATIVA' && validUntil > now.getTime() ? active(cob) : { outcome: 'expired' }
    }
    if (charge.status === 'pending_update') {
      // Nova tentativa: a cobrança pode ter sido paga entretanto, e o Itaú pode recusar
      // a alteração sem devolver a cobrança. Consultar antes.
      if (charge.uncertain || charge.attempts > 1) {
        const existing = await client.getCob(charge.txid)
        if (existing.status === 'CONCLUIDA') return { outcome: 'concluded' }
      }
      // PATCH com valores absolutos: repetir após resposta perdida é seguro.
      return active(await client.updateCob(charge.txid, { amount, expirationSeconds: charge.expiration_seconds }))
    }
    if (charge.status === 'pending_create') {
      // Já houve tentativa: a resposta anterior pode ter se perdido, então
      // consultar antes de criar de novo.
      if (charge.uncertain || charge.attempts > 1) {
        const existing = await client.getCob(charge.txid).catch((error) => {
          if (error instanceof ItauPixError && error.status === 404) return null
          throw error
        })
        if (existing) return outcomeFromCob(existing, amount)
      }
      return active(await client.createCob(charge.txid, amount, charge.expiration_seconds))
    }
    // Cancelamento repetido: a resposta anterior pode ter se perdido com a cobrança já
    // removida ou paga, e pedir de novo poderia falhar para sempre. Consultar antes.
    if (charge.uncertain || charge.attempts > 1) {
      const existing = await client.getCob(charge.txid).catch((error) => {
        if (error instanceof ItauPixError && error.status === 404) return null
        throw error
      })
      if (!existing || existing.status.startsWith('REMOVIDA')) return { outcome: 'cancelled' }
      if (existing.status === 'CONCLUIDA') return { outcome: 'concluded' }
    }
    await client.cancelCob(charge.txid)
    return { outcome: 'cancelled' }
  } catch (error) {
    if (!(error instanceof ItauPixError)) return { outcome: 'error', error: 'Falha inesperada no processador.' }
    if (error.status === 0) return { outcome: 'uncertain', error: error.message }
    // Paga antes do cancelamento ou da alteração: preservar para a baixa/análise.
    if (charge.status !== 'pending_create' && (error.body as Partial<ItauCob> | null)?.status === 'CONCLUIDA') return { outcome: 'concluded' }
    // Nunca chegou a existir no banco: nada a cancelar.
    if (charge.status === 'pending_cancel' && error.status === 404) return { outcome: 'cancelled' }
    return { outcome: 'error', error: `${error.message}${error.body ? ' ' + JSON.stringify(error.body).slice(0, 300) : ''}` }
  }
}

export async function processItauPixQueue(client: ItauPixClient, queue: ChargeQueue, limit = 20) {
  const summary: Record<ChargeOutcome['outcome'], number> = { active: 0, cancelled: 0, concluded: 0, expired: 0, uncertain: 0, error: 0 }
  // ponytail: sequencial; paralelizar só se a fila passar de dezenas por minuto.
  for (const charge of await queue.claim(limit)) {
    const outcome = await stepCharge(client, charge)
    await queue.record(charge.id, outcome)
    summary[outcome.outcome]++
  }
  return summary
}

// ---------------------------------------------------------------------------
// Recebimentos (Fase 3): GET /pix por janela, baixa no banco por itau_pix_settle.

export type ReceiptSink = {
  checkpoint(): Promise<string | null>
  settle(pix: { endToEndId: string; txid: string; valor: string; horario: string }): Promise<'settled' | 'review'>
  saveCheckpoint(until: string): Promise<void>
}

// endToEndId do Pix (BCB): 'E' + ISPB + aaaaMMddHHmm em UTC + 11 caracteres.
const END_TO_END = /^E[0-9A-Za-z]{8}(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})[0-9A-Za-z]{11}$/
const END_TO_END_TOLERANCE_MS = 60 * 60 * 1000 // Liquidação segue a iniciação em segundos; 3 h de desvio é fuso.

function endToEndTime(id: string): number | null {
  const m = END_TO_END.exec(id)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null
}

const OVERLAP_MS = 10 * 60 * 1000 // Pix disponibilizado com atraso entra na janela seguinte.
const MAX_WINDOW_MS = 6 * 60 * 60 * 1000 // Atraso grande é recuperado em várias execuções.
const FIRST_LOOKBACK_MS = 24 * 60 * 60 * 1000

export async function pollItauPixReceipts(client: ItauPixClient, sink: ReceiptSink, now = new Date()) {
  const last = await sink.checkpoint()
  const start = (last ? Date.parse(last) : now.getTime() - FIRST_LOOKBACK_MS) - OVERLAP_MS
  const end = Math.min(now.getTime(), start + MAX_WINDOW_MS)
  const pix = await client.listPix(new Date(start).toISOString(), new Date(end).toISOString())
  const summary = { seen: pix.length, vela: 0, test: 0, settled: 0, review: 0, until: new Date(end).toISOString() }
  for (const p of pix) {
    // Pix do sistema de terceiro na mesma chave: ignorado e não persistido.
    if (!isVelaTxid(p.txid)) continue
    // Cobrança de teste paga (Fase 1): não é fatura, então não vira baixa nem Alerta.
    if (isVelaTestTxid(p.txid)) { summary.test++; continue }
    const initiatedAt = endToEndTime(p.endToEndId ?? '')
    if (initiatedAt === null || !MONEY.test(p.valor ?? '') || !Number.isFinite(Date.parse(p.horario))) {
      // Sem avançar o checkpoint: a próxima execução tenta de novo e o erro fica visível.
      throw new ItauPixError('Recebimento do Itaú em formato inesperado.', 502, { txid: p.txid })
    }
    if (Math.abs(Date.parse(p.horario) - initiatedAt) > END_TO_END_TOLERANCE_MS) {
      throw new ItauPixError('Horário do Itaú diverge do endToEndId; conferir se o banco mudou o fuso.', 502, { txid: p.txid })
    }
    summary.vela++
    summary[await sink.settle({ endToEndId: p.endToEndId, txid: p.txid, valor: p.valor, horario: p.horario })]++
  }
  await sink.saveCheckpoint(summary.until)
  return summary
}

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
