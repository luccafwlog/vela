export type EmailSuppression = {
  suppressed: boolean
  reason?: string
}

export type EmailAttachment = {
  filename: string
  content: string
  contentType?: string
}

export type EmailAttemptUpdate = {
  providerMessageId?: string | null
  retryCount: number
  /** `bounce` só no 422 de endereço suprimido no provedor, com `recordProviderSuppression`. */
  status: 'aceito' | 'falha_transitoria' | 'falha_permanente' | 'bounce'
  lastError?: string
}

export type EmailAttemptRecord = {
  id: string | number
  status: EmailAttemptUpdate['status'] | 'entregue' | 'complaint'
  providerMessageId?: string | null
  /** Chave persistida; tentativas legadas podem ter hash de email sem canonicalização. */
  idempotencyKey?: string
  existing?: boolean
}

export type SendEmailInput = {
  kind: string
  to: string
  subject: string
  html: string
  text: string
  attachments?: readonly EmailAttachment[]
  idempotencyKey: string
  resendApiKey?: string | null
  /** Origem da API compatível com a Resend; sem valor, usa o secret `RESEND_BASE_URL` ou a Resend. */
  apiBaseUrl?: string | null
  /** Somente produtores com chave de envio desligada podem pedir simulação. */
  simulate?: boolean
  from?: string | null
  replyTo?: string | null
  missingConfigurationMessage?: string
  checkSuppression: (to: string) => Promise<EmailSuppression>
  /**
   * O provedor recusou o envio porque o endereço está na supressão dele
   * (422 `all_recipients_suppressed`). Com este callback, quem chama grava a
   * supressão local, a tentativa fica `bounce` e o resultado sai `suppressed`;
   * sem ele, a recusa segue como `falha_permanente`.
   */
  recordProviderSuppression?: (to: string) => Promise<void>
  recordAttempt: (input: { kind: string; to: string; idempotencyKey: string }) => Promise<EmailAttemptRecord>
  updateAttempt: (attemptId: string | number, update: EmailAttemptUpdate) => Promise<void>
  fetchImpl?: typeof fetch
  /** Tempo máximo de cada chamada ao provedor; o padrão vale para produção. */
  timeoutMs?: number
  /** Espera entre tentativas; injetável para os testes não dormirem. */
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_API_BASE_URL = 'https://api.resend.com'

// A MillionSend aceita as mesmas chamadas da Resend: trocar de provedor é
// trocar `RESEND_BASE_URL` e `RESEND_API_KEY`, sem mudar o código.
export function emailApiBaseUrl(configured?: string | null): string {
  const value = (configured ?? (globalThis as { Deno?: { env: { get(name: string): string | undefined } } }).Deno?.env.get('RESEND_BASE_URL'))?.trim()
  return value ? value.replace(/\/+$/, '') : DEFAULT_API_BASE_URL
}

// 408, 429 e qualquer 5xx: o problema é do provedor ou do momento, não do e-mail.
const TRANSIENT_STATUS = new Set([408, 429])
function isTransientStatus(status: number): boolean {
  return TRANSIENT_STATUS.has(status) || (status >= 500 && status <= 599)
}
// Credencial ou permissão do provedor: tentar de novo na mesma rodada não
// adianta, mas a falha não é do destinatário. Fica `falha_transitoria` para
// a tentativa voltar a ser feita depois que a configuração for corrigida;
// como permanente, a mesma chave nunca mais chamaria o provedor.
const CONFIGURATION_STATUS = new Set([401, 403])
// 409 da Resend: o pedido anterior com a mesma Idempotency-Key ainda roda
// (`concurrent_idempotent_requests`) ou o recurso está travado. O e-mail pode
// ter saído; só `invalid_idempotent_request` (chave com outro corpo) é definitivo.
const TRANSIENT_CONFLICT_NAMES = new Set(['concurrent_idempotent_requests', 'resource_locked'])
// 422 da Resend quando todo destinatário está na supressão do provedor (bounce
// ou reclamação anterior): o endereço não recebe, mas não é falha do envio.
const PROVIDER_SUPPRESSED_NAME = 'all_recipients_suppressed'
const BACKOFF_MS = [1000, 3000, 9000]
const PROVIDER_TIMEOUT_MS = 15_000
const MAX_RETRY_AFTER_MS = 10_000

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after')
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const at = Date.parse(header)
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now())
}

function networkErrorReason(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  return name === 'TimeoutError' || name === 'AbortError'
    ? 'Tempo esgotado na chamada ao provedor'
    : `Falha de rede na chamada ao provedor${name ? ` (${name})` : ''}`
}

// Mantém a mesma regra de src/lib/maskEmail.ts; Deno não importa o bundle Vite.
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  const dot = domain.lastIndexOf('.')
  const domainName = dot > 0 ? domain.slice(0, dot) : domain
  return `${local[0]}***@${domainName[0]}***${dot > 0 ? domain.slice(dot) : ''}`
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function recipientKey(email: string): Promise<string> {
  return `sha256:${await sha256Hex(email.trim().toLowerCase())}`
}

// O `name` da Resend (ex.: invalid_idempotent_request) distingue causas que o
// status sozinho esconde; não carrega dados do destinatário. A `message` só é
// lida para reconhecer erro da nossa configuração que a Resend devolve como
// 400/422: chave da API, remetente (`from`) ou reply-to inválidos. Como
// definitivo, cada destinatário da rodada ficaria recusado para sempre.
async function providerError(response: Response): Promise<{ name: string; configuration: boolean }> {
  const body = await response.json().catch(() => null) as { name?: unknown; message?: unknown } | null
  const name = typeof body?.name === 'string' ? body.name : ''
  const message = typeof body?.message === 'string' ? body.message : ''
  const configuration = name === 'invalid_from_address' || /api key|\b(from|reply_to)\b/i.test(message)
  return { name, configuration }
}

/** `suppressed` só aparece quando o provedor recusou o endereço como suprimido (ver `recordProviderSuppression`). */
export async function sendEmail(input: SendEmailInput): Promise<{ ok: boolean; suppressed?: true }> {
  const suppression = await input.checkSuppression(input.to.toLowerCase())
  if (suppression.suppressed) return { ok: false }

  if (!input.simulate && input.resendApiKey && (!input.from || !input.replyTo)) {
    throw new Error(input.missingConfigurationMessage ?? 'Remetente e reply-to são obrigatórios para envio real')
  }

  const attempt = await input.recordAttempt({ kind: input.kind, to: input.to, idempotencyKey: input.idempotencyKey })

  if (input.simulate) {
    if (attempt.existing && (attempt.providerMessageId || attempt.status === 'entregue')) return { ok: true }
    if (attempt.existing && ['falha_permanente', 'bounce', 'complaint'].includes(attempt.status)) return { ok: false }
    await input.updateAttempt(attempt.id, {
      providerMessageId: null, retryCount: 0, status: 'aceito', lastError: undefined,
    })
    return { ok: true }
  }

  if (!input.resendApiKey) {
    await input.updateAttempt(attempt.id, {
      retryCount: 0,
      status: 'falha_permanente',
      lastError: 'RESEND_API_KEY não está configurada; email não enviado.',
    })
    return { ok: false }
  }

  // `aceito` is written before contacting the provider. It is only terminal
  // when Resend returned a provider id; otherwise this is the crash window
  // between persistence and the HTTP call and must be retried.
  if (attempt.existing && (attempt.providerMessageId || attempt.status === 'entregue')) return { ok: true }
  if (attempt.existing && ['falha_permanente', 'bounce', 'complaint'].includes(attempt.status)) return { ok: false }

  const fetchImpl = input.fetchImpl ?? fetch
  const emailsUrl = `${emailApiBaseUrl(input.apiBaseUrl)}/emails`
  const body = JSON.stringify({
    from: input.from,
    to: [input.to],
    reply_to: input.replyTo,
    subject: input.subject,
    html: input.html,
    text: input.text,
    ...(input.attachments?.length
      ? { attachments: input.attachments.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
          ...(attachment.contentType ? { content_type: attachment.contentType } : {}),
        })) }
      : {}),
  })
  // A Resend guarda a chave por 24h no time inteiro e responde 409 quando ela
  // volta com outro conteúdo. As chaves locais usam ids sequenciais, que se
  // repetem depois de um reset do banco -- foi o que recusou `convite:1` em
  // produção. O hash do corpo mantém a deduplicação do mesmo envio e separa
  // envios diferentes que herdaram a mesma chave.
  // ponytail: retry de crash que regenere conteúdo diferente vira envio novo
  // em vez de 409; gravar um nonce por tentativa se isso passar a importar.
  const providerIdempotencyKey = `${attempt.idempotencyKey ?? input.idempotencyKey}:${(await sha256Hex(body)).slice(0, 32)}`
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  for (let index = 0; index < 3; index += 1) {
    const lastTry = index === 2
    let response: Response
    try {
      // Um tempo esgotado depois de o provedor aceitar não duplica o e-mail:
      // a nova chamada leva a mesma Idempotency-Key.
      response = await fetchImpl(emailsUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.resendApiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': providerIdempotencyKey,
        },
        body,
        signal: AbortSignal.timeout(input.timeoutMs ?? PROVIDER_TIMEOUT_MS),
      })
    } catch (error) {
      // Tempo esgotado não repete na mesma chamada: o pedido anterior pode
      // ainda estar rodando no provedor (a repetição receberia 409) e três
      // esperas de 15 s por destinatário estouram o tempo de quem chamou.
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      if (lastTry || timedOut) {
        await input.updateAttempt(attempt.id, {
          retryCount: index,
          status: 'falha_transitoria',
          lastError: networkErrorReason(error),
        })
        return { ok: false }
      }
      await sleep(BACKOFF_MS[index])
      continue
    }

    if (response.ok) {
      const accepted = await response.json().catch(() => ({})) as { id?: string }
      try {
        await input.updateAttempt(attempt.id, {
          providerMessageId: accepted.id ?? null,
          retryCount: index,
          status: 'aceito',
          lastError: undefined,
        })
      } catch (error) {
        // O provedor já aceitou: tratar como falha levaria o operador ou a
        // régua a reenviar em duplicidade. A tentativa nova já está `aceito`
        // sem id; a reaproveitada (ex.: `falha_transitoria`) não, e quem chama
        // resolve o status pelo sucesso (`resolveDispatchStatus`). A próxima
        // chamada com a mesma chave é deduplicada pelo provedor.
        console.error('[email] e-mail aceito pelo provedor, mas a tentativa não foi atualizada', attempt.id, error)
      }
      return { ok: true }
    }

    const providerFailure = await providerError(response)
    if (response.status === 422 && providerFailure.name === PROVIDER_SUPPRESSED_NAME && input.recordProviderSuppression) {
      // A tentativa é atualizada antes: se gravar a supressão falhar, a
      // exceção chega a quem chama e a próxima rodada não chama o provedor de
      // novo para a mesma chave (tentativa `bounce`).
      await input.updateAttempt(attempt.id, {
        retryCount: index,
        status: 'bounce',
        lastError: `HTTP 422 ${PROVIDER_SUPPRESSED_NAME} (endereço suprimido no provedor)`,
      })
      await input.recordProviderSuppression(input.to)
      return { ok: false, suppressed: true }
    }
    const configuration = CONFIGURATION_STATUS.has(response.status) ||
      ((response.status === 400 || response.status === 422) && providerFailure.configuration)
    const transient = isTransientStatus(response.status) || (response.status === 409 && TRANSIENT_CONFLICT_NAMES.has(providerFailure.name))
    if (configuration || !transient || lastTry) {
      await input.updateAttempt(attempt.id, {
        retryCount: index,
        status: configuration || transient ? 'falha_transitoria' : 'falha_permanente',
        lastError: `HTTP ${response.status}${providerFailure.name ? ` ${providerFailure.name}` : ''}${configuration ? ' (configuração do provedor)' : ''}`,
      })
      return { ok: false }
    }

    const wait = response.status === 429 ? retryAfterMs(response) : null
    await sleep(wait === null ? BACKOFF_MS[index] : Math.min(wait, MAX_RETRY_AFTER_MS))
  }

  return { ok: false }
}
