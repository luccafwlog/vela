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
  status: 'aceito' | 'falha_transitoria' | 'falha_permanente'
  lastError?: string
}

export type EmailAttemptRecord = {
  id: string | number
  status: EmailAttemptUpdate['status'] | 'entregue' | 'bounce' | 'complaint'
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
  from?: string | null
  replyTo?: string | null
  missingConfigurationMessage?: string
  checkSuppression: (to: string) => Promise<EmailSuppression>
  recordAttempt: (input: { kind: string; to: string; idempotencyKey: string }) => Promise<EmailAttemptRecord>
  updateAttempt: (attemptId: string | number, update: EmailAttemptUpdate) => Promise<void>
  fetchImpl?: typeof fetch
}

const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504])
const BACKOFF_MS = [1000, 3000, 9000]

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
// status sozinho esconde; não carrega dados do destinatário.
async function providerErrorName(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { name?: unknown } | null
  return typeof body?.name === 'string' ? ` ${body.name}` : ''
}

export async function sendEmail(input: SendEmailInput): Promise<{ ok: boolean }> {
  const suppression = await input.checkSuppression(input.to.toLowerCase())
  if (suppression.suppressed) return { ok: false }

  if (input.resendApiKey && (!input.from || !input.replyTo)) {
    throw new Error(input.missingConfigurationMessage ?? 'Remetente e reply-to são obrigatórios para envio real')
  }

  const attempt = await input.recordAttempt({ kind: input.kind, to: input.to, idempotencyKey: input.idempotencyKey })

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
  for (let index = 0; index < 3; index += 1) {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.resendApiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': providerIdempotencyKey,
      },
      body,
    })

    if (response.ok) {
      const accepted = await response.json() as { id?: string }
      await input.updateAttempt(attempt.id, {
        providerMessageId: accepted.id ?? null,
        retryCount: index,
        status: 'aceito',
        lastError: undefined,
      })
      return { ok: true }
    }

    const transient = TRANSIENT_STATUS.has(response.status)
    if (!transient || index === 2) {
      await input.updateAttempt(attempt.id, {
        retryCount: index,
        status: transient ? 'falha_transitoria' : 'falha_permanente',
        lastError: `HTTP ${response.status}${await providerErrorName(response)}`,
      })
      return { ok: false }
    }

    await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[index]))
  }

  return { ok: false }
}
