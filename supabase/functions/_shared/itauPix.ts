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
        // Só o Pix do Vela tem o horário convertido: horário inesperado de terceiro não
        // derruba a consulta, e o do Vela segue cru para a validação, que o manda à análise.
        all.push(...(body?.pix ?? []).map(p => {
          if (!isVelaTxid(p.txid)) return p
          try {
            return { ...p, horario: itauTimeToUtc(p.horario) }
          } catch (error) {
            // Horário no futuro é o banco que mudou o fuso: vale para todos, então para.
            if (error instanceof ItauPixError && error.message.includes('no futuro')) throw error
            return { ...p, horario: '' }
          }
        }))
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
  /** Versão de valor e validade reservada (migration 412); o resultado só ativa esta versão. */
  change_version?: number
}

export type ChargeOutcome =
  | { outcome: 'active'; revision: number; pixCopiaECola: string; bankCreatedAt: string }
  | { outcome: 'cancelled' | 'concluded' | 'expired' | 'uncertain' | 'error'; error?: string; throttled?: true }

export type ChargeQueue = {
  claim(limit: number): Promise<QueuedCharge[]>
  // claimedVersion: change_version da linha reservada, a que foi enviada ao banco.
  record(id: number, outcome: ChargeOutcome, claimedVersion?: number): Promise<void>
  // Renova a vez única do runner (migration 219) antes de cada bloco seguinte;
  // falso encerra a execução. Ausente: sem vez (testes, ações manuais).
  renew?(): Promise<boolean>
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
    // Limite de requisições do Itaú: a cobrança volta à fila com o recuo do claim, e a
    // execução para de chamar o banco (os limites nunca foram medidos; não forçar).
    if (error.status === 429) return { outcome: 'error', error: error.message, throttled: true }
    // Paga antes do cancelamento ou da alteração: preservar para a baixa/análise.
    if (charge.status !== 'pending_create' && (error.body as Partial<ItauCob> | null)?.status === 'CONCLUIDA') return { outcome: 'concluded' }
    // Nunca chegou a existir no banco: nada a cancelar.
    if (charge.status === 'pending_cancel' && error.status === 404) return { outcome: 'cancelled' }
    return { outcome: 'error', error: `${error.message}${error.body ? ' ' + JSON.stringify(error.body).slice(0, 300) : ''}` }
  }
}

// Orçamento por execução (migration 219). Cada cobrança é uma chamada ao Itaú
// (~0,3–1 s). Blocos de 5 mantêm cada reserva (1 min no primeiro claim) longe
// do vencimento, e o teto limita a carga numa API cujos limites nunca foram
// medidos (relatório de 2026-10-07: "não provocar carga").
// A execução para no primeiro 429 e na primeira cobrança sem resposta: com o
// Itaú parado, cada cobrança espera até 2 × 15 s (token e chamada), e um bloco
// inteiro passaria da vez do runner (120 s) e da reserva da cobrança (1 min).
// ponytail: sequencial, teto fixo de 60 por execução.
// Caminho de upgrade: medir o limite do Itaú e ajustar teto/paralelismo.
export const ITAU_PIX_CHUNK = 5
export const ITAU_PIX_BUDGET_MS = 20_000
export const ITAU_PIX_MAX_PER_RUN = 60

export async function processItauPixQueue(
  client: ItauPixClient,
  queue: ChargeQueue,
  options: { chunk?: number; budgetMs?: number; maxCharges?: number; now?: () => number } = {},
) {
  const chunk = options.chunk ?? ITAU_PIX_CHUNK
  const budgetMs = options.budgetMs ?? ITAU_PIX_BUDGET_MS
  const maxCharges = options.maxCharges ?? ITAU_PIX_MAX_PER_RUN
  const now = options.now ?? Date.now
  const startedAt = now()
  const summary: Record<ChargeOutcome['outcome'], number> & { throttled: boolean; unreachable: boolean } = {
    active: 0, cancelled: 0, concluded: 0, expired: 0, uncertain: 0, error: 0, throttled: false, unreachable: false,
  }
  let processed = 0
  for (let round = 0; now() - startedAt < budgetMs && processed < maxCharges; round += 1) {
    if (round > 0 && queue.renew && !(await queue.renew())) break
    const charges = await queue.claim(Math.min(chunk, maxCharges - processed))
    for (const charge of charges) {
      const outcome = await stepCharge(client, charge)
      await queue.record(charge.id, outcome, charge.change_version)
      summary[outcome.outcome]++
      processed++
      // As cobranças já reservadas e não chamadas voltam pela própria reserva vencida.
      if (outcome.outcome === 'error' && outcome.throttled) {
        summary.throttled = true
        return summary
      }
      if (outcome.outcome === 'uncertain') {
        summary.unreachable = true
        return summary
      }
    }
    // Para só com a fila vazia: o registro de um resultado pode criar trabalho novo
    // (substituta da vencida, cancelamento pedido durante a emissão), e o disparo
    // dele encontra esta execução com a vez.
    if (charges.length === 0) break
  }
  return summary
}

// ---------------------------------------------------------------------------
// Recebimentos (Fase 3): GET /pix por janela, baixa no banco por itau_pix_settle.

export type ReceiptSink = {
  checkpoint(): Promise<string | null>
  settle(pix: { endToEndId: string; txid: string; valor: string; horario: string }): Promise<'settled' | 'review'>
  // Recebimento que não pôde ser baixado (F-09, migration 358): o banco conta as
  // tentativas; 'review' manda para análise e a consulta segue, 'retry' para sem avançar.
  failed(pix: { endToEndId?: string; txid: string; raw: unknown }, error: string, permanent: boolean): Promise<'review' | 'retry'>
  // Pix sem TXID na chave do Vela (ADR 0093, decisão 16; migration 375): vira
  // "Pix recebido sem baixa" com Alerta para o Financeiro.
  untracked(pix: { endToEndId: string; valor: string; horario: string }): Promise<'review'>
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
const MIN_WINDOW_MS = 5 * 60 * 1000 // Janela com páginas demais é dividida até 5 min.
const FIRST_LOOKBACK_MS = 24 * 60 * 60 * 1000

export async function pollItauPixReceipts(client: ItauPixClient, sink: ReceiptSink, now = new Date()) {
  const last = await sink.checkpoint()
  const start = (last ? Date.parse(last) : now.getTime() - FIRST_LOOKBACK_MS) - OVERLAP_MS
  let end = Math.min(now.getTime(), start + MAX_WINDOW_MS)
  let pix: ItauPix[]
  for (;;) {
    try {
      pix = await client.listPix(new Date(start).toISOString(), new Date(end).toISOString())
      break
    } catch (error) {
      // Mais de 50 páginas: a janela encolhe em vez de travar o checkpoint.
      if (!(error instanceof ItauPixError) || error.status !== 413 || end - start <= MIN_WINDOW_MS) throw error
      end = start + Math.max(MIN_WINDOW_MS, Math.floor((end - start) / 2))
    }
  }
  const summary = { seen: pix.length, vela: 0, test: 0, settled: 0, review: 0, untracked: 0, until: new Date(end).toISOString() }
  for (const p of pix) {
    // Pix sem TXID (cópia e cola sem cobrança, chave digitada): pode ser de
    // fatura do Vela, então vai para análise. Registro sem horário/valor válido
    // não é baixável e fica de fora.
    if (!p.txid && endToEndTime(p.endToEndId ?? '') !== null && MONEY.test(p.valor ?? '')) {
      const horario = (() => { try { return itauTimeToUtc(p.horario) } catch { return new Date(endToEndTime(p.endToEndId)!).toISOString() } })()
      try {
        await sink.untracked({ endToEndId: p.endToEndId, valor: p.valor, horario })
        summary.untracked++
      } catch (error) {
        // Mesma regra do Pix com TXID: até a terceira vez para sem avançar; depois, análise.
        const message = error instanceof Error ? error.message : 'Falha ao registrar Pix sem TXID.'
        if (await sink.failed({ endToEndId: p.endToEndId, txid: '', raw: p }, message, false) === 'retry') throw error
        summary.review++
      }
      continue
    }
    // Pix do sistema de terceiro na mesma chave (TXID de outro padrão): ignorado e não persistido.
    if (!isVelaTxid(p.txid)) continue
    // Cobrança de teste paga (Fase 1): não é fatura, então não vira baixa nem Alerta.
    if (isVelaTestTxid(p.txid)) { summary.test++; continue }
    summary.vela++
    const initiatedAt = endToEndTime(p.endToEndId ?? '')
    if (initiatedAt === null || !MONEY.test(p.valor ?? '') || !Number.isFinite(Date.parse(p.horario))) {
      // Registro ruim vai para análise e a consulta avança.
      await sink.failed({ endToEndId: p.endToEndId, txid: p.txid, raw: p }, 'Recebimento do Itaú em formato inesperado.', true)
      summary.review++
      continue
    }
    if (Math.abs(Date.parse(p.horario) - initiatedAt) > END_TO_END_TOLERANCE_MS) {
      // Desvio de fuso vale para todos os recebimentos: para sem avançar, e o
      // Alerta de consulta parada (migration 358) avisa.
      throw new ItauPixError('Horário do Itaú diverge do endToEndId; conferir se o banco mudou o fuso.', 502, { txid: p.txid })
    }
    let outcome: 'settled' | 'review'
    try {
      outcome = await sink.settle({ endToEndId: p.endToEndId, txid: p.txid, valor: p.valor, horario: p.horario })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao registrar recebimento Itaú.'
      // Erro passageiro: até a terceira vez a consulta para sem avançar; depois, análise.
      if (await sink.failed({ endToEndId: p.endToEndId, txid: p.txid, raw: p }, message, false) === 'retry') throw error
      outcome = 'review'
    }
    summary[outcome]++
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
